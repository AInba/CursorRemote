import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { liveTabsFromSnapshots, topicLiveness } from '../src/server/transports/telegram/topic-liveness.js';

describe('telegram topic liveness', () => {
  const open = new Set(['win-a', 'win-b']);

  it('treats the visible tab as live and a hidden tab in the same window as paused', () => {
    const live = liveTabsFromSnapshots([
      {
        windowId: 'win-a',
        chatTabs: [
          { title: 'Alpha', isActive: true },
          { title: 'Beta', isActive: false },
        ],
      },
      {
        windowId: 'win-b',
        chatTabs: [{ title: 'Gamma', isActive: true }],
      },
    ], open);

    assert.equal(topicLiveness({ windowId: 'win-a', tabTitle: 'Alpha' }, live, open), 'live');
    assert.equal(topicLiveness({ windowId: 'win-a', tabTitle: 'Beta' }, live, open), 'paused');
    assert.equal(topicLiveness({ windowId: 'win-b', tabTitle: 'Gamma' }, live, open), 'live');
  });

  it('does not guess before Cursor windows are known', () => {
    assert.equal(
      topicLiveness({ windowId: 'win-a', tabTitle: 'Alpha' }, [], new Set()),
      'unknown',
    );
    assert.equal(
      topicLiveness({ windowId: 'win-a', tabTitle: 'Alpha' }, [], open),
      'unknown',
    );
  });

  it('pauses a topic whose window is no longer open', () => {
    assert.equal(
      topicLiveness({ windowId: 'win-gone', tabTitle: 'Alpha' }, [], open),
      'paused',
    );
  });
});
