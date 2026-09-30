import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  identifyFrame,
  parseGatewayFrame,
  qqApiBase,
  QQ_INTENTS,
} from '../src/server/transports/qq/protocol.js';
import { QqApi } from '../src/server/transports/qq/api.js';
import { callbackKeyboard } from '../src/server/transports/qq/keyboard.js';
import { handleQqText } from '../src/server/transports/qq/inbound.js';
import { FeishuAuthStore } from '../src/server/transports/feishu/auth-store.js';
import { FeishuSessionStore } from '../src/server/transports/feishu/session-router.js';
import { ActionRegistry } from '../src/server/transports/feishu/actions.js';

describe('qq protocol', () => {
  it('identifies with a QQBot access token and c2c plus interaction intents', () => {
    const frame = identifyFrame('token-1');
    const data = frame.d as { token: string; intents: number; shard: number[] };
    assert.equal(frame.op, 2);
    assert.equal(data.token, 'QQBot token-1');
    assert.equal(data.intents, QQ_INTENTS);
    assert.deepEqual(data.shard, [0, 1]);
    assert.equal(qqApiBase(false), 'https://api.bot.qq.com');
    assert.equal(qqApiBase(true), 'https://sandbox.api.sgroup.qq.com');
  });

  it('parses a private-chat message and a button click', () => {
    const message = parseGatewayFrame({
      op: 0,
      t: 'C2C_MESSAGE_CREATE',
      d: {
        id: 'msg-1',
        content: '/bind 123456',
        author: { user_openid: 'oid-1' },
      },
    });
    assert.equal(message.type, 'c2c');
    if (message.type === 'c2c') {
      assert.equal(message.message.userOpenId, 'oid-1');
      assert.equal(message.message.content, '/bind 123456');
    }

    const click = parseGatewayFrame({
      op: 0,
      t: 'INTERACTION_CREATE',
      d: {
        id: 'evt-1',
        scene: 'c2c',
        user_openid: 'oid-1',
        data: { resoloved: { button_data: 'abc' } },
      },
    });
    assert.equal(click.type, 'interaction');
    if (click.type === 'interaction') assert.equal(click.interaction.buttonData, 'abc');
  });

  it('reads the heartbeat interval from Hello', () => {
    const hello = parseGatewayFrame({ op: 10, d: { heartbeat_interval: 45000 } });
    assert.deepEqual(hello, { type: 'hello', heartbeatInterval: 45000 });
  });
});

describe('qq api', () => {
  it('sends a passive reply with an increasing msg_seq', async () => {
    const calls: { url: string; body?: string }[] = [];
    const http: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), body: init?.body as string | undefined });
      if (String(url).endsWith('/app/getAppAccessToken')) {
        return new Response(JSON.stringify({ access_token: 'tok', expires_in: 7200 }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    };
    const api = new QqApi('app', 'secret', 'https://api.bot.qq.com', http);
    await api.sendC2cText('user', 'hello', 'msg-1');
    await api.sendC2cText('user', 'again', 'msg-1');
    const bodies = calls.filter(call => call.url.includes('/messages')).map(call => JSON.parse(call.body ?? '{}'));
    assert.equal(bodies[0].msg_seq, 1);
    assert.equal(bodies[1].msg_seq, 2);
    assert.equal(bodies[0].msg_id, 'msg-1');
    assert.equal(bodies[0].msg_type, 0);
  });
});

describe('qq inbound', () => {
  function deps(overrides: Partial<Parameters<typeof handleQqText>[1]> = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'qq-inbound-'));
    const auth = new FeishuAuthStore(join(dir, 'auth.json'));
    const sessions = new FeishuSessionStore(join(dir, 'sessions.json'));
    const registry = new ActionRegistry();
    return {
      dir,
      auth,
      registry,
      deps: {
        isAllowed: (openId: string) => auth.isAllowed(openId),
        tryBind: (openId: string, token: string) => {
          if (token !== '123456') return false;
          auth.register(openId);
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
        takeAction: (id: string) => registry.get(id) ?? null,
        ...overrides,
      },
    };
  }

  it('binds, then forwards text and runs a stored action', () => {
    const ctx = deps();
    try {
      const bound = handleQqText({ openId: 'oid', text: '/bind 123456' }, ctx.deps);
      assert.match(bound[0] && bound[0].kind === 'text' ? bound[0].text : '', /已绑定/);

      const sent = handleQqText({ openId: 'oid', text: 'fix tests' }, ctx.deps);
      assert.deepEqual(sent[0], { kind: 'cursor', text: 'fix tests', windowId: 'win-1' });

      const id = ctx.registry.put({ cmd: 'approve', selectorPath: '#ok', label: 'Accept' });
      const action = handleQqText({ openId: 'oid', text: `/do ${id}` }, ctx.deps);
      assert.equal(action[0]?.kind, 'action');
    } finally {
      rmSync(ctx.dir, { recursive: true, force: true });
    }
  });

  it('lists pending approvals as /do commands and can unbind', () => {
    const ctx = deps();
    try {
      handleQqText({ openId: 'oid', text: '/bind 123456' }, ctx.deps);
      const status = handleQqText({ openId: 'oid', text: '/status' }, {
        ...ctx.deps,
        status: { ...ctx.deps.status, agentStatus: 'waiting_approval' },
        pendingApprovals: [{
          id: 'ap1',
          description: 'Run tests?',
          actions: [{ label: 'Accept', type: 'approve', selectorPath: '#ok' }],
        }],
        approvalNotPushed: true,
      });
      const text = status[0] && status[0].kind === 'text' ? status[0].text : '';
      assert.match(text, /等待审批/);
      assert.match(text, /\/do /);
      assert.match(text, /没能自动推送/);

      const prompts = handleQqText({ openId: 'oid', text: '/status' }, {
        ...ctx.deps,
        questionnaire: {
          questions: [{
            number: '1',
            text: 'Which runtime?',
            isActive: true,
            options: [
              { letter: 'A', label: 'Node', isFreeform: false, selectorPath: '#a' },
              { letter: 'B', label: 'Browser', isFreeform: false, selectorPath: '#b' },
            ],
          }],
          activeIndex: 0,
          totalLabel: '1/1',
          skipSelectorPath: '#skip',
          continueSelectorPath: '#go',
          continueDisabled: false,
        },
        plans: [{
          type: 'plan',
          id: 'plan-1',
          flatIndex: 1,
          label: 'Ship it',
          title: 'Ship it',
          todosCompleted: 0,
          todosTotal: 1,
          actions: [{ label: 'Build', type: 'build', selectorPath: '#build' }],
        }],
      });
      const promptText = prompts[0] && prompts[0].kind === 'text' ? prompts[0].text : '';
      assert.match(promptText, /Which runtime\?/);
      assert.match(promptText, /\/do \S+  A\. Node/);
      assert.match(promptText, /Ship it/);
      assert.match(promptText, /\/do \S+  Build/);
      const buildId = promptText.match(/\/do (\S+)  Build/)?.[1];
      assert.equal(ctx.registry.get(buildId ?? '')?.cmd, 'click');

      const gone = handleQqText({ openId: 'oid', text: '/unbind' }, ctx.deps);
      assert.match(gone[0] && gone[0].kind === 'text' ? gone[0].text : '', /已解除绑定/);
      assert.equal(ctx.auth.isAllowed('oid'), false);
    } finally {
      rmSync(ctx.dir, { recursive: true, force: true });
    }
  });

  it('switches a window by number and keeps the id on the button', () => {
    const ctx = deps({
      windows: [
        { id: 'win-1', label: 'alpha', active: true },
        { id: 'win-2', label: 'beta', active: false },
      ],
    });
    try {
      ctx.auth.register('oid');
      const listed = handleQqText({ openId: 'oid', text: '/windows' }, ctx.deps);
      assert.equal(listed[0]?.kind, 'buttons');
      const chosen = handleQqText({ openId: 'oid', text: '/window beta' }, ctx.deps);
      assert.deepEqual(chosen[0], { kind: 'switch-window', windowId: 'win-2', title: 'beta' });
      if (listed[0]?.kind === 'buttons') {
        const stored = ctx.registry.get(listed[0].buttons[1].id);
        assert.equal(stored?.cmd, 'window');
        assert.equal(stored?.windowId, 'win-2');
      }
    } finally {
      rmSync(ctx.dir, { recursive: true, force: true });
    }
  });

  it('builds a callback keyboard with the button id as data', () => {
    const keyboard = callbackKeyboard([{ id: 'abc', label: 'Accept', style: 1 }]) as {
      content: { rows: { buttons: { action: { data: string; type: number } }[] }[] };
    };
    assert.equal(keyboard.content.rows[0].buttons[0].action.type, 1);
    assert.equal(keyboard.content.rows[0].buttons[0].action.data, 'abc');
  });
});
