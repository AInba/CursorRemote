import { createHash } from 'crypto';
import type {
  Approval,
  ChatElement,
  ModeInfo,
  PlanBlock,
  Questionnaire,
  RunCommand,
} from '../../types.js';
import { buttonValue, type ActionRegistry, type StoredAction } from './actions.js';
import { formatPickList, type PickItem } from '../pick.js';

const TEXT_LIMIT = 3500;

export interface FeishuCard {
  config: { wide_screen_mode: boolean };
  header: {
    title: { tag: 'plain_text'; content: string };
    template: string;
  };
  elements: unknown[];
}

export function contentHash(text: string): string {
  return createHash('sha1').update(text).digest('hex').slice(0, 12);
}

const TRUNCATION_NOTE = '…\n（已截断，完整内容在 Cursor 或网页客户端）';

export function truncate(text: string, limit = TEXT_LIMIT): string {
  const clean = text.replace(/\s+\n/g, '\n').trim();
  if (clean.length <= limit) return clean;
  const room = Math.max(0, limit - TRUNCATION_NOTE.length);
  return `${clean.slice(0, room)}${TRUNCATION_NOTE}`;
}

const AGENT_STATUS_ZH: Record<string, string> = {
  idle: '空闲',
  thinking: '思考中',
  generating: '生成中',
  running_tool: '正在运行工具',
  waiting_approval: '等待审批',
  error: '出错',
};

export function describeAgentStatus(status: string | undefined): string {
  if (!status) return '未知';
  return AGENT_STATUS_ZH[status] ?? status;
}

export function sentToWindow(title?: string): string {
  const name = title?.trim();
  return name ? `已发送到：${name}` : '已发送到当前 Cursor 窗口。';
}

function md(content: string): unknown {
  return { tag: 'div', text: { tag: 'lark_md', content } };
}

function actionRow(buttons: { label: string; type?: string; value: Record<string, string> }[]): unknown {
  return {
    tag: 'action',
    actions: buttons.map(button => ({
      tag: 'button',
      text: { tag: 'plain_text', content: button.label },
      type: button.type ?? 'default',
      value: button.value,
    })),
  };
}

function card(title: string, elements: unknown[], template = 'blue'): FeishuCard {
  return {
    config: { wide_screen_mode: true },
    header: { title: { tag: 'plain_text', content: title }, template },
    elements,
  };
}

function storedButton(
  registry: ActionRegistry,
  label: string,
  action: StoredAction,
  type?: string,
): { label: string; type?: string; value: Record<string, string> } {
  return { label, type, value: buttonValue(registry, action) };
}

export function formatStatusText(input: {
  connected: boolean;
  windowTitle?: string;
  agentStatus?: string;
  activity?: string | null;
  mode?: string;
  model?: string;
  editLimited?: boolean;
}): string {
  const lines = [
    'CursorRemote',
    input.connected ? `窗口: ${input.windowTitle || '当前窗口'}` : '窗口: 未连接',
    `状态: ${describeAgentStatus(input.agentStatus)}`,
  ];
  if (input.activity) lines.push(`活动: ${input.activity}`);
  if (input.mode) lines.push(`模式: ${input.mode}`);
  if (input.model) lines.push(`模型: ${input.model}`);
  if (input.editLimited) lines.push('飞书正在限制消息编辑，对话可能还没刷新。代理没有停。');
  return lines.join('\n');
}

export function formatElementText(el: ChatElement): string {
  switch (el.type) {
    case 'human':
      return truncate(`你: ${el.text}`);
    case 'assistant': {
      const code = el.codeBlocks?.map(block => block.code).filter(Boolean).join('\n') ?? '';
      const body = [el.text, code].filter(Boolean).join('\n\n');
      return truncate(body || '(空回复)');
    }
    case 'tool': {
      const stats = el.filename
        ? ` ${el.filename}${el.additions != null ? ` +${el.additions}` : ''}${el.deletions != null ? ` -${el.deletions}` : ''}`
        : '';
      return truncate(`工具 ${el.status}: ${el.action}${el.details ? ` — ${el.details}` : ''}${stats}`);
    }
    case 'thought':
      return truncate(`思考 ${el.duration || ''}${el.action ? ` ${el.action}` : ''}`.trim());
    case 'plan':
      return truncate(`计划: ${el.title || el.label} (${el.todosCompleted}/${el.todosTotal})`);
    case 'todo_list':
      return truncate(`待办 ${el.title}: ${el.todosCompleted}/${el.todosTotal}`);
    case 'run_command':
      return truncate(`命令: ${el.description || el.command}\n${el.command}`);
    case 'loading':
      return truncate(el.text || '处理中…');
    default:
      return '';
  }
}

export function formatElementCard(el: ChatElement, registry: ActionRegistry): FeishuCard | null {
  if (el.type === 'run_command') return formatRunCard(el, registry);
  if (el.type === 'plan' && el.actions && el.actions.length > 0) return formatPlanCard(el, registry);
  if (el.type === 'tool' && el.actions && el.actions.length > 0) {
    return card(`工具 · ${el.action}`, [
      md(truncate([el.details, el.filename, el.summaryText].filter(Boolean).join('\n'))),
      actionRow(el.actions.map(action => storedButton(
        registry,
        action.label,
        { cmd: 'click', selectorPath: action.selectorPath, label: action.label },
        action.type === 'run' ? 'primary' : 'default',
      ))),
    ], 'wathet');
  }
  return null;
}

function formatRunCard(el: RunCommand, registry: ActionRegistry): FeishuCard {
  return card('需要确认命令', [
    md(truncate(`**${el.description || 'Shell'}**\n\`\`\`\n${el.command}\n\`\`\``)),
    actionRow(el.actions.map(action => storedButton(
      registry,
      action.label,
      { cmd: 'click', selectorPath: action.selectorPath, label: action.label },
      action.type === 'run' ? 'primary' : action.type === 'skip' ? 'danger' : 'default',
    ))),
  ], 'orange');
}

function formatPlanCard(el: PlanBlock, registry: ActionRegistry): FeishuCard {
  const todos = (el.todos ?? []).slice(0, 12).map(todo => {
    const mark = todo.status === 'completed' ? 'x' : todo.status === 'in_progress' ? '~' : ' ';
    return `- [${mark}] ${todo.text}`;
  }).join('\n');
  return card(el.title || '计划', [
    md(truncate([el.description, todos].filter(Boolean).join('\n\n') || el.label)),
    actionRow((el.actions ?? []).map(action => storedButton(
      registry,
      action.label,
      { cmd: 'click', selectorPath: action.selectorPath, label: action.label },
      action.type === 'build' ? 'primary' : 'default',
    ))),
  ], 'turquoise');
}

export function formatApprovalCard(approvals: Approval[], registry: ActionRegistry): FeishuCard {
  const elements: unknown[] = [];
  for (const approval of approvals) {
    elements.push(md(truncate(approval.description || approval.id)));
    elements.push(actionRow(approval.actions.map(action => storedButton(
      registry,
      action.label,
      action.type === 'approve_all'
        ? { cmd: 'approve_all', approvalId: approval.id, label: action.label }
        : {
          cmd: action.type === 'reject' ? 'reject' : 'approve',
          selectorPath: action.selectorPath,
          approvalId: approval.id,
          label: action.label,
        },
      action.type === 'reject' ? 'danger' : 'primary',
    ))));
  }
  if (elements.length === 0) {
    elements.push(md('当前没有待审批操作。'));
  }
  return card('待审批', elements, approvals.length > 0 ? 'red' : 'grey');
}

export function formatModeCard(mode: ModeInfo, registry: ActionRegistry): FeishuCard {
  const buttons = mode.available.map(item => storedButton(
    registry,
    item.label || item.id,
    { cmd: 'mode', modeId: item.id },
    item.id === mode.current ? 'primary' : 'default',
  ));
  return card('切换模式', [
    md(`当前: **${mode.current || 'unknown'}**`),
    ...(buttons.length > 0 ? [actionRow(buttons)] : [md('没有可选模式。')]),
  ]);
}

export function formatPickCard(
  title: string,
  items: PickItem[],
  registry: ActionRegistry,
  actionFor: (item: PickItem) => StoredAction,
  hint: string,
): FeishuCard {
  const buttons = items.map((item, index) => storedButton(
    registry,
    `${index + 1}. ${item.label}`.slice(0, 30),
    actionFor(item),
    item.active ? 'primary' : 'default',
  ));
  const elements: unknown[] = [md(truncate(`${formatPickList(items)}\n\n${hint}`))];
  for (let i = 0; i < buttons.length; i += 3) {
    elements.push(actionRow(buttons.slice(i, i + 3)));
  }
  return card(title, elements);
}

export function formatQuestionnaireCard(questionnaire: Questionnaire, registry: ActionRegistry): FeishuCard {
  const question = questionnaire.questions[questionnaire.activeIndex] ?? questionnaire.questions[0];
  const elements: unknown[] = [
    md(truncate(`${questionnaire.totalLabel}\n\n**${question?.text ?? ''}**`)),
  ];
  if (question) {
    elements.push(actionRow(question.options.map(option => storedButton(
      registry,
      `${option.letter}. ${option.label}`.slice(0, 30),
      { cmd: 'click', selectorPath: option.selectorPath, label: option.label },
    ))));
  }
  const footer: { label: string; type?: string; value: Record<string, string> }[] = [];
  if (questionnaire.skipSelectorPath) {
    footer.push(storedButton(registry, '跳过', { cmd: 'click', selectorPath: questionnaire.skipSelectorPath, label: '跳过' }));
  }
  if (questionnaire.continueSelectorPath) {
    footer.push(storedButton(
      registry,
      '继续',
      { cmd: 'click', selectorPath: questionnaire.continueSelectorPath, label: '继续' },
      'primary',
    ));
  }
  if (footer.length > 0) elements.push(actionRow(footer));
  return card('需要回答', elements, 'violet');
}

export function elementNeedsCard(el: ChatElement): boolean {
  if (el.type === 'run_command') return el.actions.length > 0;
  if (el.type === 'plan') return (el.actions?.length ?? 0) > 0;
  if (el.type === 'tool') return (el.actions?.length ?? 0) > 0;
  return false;
}
