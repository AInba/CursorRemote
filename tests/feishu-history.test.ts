import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ChatElement } from '../src/server/types.js';
import { HISTORY_DEFAULT, HISTORY_MAX, parseHistoryCount, renderHistory } from '../src/server/transports/feishu/history.js';

function human(id: string, text: string): ChatElement {
  return { id, type: 'human', flatIndex: 0, text, mentions: [] };
}

describe('feishu history', () => {
  it('defaults and caps the requested count', () => {
    assert.equal(parseHistoryCount(undefined), HISTORY_DEFAULT);
    assert.equal(parseHistoryCount('12'), 12);
    assert.equal(parseHistoryCount('500'), HISTORY_MAX);
  });

  it('returns a longer slice than the live tail and says when more remains', () => {
    const messages = Array.from({ length: 20 }, (_, i) => human(`m${i}`, `line ${i}`));
    const rendered = renderHistory(messages, 8, 'demo');
    assert.match(rendered.intro, /8 条/);
    assert.match(rendered.intro, /\/history 28/);
    assert.match(rendered.chunks.join('\n'), /line 19/);
    assert.doesNotMatch(rendered.chunks.join('\n'), /line 0/);
  });
});
