import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { BindTokenStore, isBindTokenValid, buildBindChallenge, BIND_TOKEN_TTL_MS } from '../src/server/transports/feishu/bind-token.js';
import { routeSession, FeishuSessionStore } from '../src/server/transports/feishu/session-router.js';
import { ActionRegistry, parseCardValue, buttonValue } from '../src/server/transports/feishu/actions.js';
import { handleInboundText } from '../src/server/transports/feishu/inbound.js';
import { FeishuAuthStore } from '../src/server/transports/feishu/auth-store.js';
import { formatApprovalCard, formatElementText, formatStatusText, sentToWindow, truncate } from '../src/server/transports/feishu/formatter.js';
import { FeishuMessageTracker } from '../src/server/transports/feishu/message-tracker.js';
import { pushWindowToChat, isFeishuEditRateLimit, type FeishuSender, type PushView } from '../src/server/transports/feishu/sync.js';
import type { Approval, ChatElement } from '../src/server/types.js';

describe('feishu bind token', () => {
  it('accepts the current code and rejects it after consume', () => {
    let now = 1_000;
    let draw = 0;
    const store = new BindTokenStore('cli_test', () => now, () => {
      draw += 1;
      return draw / 10;
    });
    const token = store.current().token;
    assert.equal(store.current().command, `/bind ${token}`);
    assert.equal(store.current().appLink, 'https://applink.feishu.cn/client/bot/open?appId=cli_test');
    assert.equal(store.consume(token), true);
    assert.equal(store.consume(token), false);
  });

  it('expires after 60 seconds', () => {
    const challenge = buildBindChallenge('cli_test', '123456', 0);
    assert.equal(challenge.expiresAt, BIND_TOKEN_TTL_MS);
    assert.equal(isBindTokenValid(challenge, '123456', BIND_TOKEN_TTL_MS), false);
    assert.equal(isBindTokenValid(challenge, '123456', BIND_TOKEN_TTL_MS - 1), true);
  });
});

describe('feishu session routing', () => {
  it('routes a private chat to the active window', () => {
    assert.deepEqual(routeSession({ chatType: 'p2p' }, 'win-1'), { ok: true, windowId: 'win-1' });
  });

  it('refuses group chats and a disconnected IDE', () => {
    const group = routeSession({ chatType: 'group' }, 'win-1');
    assert.equal(group.ok, false);
    const offline = routeSession({ chatType: 'p2p' }, '');
    assert.equal(offline.ok, false);
  });

  it('persists private chats', () => {
    const dir = mkdtempSync(join(tmpdir(), 'feishu-sessions-'));
    try {
      const store = new FeishuSessionStore(join(dir, 'sessions.json'));
      store.upsert({ chatId: 'oc_1', openId: 'ou_1', chatType: 'p2p' });
      store.upsert({ chatId: 'oc_2', openId: 'ou_2', chatType: 'group' });
      const reloaded = new FeishuSessionStore(join(dir, 'sessions.json'));
      assert.deepEqual(reloaded.listP2P().map(s => s.chatId), ['oc_1']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('feishu card actions', () => {
  it('round-trips a selector through a short id', () => {
    const registry = new ActionRegistry();
    const value = buttonValue(registry, {
      cmd: 'approve',
      selectorPath: '#workbench\\.parts\\.auxiliarybar button',
      approvalId: 'a1',
      label: 'Accept',
    });
    const parsed = parseCardValue(value, registry);
    assert.equal(parsed?.cmd, 'approve');
    assert.equal(parsed?.selectorPath, '#workbench\\.parts\\.auxiliarybar button');
  });

  it('keeps mode ids inline', () => {
    const registry = new ActionRegistry();
    const value = buttonValue(registry, { cmd: 'mode', modeId: 'agent' });
    assert.deepEqual(parseCardValue(value, registry), { cmd: 'mode', modeId: 'agent' });
  });
});

describe('feishu inbound', () => {
  function deps(overrides: Partial<Parameters<typeof handleInboundText>[1]> = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'feishu-inbound-'));
    const auth = new FeishuAuthStore(join(dir, 'auth.json'));
    const sessions = new FeishuSessionStore(join(dir, 'sessions.json'));
    const registry = new ActionRegistry();
    const base = {
      isAllowed: (openId: string) => auth.isAllowed(openId),
      tryBind: (openId: string, token: string, name?: string) => {
        if (token !== '123456') return false;
        auth.register(openId, name);
        return true;
      },
      unbind: (openId: string) => {
        const removed = auth.revoke(openId);
        if (removed) sessions.forgetOpenId(openId);
        return removed;
      },
      sessions,
      activeWindowId: 'win-1',
      status: { connected: true, windowTitle: 'demo', agentStatus: 'idle', activity: null, mode: 'Agent', model: 'gpt' },
      mode: { current: 'agent', available: [{ id: 'agent', label: 'Agent', icon: '' }] },
      registry,
      ...overrides,
    };
    return { dir, auth, sessions, deps: base };
  }

  it('binds a private chat and then forwards text to the active window', () => {
    const ctx = deps();
    try {
      const bound = handleInboundText({
        openId: 'ou_1', chatId: 'oc_1', chatType: 'p2p', text: '/bind 123456', senderName: 'Ada',
      }, ctx.deps);
      assert.equal(bound[0]?.kind, 'text');
      assert.equal(ctx.auth.isAllowed('ou_1'), true);
      assert.equal(ctx.sessions.listP2P()[0]?.chatId, 'oc_1');

      const sent = handleInboundText({
        openId: 'ou_1', chatId: 'oc_1', chatType: 'p2p', text: 'fix the tests',
      }, ctx.deps);
      assert.deepEqual(sent[0], { kind: 'cursor', text: 'fix the tests', windowId: 'win-1' });
    } finally {
      rmSync(ctx.dir, { recursive: true, force: true });
    }
  });

  it('rejects an expired code and unbound users', () => {
    const ctx = deps();
    try {
      const bad = handleInboundText({
        openId: 'ou_1', chatId: 'oc_1', chatType: 'p2p', text: '/bind 000000',
      }, ctx.deps);
      assert.match(bad[0] && bad[0].kind === 'text' ? bad[0].text : '', /无效或已过期/);

      const blocked = handleInboundText({
        openId: 'ou_1', chatId: 'oc_1', chatType: 'p2p', text: 'hello',
      }, ctx.deps);
      assert.match(blocked[0] && blocked[0].kind === 'text' ? blocked[0].text : '', /还未绑定/);
    } finally {
      rmSync(ctx.dir, { recursive: true, force: true });
    }
  });

  it('does not route group chats in phase 1', () => {
    const ctx = deps();
    try {
      ctx.auth.register('ou_1');
      const reply = handleInboundText({
        openId: 'ou_1', chatId: 'oc_g', chatType: 'group', text: 'hello',
      }, ctx.deps);
      assert.equal(reply[0]?.kind, 'text');
      assert.equal(ctx.sessions.listP2P().length, 0);
    } finally {
      rmSync(ctx.dir, { recursive: true, force: true });
    }
  });

  it('does not consume a bind code sent in a group', () => {
    const ctx = deps();
    try {
      const reply = handleInboundText({
        openId: 'ou_1', chatId: 'oc_g', chatType: 'group', text: '/bind 123456',
      }, ctx.deps);
      assert.match(reply[0] && reply[0].kind === 'text' ? reply[0].text : '', /群聊不能控制/);
      assert.equal(ctx.auth.isAllowed('ou_1'), false);
    } finally {
      rmSync(ctx.dir, { recursive: true, force: true });
    }
  });

  it('unbinds a private chat', () => {
    const ctx = deps();
    try {
      handleInboundText({
        openId: 'ou_1', chatId: 'oc_1', chatType: 'p2p', text: '/bind 123456',
      }, ctx.deps);
      const gone = handleInboundText({
        openId: 'ou_1', chatId: 'oc_1', chatType: 'p2p', text: '/unbind',
      }, ctx.deps);
      assert.match(gone[0] && gone[0].kind === 'text' ? gone[0].text : '', /已解除绑定/);
      assert.equal(ctx.auth.isAllowed('ou_1'), false);
      assert.equal(ctx.sessions.listP2P().length, 0);
    } finally {
      rmSync(ctx.dir, { recursive: true, force: true });
    }
  });

  it('writes Chinese status and lists pending approvals', () => {
    const ctx = deps({
      status: { connected: true, windowTitle: 'demo', agentStatus: 'waiting_approval', mode: 'Agent', model: 'gpt' },
      pendingApprovals: [{
        id: 'ap1',
        description: 'Run tests?',
        actions: [{ label: 'Accept', type: 'approve', selectorPath: '#ok' }],
      }],
    });
    try {
      ctx.auth.register('ou_1');
      const reply = handleInboundText({
        openId: 'ou_1', chatId: 'oc_1', chatType: 'p2p', text: '/status',
      }, ctx.deps);
      const text = reply[0] && reply[0].kind === 'text' ? reply[0].text : '';
      assert.match(text, /等待审批/);
      assert.match(text, /Run tests\?/);
      assert.match(text, /demo/);
    } finally {
      rmSync(ctx.dir, { recursive: true, force: true });
    }
  });

  it('lists windows and switches by number or name', () => {
    const ctx = deps({
      windows: [
        { id: 'win-1', label: 'alpha', active: true },
        { id: 'win-2', label: 'beta', active: false },
      ],
      tabs: [
        { id: 'Chat', label: 'Chat', active: true },
        { id: 'Plan', label: 'Plan', active: false },
      ],
    });
    try {
      ctx.auth.register('ou_1');
      const listed = handleInboundText({
        openId: 'ou_1', chatId: 'oc_1', chatType: 'p2p', text: '/windows',
      }, ctx.deps);
      assert.equal(listed[0]?.kind, 'card');
      const chosen = handleInboundText({
        openId: 'ou_1', chatId: 'oc_1', chatType: 'p2p', text: '/window 2',
      }, ctx.deps);
      assert.deepEqual(chosen[0], { kind: 'switch-window', windowId: 'win-2', title: 'beta' });
      const named = handleInboundText({
        openId: 'ou_1', chatId: 'oc_1', chatType: 'p2p', text: '/tab Plan',
      }, ctx.deps);
      assert.deepEqual(named[0], { kind: 'switch-tab', title: 'Plan' });
      const model = handleInboundText({
        openId: 'ou_1', chatId: 'oc_1', chatType: 'p2p', text: '/model gpt',
      }, ctx.deps);
      assert.deepEqual(model[0], { kind: 'models', query: 'gpt' });
      const group = handleInboundText({
        openId: 'ou_1', chatId: 'oc_g', chatType: 'group', text: '/windows',
      }, ctx.deps);
      assert.match(group[0] && group[0].kind === 'text' ? group[0].text : '', /私聊/);
      const history = handleInboundText({
        openId: 'ou_1', chatId: 'oc_1', chatType: 'p2p', text: '/history 12',
      }, ctx.deps);
      assert.deepEqual(history[0], { kind: 'history', count: 12 });
    } finally {
      rmSync(ctx.dir, { recursive: true, force: true });
    }
  });
});

describe('feishu status copy', () => {
  it('names the window in the send acknowledgement', () => {
    assert.equal(sentToWindow('demo'), '已发送到：demo');
    assert.match(formatStatusText({ connected: false, agentStatus: 'idle' }), /未连接/);
  });

  it('marks truncated transcript text', () => {
    const text = truncate('a'.repeat(4000), 100);
    assert.match(text, /已截断/);
    assert.ok(text.length <= 100);
  });

  it('says the agent is still running when Feishu is limiting edits', () => {
    assert.match(formatStatusText({ connected: true, agentStatus: 'generating', editLimited: true }), /代理没有停/);
    assert.doesNotMatch(formatStatusText({ connected: true, agentStatus: 'idle' }), /代理没有停/);
    assert.equal(isFeishuEditRateLimit(Object.assign(new Error('request trigger frequency limit'), { code: 99991400 })), true);
    assert.equal(isFeishuEditRateLimit({ response: { status: 429, data: { code: 99991400, msg: 'request trigger frequency limit' } } }), true);
    assert.equal(isFeishuEditRateLimit(new Error('message not found')), false);
  });
});

describe('feishu push', () => {
  it('sends status and a new message once, then edits when it changes', async () => {
    const sent: string[] = [];
    const edits: string[] = [];
    let n = 0;
    const sender: FeishuSender = {
      async sendText(_chatId, text) {
        sent.push(text);
        n += 1;
        return `om_${n}`;
      },
      async sendCard() {
        n += 1;
        return `om_${n}`;
      },
      async editText(_id, text) {
        edits.push(text);
      },
      async updateCard() { /* unused */ },
    };
    const tracker = new FeishuMessageTracker(null);
    const registry = new ActionRegistry();
    const message: ChatElement = {
      type: 'human', id: 'h1', flatIndex: 1, text: 'hello', mentions: [],
    };
    const view: PushView = {
      windowTitle: 'demo',
      connected: true,
      agentStatus: 'idle',
      agentActivityText: null,
      modeCurrent: 'Agent',
      modelCurrent: 'gpt',
      messages: [message],
      pendingApprovals: [],
      questionnaire: null,
    };
    await pushWindowToChat(sender, tracker, registry, 'oc_1', view);
    assert.equal(sent.length, 2);
    await pushWindowToChat(sender, tracker, registry, 'oc_1', view);
    assert.equal(sent.length, 2);
    assert.equal(edits.length, 0);

    const next: ChatElement = { ...message, text: 'hello again' };
    await pushWindowToChat(sender, tracker, registry, 'oc_1', { ...view, messages: [next] });
    assert.equal(edits.length, 1);
    assert.match(edits[0], /hello again/);
  });

  it('keeps the old message when an edit is rate-limited and marks the status', async () => {
    const sent: string[] = [];
    const edits: string[] = [];
    let n = 0;
    const sender: FeishuSender = {
      async sendText(_chatId, text) {
        sent.push(text);
        n += 1;
        return `om_${n}`;
      },
      async sendCard() {
        n += 1;
        return `om_${n}`;
      },
      async editText(_id, text) {
        edits.push(text);
        if (!text.includes('代理没有停')) {
          throw Object.assign(new Error('request trigger frequency limit'), { code: 99991400 });
        }
      },
      async updateCard() { /* unused */ },
    };
    const tracker = new FeishuMessageTracker(null);
    const registry = new ActionRegistry();
    const view: PushView = {
      windowTitle: 'demo',
      connected: true,
      agentStatus: 'generating',
      agentActivityText: 'Writing',
      modeCurrent: 'Agent',
      modelCurrent: 'gpt',
      messages: [{ type: 'human', id: 'h1', flatIndex: 1, text: 'hello', mentions: [] }],
      pendingApprovals: [],
      questionnaire: null,
    };
    const limit = { limited: false };
    await pushWindowToChat(sender, tracker, registry, 'oc_1', view, limit);
    const sentAfterBoot = sent.length;
    await pushWindowToChat(sender, tracker, registry, 'oc_1', {
      ...view,
      messages: [{ type: 'human', id: 'h1', flatIndex: 1, text: 'hello again', mentions: [] }],
    }, limit);
    assert.equal(sent.length, sentAfterBoot);
    assert.equal(limit.limited, true);
    assert.match(edits.join('\n'), /代理没有停/);
    assert.match(edits.join('\n'), /生成中/);
  });

  it('renders approval buttons', () => {
    const registry = new ActionRegistry();
    const approvals: Approval[] = [{
      id: 'ap1',
      description: 'Run tests?',
      actions: [
        { label: 'Accept', type: 'approve', selectorPath: '#ok' },
        { label: 'Reject', type: 'reject', selectorPath: '#no' },
      ],
    }];
    const card = formatApprovalCard(approvals, registry);
    assert.equal(card.header.title.content, '待审批');
    assert.match(formatElementText({
      type: 'run_command',
      id: 'r1',
      flatIndex: 2,
      toolCallId: 't',
      description: 'npm test',
      candidates: '',
      command: 'npm test',
      actions: [],
    }), /npm test/);
  });
});
