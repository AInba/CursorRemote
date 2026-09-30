import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatPickList, modelOptionsFrom, resolvePick } from '../src/server/transports/pick.js';

describe('window and model pick', () => {
  const items = [
    { id: 'a', label: 'alpha', active: true },
    { id: 'b', label: 'beta' },
  ];

  it('lists, picks a number, and refuses an ambiguous name', () => {
    assert.match(formatPickList(items), /1\. alpha ← 当前/);
    assert.equal(resolvePick(undefined, items, '窗口').type, 'list');
    assert.deepEqual(resolvePick('2', items, '窗口'), { type: 'chosen', item: items[1] });
    const ambiguous = resolvePick('a', [
      { id: '1', label: 'app' },
      { id: '2', label: 'app-two' },
    ], '窗口');
    assert.equal(ambiguous.type, 'error');
  });

  it('reads model menu options', () => {
    const models = modelOptionsFrom({
      options: [
        { id: 'gpt', label: 'GPT', selected: true },
        { id: '', label: 'skip' },
        { id: 'sonnet', label: 'Sonnet' },
      ],
    });
    assert.deepEqual(models, [
      { id: 'gpt', label: 'GPT', active: true },
      { id: 'sonnet', label: 'Sonnet', active: false },
    ]);
  });
});
