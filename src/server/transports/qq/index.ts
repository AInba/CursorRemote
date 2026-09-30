import { join } from 'path';
import type { Transport } from '../types.js';
import type { CursorState, ModeInfo, QqConfig } from '../../types.js';
import type { CommandExecutor } from '../../command-executor.js';
import type { CDPBridge } from '../../cdp-bridge.js';
import type { StateManager } from '../../state-manager.js';
import type { WindowMonitor } from '../../window-monitor.js';
import type { Approval } from '../../types.js';
import { BindTokenStore } from '../feishu/bind-token.js';
import { writeBindArtifacts } from '../feishu/bind-artifacts.js';
import { FeishuAuthStore } from '../feishu/auth-store.js';
import { FeishuSessionStore } from '../feishu/session-router.js';
import { ActionRegistry, actionResultText, runCardCommand, type StoredAction } from '../feishu/actions.js';
import { QqApi, QqApiError } from './api.js';
import { QqGateway } from './gateway.js';
import { handleQqText, keyboardFor, type QqReply } from './inbound.js';
import { sentToWindow } from '../feishu/formatter.js';
import { formatPickList, modelOptionsFrom, resolvePick } from '../pick.js';
import { plansFromMessages, promptButtonStyle, promptFingerprint, promptIntro, promptSections } from './prompts.js';
import { setTransportLink } from '../../transport-status.js';
import { withDoHints, type QqButton } from './keyboard.js';
import { PASSIVE_REPLY_MS, qqApiBase, type QqParsedFrame } from './protocol.js';

const BIND_CHECK_MS = 5_000;
const PUSH_DEBOUNCE_MS = 2_000;

interface FreshInbound {
  msgId: string;
  at: number;
}

export class QqTransport implements Transport {
  readonly name = 'qq';

  private readonly auth: FeishuAuthStore;
  private readonly bind: BindTokenStore;
  private readonly sessions: FeishuSessionStore;
  private readonly registry = new ActionRegistry();
  private readonly api: QqApi;
  private gateway: QqGateway | null = null;
  private bindTimer: ReturnType<typeof setInterval> | null = null;
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private lastBindToken = '';
  private stopped = false;
  private readonly freshInbound = new Map<string, FreshInbound>();
  private readonly approvalHash = new Map<string, string>();
  private readonly approvalBlocked = new Set<string>();
  private readonly onWindowUpdate = (): void => {
    this.schedulePush();
  };

  constructor(
    private readonly config: QqConfig,
    private readonly dataDir: string,
    private readonly windowMonitor: WindowMonitor,
    private readonly stateManager: StateManager,
    private readonly commandExecutor: CommandExecutor,
    private readonly cdpBridge: CDPBridge,
  ) {
    this.auth = new FeishuAuthStore(join(dataDir, 'qq-auth.json'), config.preRegisteredUsers);
    this.bind = new BindTokenStore('');
    this.sessions = new FeishuSessionStore(join(dataDir, 'qq-sessions.json'));
    this.api = new QqApi(config.appId, config.appSecret, qqApiBase(config.sandbox));
  }

  async start(): Promise<void> {
    setTransportLink('qq', 'starting', '正在连接 QQ 网关…');
    await this.persistBind(true);
    this.bindTimer = setInterval(() => {
      void this.persistBind(false);
    }, BIND_CHECK_MS);

    this.gateway = new QqGateway({
      gatewayUrl: () => this.api.gatewayUrl(),
      accessToken: () => this.api.accessToken(),
      onEvent: (event) => {
        void this.onGatewayEvent(event);
      },
      onLog: (line) => {
        console.log(line);
        this.noteGatewayLog(line);
      },
    });
    await this.gateway.start();
    setTransportLink('qq', 'ready', this.config.sandbox ? '沙箱网关已连接' : '网关已连接');
    this.windowMonitor.on('window:update', this.onWindowUpdate);
    const challenge = this.bind.current();
    console.log(`[qq] Long connection ready (${this.config.sandbox ? 'sandbox' : 'production'})`);
    console.log(`[qq] Bind command: ${challenge.command}`);
    console.log('[qq] Open the bot with the 扫码聊天 code in the QQ bot console, then send the bind command.');
    if (this.config.sandbox) {
      console.log('[qq] Sandbox mode: only sandbox users configured on the QQ open platform can chat.');
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.bindTimer) clearInterval(this.bindTimer);
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.windowMonitor.off('window:update', this.onWindowUpdate);
    this.gateway?.stop();
    this.gateway = null;
  }

  private noteGatewayLog(line: string): void {
    if (line.includes('4914') || line.includes('sandbox-only')) {
      setTransportLink('qq', 'error', '4914：机器人仍只能走沙箱。在 Setup 打开 Sandbox 后重启。');
      return;
    }
    if (/whitelist|白名单|\bIP\b/i.test(line)) {
      setTransportLink('qq', 'error', '公网 IP 不在 QQ 白名单里。把当前出口 IP 加到控制台后再重启。');
      return;
    }
    if (line.includes('gateway ready') || line.includes('gateway resumed')) {
      setTransportLink('qq', 'ready', this.config.sandbox ? '沙箱网关已连接' : '网关已连接');
    }
  }

  private async persistBind(force: boolean): Promise<void> {
    const challenge = this.bind.current();
    if (!force && challenge.token === this.lastBindToken) return;
    this.lastBindToken = challenge.token;
    try {
      await writeBindArtifacts(this.dataDir, challenge, 'qq');
    } catch (err) {
      console.warn(`[qq] Could not write bind QR: ${err instanceof Error ? err.message : err}`);
    }
  }

  private async onGatewayEvent(event: QqParsedFrame): Promise<void> {
    if (this.stopped) return;
    if (event.type === 'c2c') {
      this.freshInbound.set(event.message.userOpenId, { msgId: event.message.id, at: Date.now() });
      const replies = handleQqText({
        openId: event.message.userOpenId,
        text: event.message.content,
      }, {
        ...this.deps(),
        approvalNotPushed: this.approvalBlocked.has(event.message.userOpenId),
      });
      await this.deliver(event.message.userOpenId, event.message.id, replies);
      this.schedulePush();
      return;
    }
    if (event.type === 'interaction') {
      try {
        await this.api.ackInteraction(event.interaction.id);
      } catch (err) {
        console.warn(`[qq] interaction ack failed: ${err instanceof Error ? err.message : err}`);
      }
      if (!this.auth.isAllowed(event.interaction.userOpenId)) return;
      const action = this.registry.get(event.interaction.buttonData)
        ?? this.registry.get(event.interaction.buttonData.replace(/^\/do\s+/i, ''));
      if (!action) return;
      const fresh = this.freshInbound.get(event.interaction.userOpenId);
      await this.runAction(event.interaction.userOpenId, fresh?.msgId, action);
    }
  }

  unbindUser(openId: string): { removed: boolean; restoredOnRestart: boolean } {
    const removed = this.auth.revoke(openId);
    if (removed) {
      this.sessions.forgetOpenId(openId);
      this.approvalBlocked.delete(openId);
    }
    return { removed, restoredOnRestart: this.auth.isPreRegistered(openId) };
  }

  private deps() {
    const view = this.currentView();
    return {
      isAllowed: (openId: string) => this.auth.isAllowed(openId),
      tryBind: (openId: string, token: string) => {
        if (!this.bind.consume(token)) return false;
        this.auth.register(openId);
        this.sessions.upsert({ chatId: openId, openId, chatType: 'p2p' });
        void this.persistBind(true);
        console.log(`[qq] Bound ${openId}`);
        return true;
      },
      unbind: (openId: string) => this.unbindUser(openId).removed,
      sessions: this.sessions,
      activeWindowId: this.cdpBridge.activeTargetId,
      status: {
        connected: view?.connected ?? false,
        windowTitle: view?.windowTitle,
        agentStatus: view?.agentStatus,
        activity: view?.agentActivityText,
        mode: view?.modeCurrent,
        model: view?.modelCurrent,
      },
      pendingApprovals: view?.pendingApprovals ?? [],
      questionnaire: view?.questionnaire ?? null,
      plans: view?.plans ?? [],
      approvalNotPushed: false,
      mode: view ? { current: view.modeCurrent, available: view.modeAvailable } : null,
      registry: this.registry,
      takeAction: (id: string) => this.registry.get(id) ?? null,
      windows: this.cdpBridge.windows.map(win => ({
        id: win.id,
        label: win.title?.trim() || win.id.slice(0, 8),
        active: win.id === this.cdpBridge.activeTargetId,
      })),
      tabs: this.currentTabs(),
    };
  }

  private async deliver(userOpenId: string, msgId: string | undefined, replies: QqReply[]): Promise<void> {
    for (const reply of replies) {
      try {
        if (reply.kind === 'text') {
          await this.api.sendC2cText(userOpenId, reply.text, msgId);
        } else if (reply.kind === 'buttons') {
          await this.sendButtons(userOpenId, reply.text, reply.buttons, msgId);
        } else if (reply.kind === 'cursor') {
          const result = await this.commandExecutor.sendMessage(`qq_${Date.now().toString(36)}`, reply.text);
          await this.api.sendC2cText(
            userOpenId,
            result.ok ? sentToWindow(this.currentView()?.windowTitle) : `发送失败: ${result.error ?? 'unknown'}`,
            msgId,
          );
        } else if (reply.kind === 'switch-window') {
          try {
            await this.cdpBridge.switchWindow(reply.windowId);
            await this.api.sendC2cText(userOpenId, `已切换到窗口：${reply.title}`, msgId);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            await this.api.sendC2cText(userOpenId, `切换窗口失败: ${message}`, msgId);
          }
        } else if (reply.kind === 'switch-tab') {
          const result = await this.commandExecutor.switchTab(`qq_${Date.now().toString(36)}`, reply.title);
          await this.api.sendC2cText(
            userOpenId,
            result.ok ? `已切换到标签：${reply.title}` : `切换标签失败: ${result.error ?? 'unknown'}`,
            msgId,
          );
        } else if (reply.kind === 'models') {
          await this.replyModels(userOpenId, msgId, reply.query);
        } else {
          await this.runAction(userOpenId, msgId, reply.action);
        }
      } catch (err) {
        this.logSendError(err);
      }
    }
  }

  private async runAction(userOpenId: string, msgId: string | undefined, action: StoredAction): Promise<void> {
    try {
      const result = await runCardCommand(action, this.commandExecutor, {
        switchWindow: (windowId) => this.cdpBridge.switchWindow(windowId),
      });
      const title = action.cmd === 'window' ? undefined : this.currentView()?.windowTitle;
      await this.api.sendC2cText(
        userOpenId,
        actionResultText(action, result.ok, result.error, title),
        msgId,
      );
    } catch (err) {
      this.logSendError(err);
    }
  }

  private async sendButtons(
    userOpenId: string,
    text: string,
    buttons: QqButton[],
    msgId?: string,
  ): Promise<void> {
    if (buttons.length === 0) {
      await this.api.sendC2cText(userOpenId, text, msgId);
      return;
    }
    try {
      await this.api.sendC2cMarkdown(userOpenId, text, keyboardFor(buttons), msgId);
    } catch (err) {
      console.warn(`[qq] markdown keyboard rejected, sending text: ${err instanceof Error ? err.message : err}`);
      await this.api.sendC2cText(userOpenId, text, msgId);
    }
  }

  private schedulePush(): void {
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      void this.pushApprovals();
    }, PUSH_DEBOUNCE_MS);
  }

  private async pushApprovals(): Promise<void> {
    if (this.stopped) return;
    const view = this.currentView();
    if (!view) return;
    const sections = promptSections({
      approvals: view.pendingApprovals,
      questionnaire: view.questionnaire,
      plans: view.plans,
    });
    if (sections.length === 0) return;
    const hash = promptFingerprint(sections);
    const now = Date.now();
    for (const session of this.sessions.listP2P()) {
      if (!this.auth.isAllowed(session.openId)) continue;
      if (this.approvalHash.get(session.openId) === hash) continue;
      const fresh = this.freshInbound.get(session.openId);
      if (!fresh || now - fresh.at > PASSIVE_REPLY_MS) {
        this.approvalBlocked.add(session.openId);
        continue;
      }
      const shown = sections.flatMap(section => section.actions).slice(0, 6);
      const buttons = shown.map(action => ({
        id: this.registry.put(action),
        label: action.label ?? action.cmd,
        style: promptButtonStyle(action),
      }));
      const extra = sections.flatMap(section => section.actions).length > shown.length
        ? '\n按钮只列出前 6 个。其余请发 /status 查看 /do 编号。'
        : '';
      try {
        await this.sendButtons(session.openId, `${withDoHints(promptIntro(sections), buttons)}${extra}`, buttons, fresh.msgId);
        this.approvalHash.set(session.openId, hash);
        this.approvalBlocked.delete(session.openId);
      } catch (err) {
        this.logSendError(err);
      }
    }
  }

  private logSendError(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof QqApiError && /ip|whitelist|白名单/i.test(err.body + message)) {
      const detail = '公网 IP 不在 QQ 白名单里。把当前出口 IP 加到控制台后再重启。';
      setTransportLink('qq', 'error', detail);
      console.error(`[qq] ${message}. ${detail}`);
      return;
    }
    console.error(`[qq] send failed: ${message}`);
  }

  private currentTabs(): { id: string; label: string; active: boolean }[] {
    const activeId = this.cdpBridge.activeTargetId;
    const snap = activeId ? this.windowMonitor.getAllSnapshots().get(activeId) : undefined;
    const tabs = snap?.chatTabs ?? this.stateManager.getCurrentState().chatTabs;
    return tabs.map(tab => ({ id: tab.title, label: tab.title, active: tab.isActive }));
  }

  private async replyModels(userOpenId: string, msgId: string | undefined, query: string): Promise<void> {
    const result = await this.commandExecutor.getModelOptions(`qq_${Date.now().toString(36)}`);
    const items = modelOptionsFrom(result.data);
    const current = this.currentView()?.modelCurrent;
    if (!result.ok || items.length === 0) {
      await this.api.sendC2cText(
        userOpenId,
        `当前模型: ${current || '未知'}\n没能从 Cursor 读到模型列表。${result.error ?? ''}`.trim(),
        msgId,
      );
      return;
    }
    for (const item of items) {
      if (!item.active && current && item.label.toLowerCase() === current.toLowerCase()) item.active = true;
    }
    const pick = resolvePick(query, items, '模型');
    if (pick.type === 'error') {
      await this.api.sendC2cText(userOpenId, pick.text, msgId);
      return;
    }
    if (pick.type === 'chosen') {
      const set = await this.commandExecutor.setModel(`qq_${Date.now().toString(36)}`, pick.item.id);
      await this.api.sendC2cText(
        userOpenId,
        set.ok ? `已切换模型：${pick.item.label}` : `切换模型失败: ${set.error ?? 'unknown'}`,
        msgId,
      );
      return;
    }
    const shown = items.slice(0, 5);
    const buttons = shown.map((item, index) => ({
      id: this.registry.put({ cmd: 'model', modelId: item.id, label: item.label }),
      label: `${index + 1}. ${item.label}`.slice(0, 20),
      style: item.active ? 1 as const : 0 as const,
    }));
    const extra = items.length > shown.length ? `\n按钮只列出前 ${shown.length} 个。其余请发送 /model <序号或名称>。` : '';
    await this.sendButtons(
      userOpenId,
      withDoHints(`模型\n${formatPickList(items)}${extra}\n发送 /model <序号或名称> 切换。读取列表时会在 Cursor 里短暂打开模型菜单。`, buttons),
      buttons,
      msgId,
    );
  }

  private currentView(): {
    connected: boolean;
    windowTitle: string;
    agentStatus: string;
    agentActivityText: string | null;
    modeCurrent: string;
    modelCurrent: string;
    modeAvailable: ModeInfo['available'];
    pendingApprovals: Approval[];
    questionnaire: CursorState['questionnaire'];
    plans: ReturnType<typeof plansFromMessages>;
  } | null {
    const activeId = this.cdpBridge.activeTargetId;
    const snap = activeId ? this.windowMonitor.getAllSnapshots().get(activeId) : undefined;
    if (snap) {
      return {
        connected: true,
        windowTitle: snap.windowTitle,
        agentStatus: snap.agentStatus,
        agentActivityText: snap.agentActivityText,
        modeCurrent: snap.mode?.current ?? '',
        modelCurrent: snap.model?.current ?? '',
        modeAvailable: snap.mode?.available ?? [],
        pendingApprovals: snap.pendingApprovals,
        questionnaire: snap.questionnaire,
        plans: plansFromMessages(snap.messages),
      };
    }
    const state = this.stateManager.getCurrentState();
    if (!state.connected && !activeId) return null;
    return viewFromState(state);
  }
}

function viewFromState(state: CursorState): {
  connected: boolean;
  windowTitle: string;
  agentStatus: string;
  agentActivityText: string | null;
  modeCurrent: string;
  modelCurrent: string;
  modeAvailable: ModeInfo['available'];
  pendingApprovals: Approval[];
  questionnaire: CursorState['questionnaire'];
  plans: ReturnType<typeof plansFromMessages>;
} {
  const win = state.windows.find(w => w.id === state.activeWindowId);
  return {
    connected: state.connected,
    windowTitle: win?.title ?? '',
    agentStatus: state.agentStatus,
    agentActivityText: state.agentActivityText,
    modeCurrent: state.mode?.current ?? '',
    modelCurrent: state.model?.current ?? '',
    modeAvailable: state.mode?.available ?? [],
    pendingApprovals: state.pendingApprovals,
    questionnaire: state.questionnaire,
    plans: plansFromMessages(state.messages),
  };
}
