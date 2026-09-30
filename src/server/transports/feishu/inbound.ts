import type { Approval, ModeInfo } from '../../types.js';
import type { ActionRegistry } from './actions.js';
import { formatModeCard, formatPickCard, formatStatusText } from './formatter.js';
import { formatPickList, resolvePick, type PickItem } from '../pick.js';
import { parseHistoryCount } from './history.js';
import { routeSession, type FeishuChatType, type FeishuSessionStore } from './session-router.js';

export interface InboundText {
  openId: string;
  chatId: string;
  chatType: FeishuChatType;
  text: string;
  senderName?: string;
}

export interface InboundDeps {
  isAllowed(openId: string): boolean;
  tryBind(openId: string, token: string, name?: string): boolean;
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
    editLimited?: boolean;
  };
  pendingApprovals?: Approval[];
  mode: ModeInfo | null;
  registry: ActionRegistry;
  windows?: PickItem[];
  tabs?: PickItem[];
}

export type InboundReply =
  | { kind: 'text'; text: string }
  | { kind: 'card'; card: object }
  | { kind: 'cursor'; text: string; windowId: string }
  | { kind: 'switch-window'; windowId: string; title: string }
  | { kind: 'switch-tab'; title: string }
  | { kind: 'models'; query: string }
  | { kind: 'history'; count: number };

const HELP = [
  'CursorRemote 飞书',
  '/bind <6位短码> — 在私聊里绑定这台电脑（短码在 CursorRemote Setup 面板）',
  '/unbind — 解除绑定',
  '/status — 当前 Agent 状态',
  '/history [条数] — 回看更早的对话（默认 30，最多 80）。平时只推送最近十几条',
  '/windows — 列出窗口。/window <序号或名称> 切换后再发消息',
  '/tabs — 列出当前窗口的对话标签。/tab <序号或名称> 切换',
  '/model — 列出模型。/model <序号或名称> 切换',
  '/mode — 切换模式',
  '/help — 帮助',
  '其他文本会作为 prompt 发给当前 Cursor 窗口。',
].join('\n');

export function stripLeadingMentions(text: string): string {
  return text.replace(/^(?:@_user_\d+\s*|@\S+\s*)+/, '').trim();
}

export function extractPlainText(content: string): string {
  const trimmed = content.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as { text?: string };
      if (typeof parsed.text === 'string') return stripLeadingMentions(parsed.text);
    } catch {
      /* not JSON */
    }
  }
  return stripLeadingMentions(trimmed);
}

export function handleInboundText(input: InboundText, deps: InboundDeps): InboundReply[] {
  const text = extractPlainText(input.text);
  if (!text) return [];

  const bind = text.match(/^\/bind(?:@\S+)?\s+(\d{6})\s*$/i);
  if (bind) {
    if (input.chatType !== 'p2p') {
      return [{ kind: 'text', text: '群聊不能控制 Cursor，也不会消耗绑定码。请私聊机器人发送 /bind <6位短码>。' }];
    }
    const ok = deps.tryBind(input.openId, bind[1], input.senderName);
    if (!ok) {
      return [{ kind: 'text', text: '绑定码无效或已过期。请在 CursorRemote Setup 面板查看新的 6 位短码（约 60 秒刷新）。' }];
    }
    if (input.chatType === 'p2p') {
      deps.sessions.upsert({ chatId: input.chatId, openId: input.openId, chatType: 'p2p' });
    }
    const extra = '已绑定。之后在这个私聊里直接发消息即可控制当前 Cursor 窗口。';
    return [{ kind: 'text', text: extra }];
  }

  if (text === '/unbind') {
    if (!deps.isAllowed(input.openId)) {
      return [{ kind: 'text', text: '当前账号没有绑定。' }];
    }
    deps.unbind(input.openId);
    return [{ kind: 'text', text: '已解除绑定。需要再次控制时，在私聊里重新发送 /bind。写在允许名单里的账号会在中继重启后重新加入。' }];
  }

  if (!deps.isAllowed(input.openId)) {
    return [{ kind: 'text', text: '还未绑定这台电脑。打开 CursorRemote Setup 的飞书页，扫码进入机器人后发送 /bind <6位短码>。' }];
  }

  if (text === '/help' || text === '/start') {
    return [{ kind: 'text', text: HELP }];
  }

  if (text === '/status') {
    return [{ kind: 'text', text: statusText(deps) }];
  }

  const historyCmd = text.match(/^\/history(?:@\S+)?(?:\s+(\d+))?\s*$/i);
  if (historyCmd) {
    return [privateOnly(input) ?? { kind: 'history', count: parseHistoryCount(historyCmd[1]) }];
  }

  const windowsCmd = text.match(/^\/windows?(?:@\S+)?(?:\s+([\s\S]+))?$/i);
  if (windowsCmd) return [privateOnly(input) ?? pickWindows(windowsCmd[1], deps)];

  const tabsCmd = text.match(/^\/tabs?(?:@\S+)?(?:\s+([\s\S]+))?$/i);
  if (tabsCmd) return [privateOnly(input) ?? pickTabs(tabsCmd[1], deps)];

  const modelCmd = text.match(/^\/model(?:@\S+)?(?:\s+([\s\S]+))?$/i);
  if (modelCmd) return [privateOnly(input) ?? { kind: 'models', query: (modelCmd[1] ?? '').trim() }];

  if (text === '/mode') {
    if (!deps.mode) return [{ kind: 'text', text: '还没有读到 Cursor 的模式信息。' }];
    return [{ kind: 'card', card: formatModeCard(deps.mode, deps.registry) }];
  }

  if (text.startsWith('/')) {
    return [{ kind: 'text', text: `未知命令。\n${HELP}` }];
  }

  if (input.chatType === 'p2p') {
    deps.sessions.upsert({ chatId: input.chatId, openId: input.openId, chatType: 'p2p' });
  }

  const route = routeSession({ chatType: input.chatType }, deps.activeWindowId);
  if (!route.ok || !route.windowId) {
    return [{ kind: 'text', text: route.error ?? '无法路由到 Cursor。' }];
  }
  return [{ kind: 'cursor', text, windowId: route.windowId }];
}

function statusText(deps: InboundDeps): string {
  const lines = [formatStatusText(deps.status)];
  const pending = deps.pendingApprovals ?? [];
  if (pending.length > 0) {
    lines.push('', '待审批:');
    for (const approval of pending) {
      const actions = approval.actions.map(action => action.label).join(' / ');
      lines.push(`- ${approval.description}${actions ? `（${actions}）` : ''}`);
    }
    lines.push('点卡片上的按钮即可处理。');
  }
  return lines.join('\n');
}

function privateOnly(input: InboundText): InboundReply | null {
  if (input.chatType === 'p2p') return null;
  return { kind: 'text', text: '请在私聊里切换窗口、标签或模型。' };
}

function pickWindows(query: string | undefined, deps: InboundDeps): InboundReply {
  const items = deps.windows ?? [];
  const pick = resolvePick(query, items, '窗口');
  if (pick.type === 'error') return { kind: 'text', text: pick.text };
  if (pick.type === 'chosen') {
    return { kind: 'switch-window', windowId: pick.item.id, title: pick.item.label };
  }
  if (items.length === 0) return { kind: 'text', text: '没有 Cursor 窗口。请确认调试端口已打开。' };
  return {
    kind: 'card',
    card: formatPickCard('切换窗口', items, deps.registry, item => ({
      cmd: 'window',
      windowId: item.id,
      label: item.label,
    }), '点按钮，或发送 /window <序号或名称>。之后的消息会发到这个窗口。'),
  };
}

function pickTabs(query: string | undefined, deps: InboundDeps): InboundReply {
  const items = deps.tabs ?? [];
  const pick = resolvePick(query, items, '标签');
  if (pick.type === 'error') return { kind: 'text', text: pick.text };
  if (pick.type === 'chosen') {
    if (items.filter(item => item.label === pick.item.label).length > 1) {
      return { kind: 'text', text: `有多个同名标签「${pick.item.label}」，无法只按名称点击。\n${formatPickList(items)}` };
    }
    return { kind: 'switch-tab', title: pick.item.label };
  }
  if (items.length === 0) return { kind: 'text', text: '当前窗口没有对话标签。' };
  return {
    kind: 'card',
    card: formatPickCard('切换标签', items, deps.registry, item => ({
      cmd: 'tab',
      tabTitle: item.label,
      label: item.label,
    }), '点按钮，或发送 /tab <序号或名称>。'),
  };
}
