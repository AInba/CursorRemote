import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getTransportLinks, setTransportLink } from '../src/server/transport-status.js';

describe('transport link status', () => {
  it('records ready and error for the setup panel', () => {
    setTransportLink('feishu', 'ready', '长连接已就绪');
    setTransportLink('qq', 'error', '4914');
    const links = getTransportLinks();
    assert.equal(links.feishu.state, 'ready');
    assert.equal(links.qq.detail, '4914');
    setTransportLink('feishu', 'disabled', '');
    setTransportLink('qq', 'disabled', '');
  });
});
