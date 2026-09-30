import type { Approval, ModeInfo, PlanBlock, Questionnaire } from '../../types.js';
import type { ActionRegistry, StoredAction } from '../feishu/actions.js';
import { formatStatusText } from '../feishu/formatter.js';
import type { FeishuSessionStore } from '../feishu/session-router.js';
import { formatPickList, resolvePick, type PickItem } from '../pick.js';
import { callbackKeyboard, withDoHints, type QqButton } from './keyboard.js';
import { promptSections } from './prompts.js';

export interface QqInbound {
  openId: string;
  text: string;
}

export interface QqInboundDeps {
  isAllowed(openId: string): boolean;
  tryBind(openId: string, token: string): boolean;
  unbind(openId: string): boolean;
  sessions: FeishuSessionStore;
  activeWindowId: string;
  status: {
    connected: boolean;
    windowTitle?: string;
    agentStatus?: string;
    activity?: string | null;
    mode?: string;
    model?: string;
  };
  pendingApprovals?: Approval[];
  questionnaire?: Questionnaire | null;
  plans?: PlanBlock[];
  /** True when a prompt was waiting but QQ's passive-reply window had already closed. */
  approvalNotPushed?: boolean;
  mode: ModeInfo | null;
  registry: ActionRegistry;
  takeAction(id: string): StoredAction | null;
  windows?: PickItem[];
  tabs?: PickItem[];
}

export type QqReply =
  | { kind: 'text'; text: string }
  | { kind: 'buttons'; text: string; buttons: QqButton[] }
  | { kind: 'cursor'; text: string; windowId: string }
  | { kind: 'action'; action: StoredAction }
  | { kind: 'switch-window'; windowId: string; title: string }
  | { kind: 'switch-tab'; title: string }
  | { kind: 'models'; query: string };

const HELP = [
  'CursorRemote QQ',
  '/bind <6位短码> — 在私聊里绑定这台电脑（短码在 Setup 面板，约 60 秒刷新）',
  '/unbind — 解除绑定',
  '/status — 当前 Agent 状态，含待审批、问卷、计划和 /do 编号',
  '/windows — 列出窗口。/window <序号或名称> 切换后再发消息',
  '/tabs — 列出当前窗口的对话标签。/tab <序号或名称> 切换',
  '/model — 列出模型。/model <序号或名称> 切换',
  '/mode — 切换模式',
  '/help — 帮助',
  '其他文本会发给当前 Cursor 窗口。',
  'QQ 主动推送有配额，审批按钮会尽量挂在你刚发来的消息上。',
].join('\n');

export function normalizeQqText(content: string): string {
  return content.replace(/^(?:<@!\d+>\s*)+/, '').trim();
}

export function handleQqText(input: QqInbound, deps: QqInboundDeps): QqReply[] {
  const text = normalizeQqText(input.text);
  if (!text) return [];

  const done = text.match(/^\/do(?:@\S+)?\s+([a-z0-9]+)\s*$/i);
  if (done) {
    if (!deps.isAllowed(input.openId)) {
      return [{ kind: 'text', text: '还未绑定。在 QQ 里打开机器人后发送 /bind <6位短码>。' }];
    }
    const action = deps.takeAction(done[1]);
    if (!action) return [{ kind: 'text', text: '这个按钮已经失效，请再发 /status 或等新的审批。' }];
    return [{ kind: 'action', action }];
  }

  const bind = text.match(/^\/bind(?:@\S+)?\s+(\d{6})\s*$/i);
  if (bind) {
    if (!deps.tryBind(input.openId, bind[1])) {
      return [{ kind: 'text', text: '绑定码无效或已过期。请在 CursorRemote Setup 的 QQ 页查看新短码。' }];
    }
    deps.sessions.upsert({ chatId: input.openId, openId: input.openId, chatType: 'p2p' });
    return [{ kind: 'text', text: '已绑定。在这个私聊里发消息即可控制当前 Cursor 窗口。' }];
  }

  if (text === '/unbind') {
    if (!deps.isAllowed(input.openId)) {
      return [{ kind: 'text', text: '当前账号没有绑定。' }];
    }
    deps.unbind(input.openId);
    return [{ kind: 'text', text: '已解除绑定。需要再次控制时重新发送 /bind。写在允许名单里的账号会在中继重启后重新加入。' }];
  }

  if (!deps.isAllowed(input.openId)) {
    return [{ kind: 'text', text: '还未绑定这台电脑。打开 CursorRemote Setup 的 QQ 页，在机器人私聊里发送 /bind <6位短码>。' }];
  }

  if (text === '/help' || text === '/start') return [{ kind: 'text', text: HELP }];
  if (text === '/status') return [{ kind: 'text', text: qqStatusText(deps) }];
  const windowsCmd = text.match(/^\/windows?(?:@\S+)?(?:\s+([\s\S]+))?$/i);
  if (windowsCmd) return [pickQq(windowsCmd[1], deps.windows ?? [], '窗口', '/window', deps, item => ({
    cmd: 'window',
    windowId: item.id,
    label: item.label,
  }), 'switch-window')];
  const tabsCmd = text.match(/^\/tabs?(?:@\S+)?(?:\s+([\s\S]+))?$/i);
  if (tabsCmd) return [pickQq(tabsCmd[1], deps.tabs ?? [], '标签', '/tab', deps, item => ({
    cmd: 'tab',
    tabTitle: item.label,
    label: item.label,
  }), 'switch-tab')];
  const modelCmd = text.match(/^\/model(?:@\S+)?(?:\s+([\s\S]+))?$/i);
  if (modelCmd) return [{ kind: 'models', query: (modelCmd[1] ?? '').trim() }];
  if (text === '/mode') return [modeReply(deps)];
  if (text.startsWith('/')) return [{ kind: 'text', text: `未知命令。\n${HELP}` }];

  deps.sessions.upsert({ chatId: input.openId, openId: input.openId, chatType: 'p2p' });
  if (!deps.activeWindowId) {
    return [{ kind: 'text', text: 'Cursor 尚未连接。请用 --remote-debugging-port=9222 启动后再试。' }];
  }
  return [{ kind: 'cursor', text, windowId: deps.activeWindowId }];
}

function qqStatusText(deps: QqInboundDeps): string {
  const lines = [formatStatusText(deps.status)];
  const sections = promptSections({
    approvals: deps.pendingApprovals,
    questionnaire: deps.questionnaire,
    plans: deps.plans,
  });
  if (sections.length === 0) {
    if (deps.approvalNotPushed) lines.push('', '上一轮待确认操作没能推送：QQ 只允许在你刚发过消息的几分钟内主动回复。');
    return lines.join('\n');
  }
  lines.push('', '待确认（也可直接发送下面的命令）：');
  for (const section of sections) {
    lines.push(`- ${section.heading}`);
    for (const action of section.actions) {
      lines.push(`  /do ${deps.registry.put(action)}  ${action.label}`);
    }
  }
  if (deps.approvalNotPushed) {
    lines.push('这些操作没能自动推送。发送任意文字后，按钮会挂到你这条消息上。');
  }
  return lines.join('\n');
}

function pickQq(
  query: string | undefined,
  items: PickItem[],
  noun: string,
  command: string,
  deps: QqInboundDeps,
  actionFor: (item: PickItem) => StoredAction,
  chosen: 'switch-window' | 'switch-tab',
): QqReply {
  const pick = resolvePick(query, items, noun);
  if (pick.type === 'error') return { kind: 'text', text: pick.text };
  if (pick.type === 'chosen') {
    if (chosen === 'switch-tab' && items.filter(item => item.label === pick.item.label).length > 1) {
      return { kind: 'text', text: `有多个同名标签「${pick.item.label}」，无法只按名称点击。\n${formatPickList(items)}` };
    }
    if (chosen === 'switch-window') return { kind: 'switch-window', windowId: pick.item.id, title: pick.item.label };
    return { kind: 'switch-tab', title: pick.item.label };
  }
  if (items.length === 0) {
    return { kind: 'text', text: noun === '窗口' ? '没有 Cursor 窗口。请确认调试端口已打开。' : '当前窗口没有对话标签。' };
  }
  const shown = items.slice(0, 5);
  const buttons = shown.map((item, index) => ({
    id: deps.registry.put(actionFor(item)),
    label: `${index + 1}. ${item.label}`.slice(0, 20),
    style: item.active ? 1 as const : 0 as const,
  }));
  const extra = items.length > shown.length
    ? `\n按钮只列出前 ${shown.length} 个。其余请发送 ${command} <序号或名称>。`
    : '';
  return {
    kind: 'buttons',
    text: withDoHints(`${noun}\n${formatPickList(items)}${extra}\n发送 ${command} <序号或名称> 切换。`, buttons),
    buttons,
  };
}

function modeReply(deps: QqInboundDeps): QqReply {
  if (!deps.mode || deps.mode.available.length === 0) {
    return { kind: 'text', text: '还没有读到 Cursor 的模式信息。' };
  }
  const buttons = deps.mode.available.slice(0, 6).map(item => ({
    id: deps.registry.put({ cmd: 'mode', modeId: item.id, label: item.label || item.id }),
    label: item.label || item.id,
    style: item.id === deps.mode?.current ? 1 as const : 0 as const,
  }));
  return {
    kind: 'buttons',
    text: withDoHints(`当前模式: ${deps.mode.current || 'unknown'}`, buttons),
    buttons,
  };
}

export function keyboardFor(buttons: QqButton[]): object {
  return callbackKeyboard(buttons);
}
