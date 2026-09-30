import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { lanNeedsPassword, setupCopy } from '../extension/src/setup-copy.js';

describe('setup panel copy', () => {
  it('follows Chinese for the editor language and links docs/zh', () => {
    const zh = setupCopy(true);
    const en = setupCopy(false);
    assert.equal(zh.tabNetworking, '网络');
    assert.equal(en.tabNetworking, 'Networking');
    assert.match(zh.feishuGuideUrl, /\/docs\/zh\/feishu_setup\.md$/);
    assert.match(zh.qqGuideUrl, /\/docs\/zh\/qq_setup\.md$/);
    assert.match(zh.networkingGuideUrl, /\/docs\/zh\/setup-guide\.md$/);
    assert.doesNotMatch(en.feishuGuideUrl, /\/zh\//);
    assert.match(zh.expiryLeft, /\{n\}/);
    assert.match(zh.lanOpenWarning, /密码/);
    assert.match(en.lanOpenWarning, /password/);
  });

  it('warns only when every interface is open and the password is empty', () => {
    assert.equal(lanNeedsPassword('0.0.0.0', ''), true);
    assert.equal(lanNeedsPassword(' 0.0.0.0 ', '  '), true);
    assert.equal(lanNeedsPassword('0.0.0.0', 'secret'), false);
    assert.equal(lanNeedsPassword('127.0.0.1', ''), false);
  });
});
