import { join } from 'path';
import { createLarkChannel, LoggerLevel, type LarkChannel, type CardActionEvent, type NormalizedMessage } from '@larksuiteoapi/node-sdk';
import type { Transport } from '../types.js';
import type { FeishuConfig, CursorState, ModeInfo } from '../../types.js';
import type { CommandExecutor } from '../../command-executor.js';
import type { CDPBridge } from '../../cdp-bridge.js';
import type { StateManager } from '../../state-manager.js';
import type { WindowMonitor } from '../../window-monitor.js';
import { FeishuAuthStore } from './auth-store.js';
import { BindTokenStore } from './bind-token.js';
import { writeBindArtifacts } from './bind-artifacts.js';
import { FeishuSessionStore } from './session-router.js';
import { ActionRegistry, actionResultText, parseCardValue, runCardCommand } from './actions.js';
import { FeishuMessageTracker } from './message-tracker.js';
import { handleInboundText } from './inbound.js';
import { renderHistory } from './history.js';
import { formatPickCard, sentToWindow } from './formatter.js';
import { modelOptionsFrom, resolvePick } from '../pick.js';
import { setTransportLink } from '../../transport-status.js';
import { pushWindowToChat, feishuEditsAreLimited, type FeishuSender, type PushView } from './sync.js';

const PUSH_DEBOUNCE_MS = 800;
const BIND_CHECK_MS = 5_000;

export class FeishuTransport implements Transport {
  readonly name = 'feishu';

  private channel: LarkChannel | null = null;
  private readonly auth: FeishuAuthStore;
  private readonly bind: BindTokenStore;
  private readonly sessions: FeishuSessionStore;
  private readonly tracker: FeishuMessageTracker;
  private readonly registry = new ActionRegistry();
  private bindTimer: ReturnType<typeof setInterval> | null = null;
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private lastBindToken = '';
  private pushing = false;
  private pushQueued = false;
  private stopped = false;
  private readonly onWindowUpdate = (): void => {
    this.schedulePush();
  };

  constructor(
    private readonly config: FeishuConfig,
    private readonly dataDir: string,
    private readonly windowMonitor: WindowMonitor,
    private readonly stateManager: StateManager,
    private readonly commandExecutor: CommandExecutor,
    private readonly cdpBridge: CDPBridge,
  ) {
    this.auth = new FeishuAuthStore(join(dataDir, 'feishu-auth.json'), config.preRegisteredUsers);
    this.bind = new BindTokenStore(config.appId);
    this.sessions = new FeishuSessionStore(join(dataDir, 'feishu-sessions.json'));
    this.tracker = new FeishuMessageTracker(join(dataDir, 'feishu-messages.json'));
  }

  get registeredUsers(): { openId: string; name?: string }[] {
    return this.auth.list();
  }

  async start(): Promise<void> {
    setTransportLink('feishu', 'starting', '正在连接飞书…');
    await this.persistBind(true);
    this.bindTimer = setInterval(() => {
      void this.persistBind(false);
    }, BIND_CHECK_MS);

    const channel = createLarkChannel({
      appId: this.config.appId,
      appSecret: this.config.appSecret,
      transport: 'websocket',
      loggerLevel: LoggerLevel.info,
      policy: {
        dmMode: 'open',
        requireMention: false,
      },
    });
    this.channel = channel;
    channel.on('message', (msg) => {
      void this.onMessage(msg);
    });
    channel.on('cardAction', (evt) => {
      void this.onCardAction(evt);
    });
    channel.on('error', (err) => {
      console.error(`[feishu] ${err.code}: ${err.message}`);
      setTransportLink('feishu', 'error', err.message || '长连接出错');
    });
    channel.on('reconnecting', () => {
      console.warn('[feishu] WebSocket reconnecting');
      setTransportLink('feishu', 'starting', '正在重新连接飞书…');
    });
    channel.on('reconnected', () => {
      console.log('[feishu] WebSocket reconnected');
      setTransportLink('feishu', 'ready', '长连接已重新连上');
    });

    await channel.connect();
    this.windowMonitor.on('window:update', this.onWindowUpdate);
    const challenge = this.bind.current();
    setTransportLink('feishu', 'ready', '长连接已就绪。现在可以在飞书控制台保存「使用长连接接收事件」。');
    console.log('[feishu] Long connection ready');
    console.log(`[feishu] Open the bot: ${challenge.appLink || '(set FEISHU_APP_ID)'}`);
    console.log(`[feishu] Bind command: ${challenge.command}`);
    if (this.auth.list().length > 0) {
      console.log(`[feishu] Allowed users: ${this.auth.list().map(u => u.name || u.openId).join(', ')}`);
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.bindTimer) clearInterval(this.bindTimer);
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.windowMonitor.off('window:update', this.onWindowUpdate);
    if (this.channel) {
      await this.channel.disconnect();
      this.channel = null;
    }
  }

  private sender(): FeishuSender | null {
    const channel = this.channel;
    if (!channel) return null;
    return {
      sendText: async (chatId, text) => (await channel.send(chatId, { text })).messageId,
      sendCard: async (chatId, card) => (await channel.send(chatId, { card })).messageId,
      editText: (messageId, text) => channel.editMessage(messageId, text),
      updateCard: (messageId, card) => channel.updateCard(messageId, card),
    };
  }

  private async persistBind(force: boolean): Promise<void> {
    const challenge = this.bind.current();
    if (!force && challenge.token === this.lastBindToken) return;
    this.lastBindToken = challenge.token;
    try {
      await writeBindArtifacts(this.dataDir, challenge);
    } catch (err) {
      console.warn(`[feishu] Could not write bind QR: ${err instanceof Error ? err.message : err}`);
    }
  }

  unbindUser(openId: string): { removed: boolean; restoredOnRestart: boolean } {
    const removed = this.auth.revoke(openId);
    if (removed) this.sessions.forgetOpenId(openId);
    return { removed, restoredOnRestart: this.auth.isPreRegistered(openId) };
  }

  private async onMessage(msg: NormalizedMessage): Promise<void> {
    if (this.stopped || msg.senderId === 'unknown') return;
    const chatType = msg.chatType === 'group' ? 'group' : 'p2p';
    const view = this.currentView();
    const replies = handleInboundText({
      openId: msg.senderId,
      chatId: msg.chatId,
      chatType,
      text: msg.content,
      senderName: msg.senderName,
    }, {
      isAllowed: (openId) => this.auth.isAllowed(openId),
      tryBind: (openId, token, name) => {
        if (!this.bind.consume(token)) return false;
        this.auth.register(openId, name);
        void this.persistBind(true);
        console.log(`[feishu] Bound ${name || openId}`);
        return true;
      },
      unbind: (openId) => this.unbindUser(openId).removed,
      sessions: this.sessions,
      activeWindowId: this.cdpBridge.activeTargetId,
      status: {
        connected: view?.connected ?? false,
        windowTitle: view?.windowTitle,
        agentStatus: view?.agentStatus,
        activity: view?.agentActivityText,
        mode: view?.modeCurrent,
        model: view?.modelCurrent,
        editLimited: feishuEditsAreLimited(),
      },
      pendingApprovals: view?.pendingApprovals ?? [],
      mode: view ? {
        current: view.modeCurrent,
        available: view.modeAvailable,
      } : null,
      registry: this.registry,
      windows: this.cdpBridge.windows.map(win => ({
        id: win.id,
        label: win.title?.trim() || win.id.slice(0, 8),
        active: win.id === this.cdpBridge.activeTargetId,
      })),
      tabs: this.currentTabs(),
    });

    const sender = this.sender();
    if (!sender) return;
    for (const reply of replies) {
      try {
        if (reply.kind === 'text') {
          await sender.sendText(msg.chatId, reply.text);
        } else if (reply.kind === 'card') {
          await sender.sendCard(msg.chatId, reply.card);
        } else if (reply.kind === 'switch-window') {
          try {
            await this.cdpBridge.switchWindow(reply.windowId);
            await sender.sendText(msg.chatId, `已切换到窗口：${reply.title}`);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            await sender.sendText(msg.chatId, `切换窗口失败: ${message}`);
          }
        } else if (reply.kind === 'switch-tab') {
          const result = await this.commandExecutor.switchTab(`fs_${Date.now().toString(36)}`, reply.title);
          await sender.sendText(
            msg.chatId,
            result.ok ? `已切换到标签：${reply.title}` : `切换标签失败: ${result.error ?? 'unknown'}`,
          );
        } else if (reply.kind === 'models') {
          await this.replyModels(sender, msg.chatId, reply.query);
        } else if (reply.kind === 'history') {
          await this.replyHistory(sender, msg.chatId, reply.count);
        } else {
          const result = await this.commandExecutor.sendMessage(`fs_${Date.now().toString(36)}`, reply.text);
          const where = sentToWindow(view?.windowTitle);
          await sender.sendText(msg.chatId, result.ok ? where : `发送失败: ${result.error ?? 'unknown'}`);
        }
      } catch (err) {
        console.error(`[feishu] reply failed: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  private onCardAction(evt: CardActionEvent): void {
    if (!this.auth.isAllowed(evt.operator.openId)) {
      const sender = this.sender();
      if (sender) {
        void sender.sendText(evt.chatId, '未绑定，不能操作。').catch(() => undefined);
      }
      return;
    }
    const action = parseCardValue(evt.action.value, this.registry);
    if (!action) return;
    // Ack the card callback immediately; CDP clicks can exceed Feishu's 3s window.
    void runCardCommand(action, this.commandExecutor, {
      switchWindow: (windowId) => this.cdpBridge.switchWindow(windowId),
    }).then(async (result) => {
      const sender = this.sender();
      if (!sender) return;
      const title = action.cmd === 'window' ? undefined : this.currentView()?.windowTitle;
      await sender.sendText(evt.chatId, actionResultText(action, result.ok, result.error, title));
    }).catch((err) => {
      console.error(`[feishu] card action failed: ${err instanceof Error ? err.message : err}`);
    });
  }

  private schedulePush(): void {
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      void this.pushActive();
    }, PUSH_DEBOUNCE_MS);
  }

  private async pushActive(): Promise<void> {
    if (this.stopped) return;
    if (this.pushing) {
      this.pushQueued = true;
      return;
    }
    const sender = this.sender();
    const view = this.currentView();
    if (!sender || !view) return;
    const chats = this.sessions.listP2P().filter(session => this.auth.isAllowed(session.openId));
    if (chats.length === 0) return;
    this.pushing = true;
    try {
      for (const session of chats) {
        await pushWindowToChat(sender, this.tracker, this.registry, session.chatId, view);
      }
    } catch (err) {
      console.error(`[feishu] push failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      this.pushing = false;
      if (this.pushQueued && !this.stopped) {
        this.pushQueued = false;
        this.schedulePush();
      }
    }
  }

  private currentTabs(): { id: string; label: string; active: boolean }[] {
    const activeId = this.cdpBridge.activeTargetId;
    const snap = activeId ? this.windowMonitor.getAllSnapshots().get(activeId) : undefined;
    const tabs = snap?.chatTabs ?? this.stateManager.getCurrentState().chatTabs;
    return tabs.map(tab => ({
      id: tab.title,
      label: tab.title,
      active: tab.isActive,
    }));
  }

  private async replyHistory(sender: FeishuSender, chatId: string, count: number): Promise<void> {
    let messages = this.currentView()?.messages ?? [];
    const readable = messages.filter(el => el.type !== 'loading').length;
    if (readable < count && this.cdpBridge.activeTargetId) {
      const before = this.stateManager.generation;
      const times = Math.min(Math.ceil(count / 15), 10);
      try {
        await this.commandExecutor.scrollChatUp(`fs_${Date.now().toString(36)}`, times);
        await this.waitForGeneration(before, 4000);
        messages = this.currentView()?.messages ?? messages;
      } catch (err) {
        console.warn(`[feishu] history scroll failed: ${err instanceof Error ? err.message : err}`);
      }
      try {
        await this.commandExecutor.scrollChatToBottom(`fs_${Date.now().toString(36)}`);
      } catch {
        /* the transcript was already read */
      }
    }
    const view = this.currentView();
    const rendered = renderHistory(messages, count, view?.windowTitle ?? '');
    await sender.sendText(chatId, rendered.intro);
    for (const chunk of rendered.chunks) {
      await sender.sendText(chatId, chunk);
    }
  }

  private waitForGeneration(before: number, maxWaitMs: number): Promise<void> {
    const deadline = Date.now() + maxWaitMs;
    return new Promise(resolve => {
      const tick = (): void => {
        if (this.stateManager.generation > before || Date.now() >= deadline) {
          resolve();
          return;
        }
        setTimeout(tick, 200);
      };
      tick();
    });
  }

  private async replyModels(sender: FeishuSender, chatId: string, query: string): Promise<void> {
    const result = await this.commandExecutor.getModelOptions(`fs_${Date.now().toString(36)}`);
    const items = modelOptionsFrom(result.data);
    const current = this.currentView()?.modelCurrent;
    if (!result.ok || items.length === 0) {
      await sender.sendText(chatId, `当前模型: ${current || '未知'}\n没能从 Cursor 读到模型列表。${result.error ?? ''}`.trim());
      return;
    }
    for (const item of items) {
      if (!item.active && current && item.label.toLowerCase() === current.toLowerCase()) item.active = true;
    }
    const pick = resolvePick(query, items, '模型');
    if (pick.type === 'error') {
      await sender.sendText(chatId, pick.text);
      return;
    }
    if (pick.type === 'chosen') {
      const set = await this.commandExecutor.setModel(`fs_${Date.now().toString(36)}`, pick.item.id);
      await sender.sendText(
        chatId,
        set.ok ? `已切换模型：${pick.item.label}` : `切换模型失败: ${set.error ?? 'unknown'}`,
      );
      return;
    }
    await sender.sendCard(chatId, formatPickCard(
      '切换模型',
      items,
      this.registry,
      item => ({ cmd: 'model', modelId: item.id, label: item.label }),
      '点按钮，或发送 /model <序号或名称>。读取列表时会在 Cursor 里短暂打开模型菜单。',
    ));
  }

  private currentView(): (PushView & { modeAvailable: ModeInfo['available'] }) | null {
    const activeId = this.cdpBridge.activeTargetId;
    const snap = activeId ? this.windowMonitor.getAllSnapshots().get(activeId) : undefined;
    if (snap) {
      return {
        windowTitle: snap.windowTitle,
        connected: true,
        agentStatus: snap.agentStatus,
        agentActivityText: snap.agentActivityText,
        modeCurrent: snap.mode?.current ?? '',
        modelCurrent: snap.model?.current ?? '',
        modeAvailable: snap.mode?.available ?? [],
        messages: snap.messages,
        pendingApprovals: snap.pendingApprovals,
        questionnaire: snap.questionnaire,
      };
    }
    const state = this.stateManager.getCurrentState();
    if (!state.connected && !activeId) return null;
    return viewFromState(state);
  }
}

function viewFromState(state: CursorState): PushView & { modeAvailable: ModeInfo['available'] } {
  const win = state.windows.find(w => w.id === state.activeWindowId);
  return {
    windowTitle: win?.title ?? '',
    connected: state.connected,
    agentStatus: state.agentStatus,
    agentActivityText: state.agentActivityText,
    modeCurrent: state.mode?.current ?? '',
    modelCurrent: state.model?.current ?? '',
    modeAvailable: state.mode?.available ?? [],
    messages: state.messages,
    pendingApprovals: state.pendingApprovals,
    questionnaire: state.questionnaire,
  };
}
