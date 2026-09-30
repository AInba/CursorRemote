import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FeishuAuthStore } from '../src/server/transports/feishu/auth-store.js';
import { isLocalPeer, isLoopbackAddress } from '../src/server/loopback.js';
import { removeBoundUser } from '../extension/src/bound-users.js';

describe('allow-list unbind', () => {
  it('keeps pre-registered ids marked after revoke, and reloads them on the next start', () => {
    const dir = mkdtempSync(join(tmpdir(), 'unbind-auth-'));
    const path = join(dir, 'auth.json');
    const auth = new FeishuAuthStore(path, ['ou_allow']);
    auth.register('ou_scan', 'scanner');
    assert.equal(auth.revoke('ou_allow'), true);
    assert.equal(auth.isAllowed('ou_allow'), false);
    assert.equal(auth.isPreRegistered('ou_allow'), true);
    assert.equal(auth.revoke('ou_scan'), true);
    assert.equal(auth.isPreRegistered('ou_scan'), false);

    const restarted = new FeishuAuthStore(path, ['ou_allow']);
    assert.equal(restarted.isAllowed('ou_allow'), true);
    assert.equal(restarted.isAllowed('ou_scan'), false);
  });
});

describe('loopback address', () => {
  it('accepts this machine and rejects a LAN peer', () => {
    assert.equal(isLoopbackAddress('127.0.0.1'), true);
    assert.equal(isLoopbackAddress('::1'), true);
    assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true);
    assert.equal(isLoopbackAddress('192.168.1.8'), false);
    assert.equal(isLoopbackAddress(undefined), false);
  });

  it('accepts a same-machine connection to the bind address', () => {
    assert.equal(isLocalPeer('127.0.0.1', '100.64.0.1'), true);
    assert.equal(isLocalPeer('100.64.0.1', '100.64.0.1'), true);
    assert.equal(isLocalPeer('::ffff:100.64.0.1', '100.64.0.1'), true);
    assert.equal(isLocalPeer('192.168.1.8', '100.64.0.1'), false);
    assert.equal(isLocalPeer(undefined, '100.64.0.1'), false);
  });
});

describe('removeBoundUser', () => {
  it('drops the open id from auth and session files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'unbind-files-'));
    writeFileSync(join(dir, 'feishu-auth.json'), JSON.stringify({
      registeredUsers: [
        { openId: 'ou_keep', registeredAt: '2026-01-01T00:00:00.000Z' },
        { openId: 'ou_drop', name: 'drop', registeredAt: '2026-01-01T00:00:00.000Z' },
      ],
    }));
    writeFileSync(join(dir, 'feishu-sessions.json'), JSON.stringify({
      sessions: [
        { chatId: 'oc_keep', openId: 'ou_keep', chatType: 'p2p' },
        { chatId: 'oc_drop', openId: 'ou_drop', chatType: 'p2p' },
      ],
    }));

    assert.equal(removeBoundUser(dir, 'feishu', 'ou_drop'), true);
    assert.equal(removeBoundUser(dir, 'feishu', 'ou_missing'), false);

    const auth = JSON.parse(readFileSync(join(dir, 'feishu-auth.json'), 'utf-8')) as {
      registeredUsers: Array<{ openId: string }>;
    };
    const sessions = JSON.parse(readFileSync(join(dir, 'feishu-sessions.json'), 'utf-8')) as {
      sessions: Array<{ openId: string }>;
    };
    assert.deepEqual(auth.registeredUsers.map(user => user.openId), ['ou_keep']);
    assert.deepEqual(sessions.sessions.map(row => row.openId), ['ou_keep']);
  });
});
