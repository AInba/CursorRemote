import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { promptFingerprint, promptIntro, promptSections } from '../src/server/transports/qq/prompts.js';

describe('qq prompts', () => {
  it('turns a questionnaire and a plan into the same click actions as approvals', () => {
    const sections = promptSections({
      approvals: [{
        id: 'ap1',
        description: 'Run tests?',
        actions: [{ label: 'Accept', type: 'approve', selectorPath: '#ok' }],
      }],
      questionnaire: {
        questions: [{
          number: '1',
          text: 'Pick one',
          isActive: true,
          options: [{ letter: 'A', label: 'Node', isFreeform: false, selectorPath: '#a' }],
        }],
        activeIndex: 0,
        totalLabel: '1/1',
        skipSelectorPath: '',
        continueSelectorPath: '#go',
        continueDisabled: false,
      },
      plans: [{
        type: 'plan',
        id: 'p1',
        flatIndex: 2,
        label: 'Plan',
        title: 'Plan',
        todosCompleted: 0,
        todosTotal: 1,
        actions: [{ label: 'Build', type: 'build', selectorPath: '#build' }],
      }],
    });
    assert.deepEqual(sections.map(section => section.kind), ['approval', 'questionnaire', 'plan']);
    assert.equal(sections[1].actions[0].cmd, 'click');
    assert.equal(sections[1].actions[1].label, '继续');
    assert.equal(sections[2].actions[0].selectorPath, '#build');
    assert.match(promptFingerprint(sections), /questionnaire:1\/1 Pick one/);
    assert.equal(promptIntro(sections), 'Cursor 有待确认操作。');
    assert.equal(promptIntro([sections[1]]), 'Cursor 有问卷需要回答。');
  });
});
