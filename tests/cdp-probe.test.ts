import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { probeCdp } from '../extension/src/cdp-probe.js';

function fakeFetch(status: number, body: unknown, fail = false): typeof fetch {
  return (async () => {
    if (fail) throw new Error('refused');
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response;
  }) as typeof fetch;
}

describe('CDP probe', () => {
  it('counts page targets', async () => {
    const result = await probeCdp('http://127.0.0.1:9222/', fakeFetch(200, [
      { type: 'page' },
      { type: 'browser' },
      { type: 'page' },
    ]));
    assert.equal(result.ok, true);
    assert.equal(result.detail, '2');
  });

  it('reports a closed port and an empty page list', async () => {
    const closed = await probeCdp('http://127.0.0.1:9222', fakeFetch(0, null, true));
    assert.deepEqual(closed, { ok: false, detail: 'closed' });
    const empty = await probeCdp('http://127.0.0.1:9222', fakeFetch(200, [{ type: 'browser' }]));
    assert.deepEqual(empty, { ok: false, detail: 'no-pages' });
  });
});
