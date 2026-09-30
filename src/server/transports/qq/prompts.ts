import type { Approval, ChatElement, PlanBlock, Questionnaire } from '../../types.js';
import type { StoredAction } from '../feishu/actions.js';

export interface PromptSection {
  kind: 'approval' | 'questionnaire' | 'plan';
  heading: string;
  actions: StoredAction[];
}

export function plansFromMessages(messages: ChatElement[]): PlanBlock[] {
  return messages.filter((el): el is PlanBlock => el.type === 'plan' && (el.actions?.length ?? 0) > 0);
}

export function promptSections(input: {
  approvals?: Approval[];
  questionnaire?: Questionnaire | null;
  plans?: PlanBlock[];
}): PromptSection[] {
  const sections: PromptSection[] = [];
  for (const approval of input.approvals ?? []) {
    const actions = approval.actions.flatMap(action => {
      if (action.type !== 'approve_all' && !action.selectorPath) return [];
      const stored: StoredAction = action.type === 'approve_all'
        ? { cmd: 'approve_all', approvalId: approval.id, label: action.label }
        : {
          cmd: action.type === 'reject' ? 'reject' : 'approve',
          selectorPath: action.selectorPath,
          approvalId: approval.id,
          label: action.label,
        };
      return [stored];
    });
    if (actions.length > 0) {
      sections.push({ kind: 'approval', heading: approval.description || approval.id, actions });
    }
  }

  const questionnaire = input.questionnaire;
  const question = questionnaire?.questions[questionnaire.activeIndex] ?? questionnaire?.questions[0];
  if (questionnaire && question && question.options.length > 0) {
    const actions: StoredAction[] = question.options
      .filter(option => option.selectorPath)
      .map(option => ({
        cmd: 'click' as const,
        selectorPath: option.selectorPath,
        label: `${option.letter}. ${option.label}`.trim(),
      }));
    if (questionnaire.skipSelectorPath) {
      actions.push({ cmd: 'click', selectorPath: questionnaire.skipSelectorPath, label: '跳过' });
    }
    if (questionnaire.continueSelectorPath && !questionnaire.continueDisabled) {
      actions.push({ cmd: 'click', selectorPath: questionnaire.continueSelectorPath, label: '继续' });
    }
    if (actions.length > 0) {
      const title = [questionnaire.totalLabel, question.text].filter(Boolean).join(' ');
      sections.push({ kind: 'questionnaire', heading: title || '问卷', actions });
    }
  }

  for (const plan of input.plans ?? []) {
    const actions = (plan.actions ?? [])
      .filter(action => action.selectorPath)
      .map(action => ({
        cmd: 'click' as const,
        selectorPath: action.selectorPath,
        label: action.label,
      }));
    if (actions.length === 0) continue;
    sections.push({ kind: 'plan', heading: plan.title || plan.label || '计划', actions });
  }
  return sections;
}

export function promptFingerprint(sections: PromptSection[]): string {
  return sections.map(section => `${section.kind}:${section.heading}:${section.actions.map(action => action.label).join(',')}`).join(';');
}

export function promptIntro(sections: PromptSection[]): string {
  const kinds = new Set(sections.map(section => section.kind));
  if (kinds.size === 1 && kinds.has('questionnaire')) return 'Cursor 有问卷需要回答。';
  if (kinds.size === 1 && kinds.has('plan')) return 'Cursor 有计划需要确认。';
  return 'Cursor 有待确认操作。';
}

export function promptButtonStyle(action: StoredAction): 0 | 1 {
  if (action.cmd === 'reject') return 0;
  if (action.label === '跳过') return 0;
  return 1;
}
