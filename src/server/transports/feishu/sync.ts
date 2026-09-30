import type { Approval, ChatElement, Questionnaire } from '../../types.js';
import type { ActionRegistry } from './actions.js';
import {
  contentHash,
  elementNeedsCard,
  formatApprovalCard,
  formatElementCard,
  formatElementText,
  formatQuestionnaireCard,
  formatStatusText,
} from './formatter.js';
import type { FeishuMessageTracker } from './message-tracker.js';

export interface FeishuSender {
  sendText(chatId: string, text: string): Promise<string>;
  sendCard(chatId: string, card: object): Promise<string>;
  editText(messageId: string, text: string): Promise<void>;
  updateCard(messageId: string, card: object): Promise<void>;
}

export interface PushView {
  windowTitle: string;
  connected: boolean;
  agentStatus: string;
  agentActivityText: string | null;
  modeCurrent: string;
  modelCurrent: string;
  messages: ChatElement[];
  pendingApprovals: Approval[];
  questionnaire: Questionnaire | null;
}

const BOOT_ID = '__boot';
const STATUS_ID = '__status';
const APPROVAL_ID = '__approvals';
const QUESTION_ID = '__questionnaire';

const sharedEditLimit = { limited: false };

export function feishuEditsAreLimited(): boolean {
  return sharedEditLimit.limited;
}

/** Feishu rejects in-place edits with 99991400 / HTTP 429 when the chat is updated too often. */
export function isFeishuEditRateLimit(err: unknown): boolean {
  const text = errorText(err);
  return /\b99991400\b/.test(text)
    || /\b429\b/.test(text)
    || /frequency limit|rate limit|too many requests/i.test(text);
}

function errorText(err: unknown): string {
  const parts: string[] = [];
  const walk = (value: unknown, depth: number) => {
    if (value == null || depth > 4) return;
    if (typeof value === 'string' || typeof value === 'number') {
      parts.push(String(value));
      return;
    }
    if (typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    for (const key of ['message', 'msg', 'code', 'status', 'statusCode']) {
      if (key in record) walk(record[key], depth + 1);
    }
    if ('response' in record) walk(record.response, depth + 1);
    if ('data' in record) walk(record.data, depth + 1);
  };
  walk(err, 0);
  if (err instanceof Error) parts.push(err.message);
  return parts.join(' ');
}

type UpsertResult = 'unchanged' | 'updated' | 'rate-limited';

async function upsertText(
  sender: FeishuSender,
  tracker: FeishuMessageTracker,
  chatId: string,
  elementId: string,
  text: string,
): Promise<UpsertResult> {
  const hash = contentHash(text);
  const existing = tracker.get(chatId, elementId);
  if (existing?.hash === hash) return 'unchanged';
  if (existing?.kind === 'text') {
    try {
      await sender.editText(existing.messageId, text);
      tracker.track(chatId, elementId, existing.messageId, hash, 'text');
      return 'updated';
    } catch (err) {
      if (isFeishuEditRateLimit(err)) {
        console.warn(`[feishu] edit rate limited, keeping the previous message: ${errorText(err)}`);
        return 'rate-limited';
      }
      console.warn(`[feishu] edit text failed, sending new: ${err instanceof Error ? err.message : err}`);
    }
  }
  try {
    const messageId = await sender.sendText(chatId, text);
    tracker.track(chatId, elementId, messageId, hash, 'text');
    return 'updated';
  } catch (err) {
    if (isFeishuEditRateLimit(err)) return 'rate-limited';
    throw err;
  }
}

async function upsertCard(
  sender: FeishuSender,
  tracker: FeishuMessageTracker,
  chatId: string,
  elementId: string,
  card: object,
): Promise<UpsertResult> {
  const hash = contentHash(JSON.stringify(card));
  const existing = tracker.get(chatId, elementId);
  if (existing?.hash === hash) return 'unchanged';
  if (existing?.kind === 'card') {
    try {
      await sender.updateCard(existing.messageId, card);
      tracker.track(chatId, elementId, existing.messageId, hash, 'card');
      return 'updated';
    } catch (err) {
      if (isFeishuEditRateLimit(err)) {
        console.warn(`[feishu] card edit rate limited, keeping the previous card: ${errorText(err)}`);
        return 'rate-limited';
      }
      console.warn(`[feishu] update card failed, sending new: ${err instanceof Error ? err.message : err}`);
    }
  }
  try {
    const messageId = await sender.sendCard(chatId, card);
    tracker.track(chatId, elementId, messageId, hash, 'card');
    return 'updated';
  } catch (err) {
    if (isFeishuEditRateLimit(err)) return 'rate-limited';
    throw err;
  }
}

export async function pushWindowToChat(
  sender: FeishuSender,
  tracker: FeishuMessageTracker,
  registry: ActionRegistry,
  chatId: string,
  view: PushView,
  limitState: { limited: boolean } = sharedEditLimit,
): Promise<void> {
  let hit = false;
  const watch = (result: UpsertResult) => {
    if (result === 'rate-limited') hit = true;
  };

  const approvalCard = formatApprovalCard(view.pendingApprovals, registry);
  if (view.pendingApprovals.length > 0 || tracker.get(chatId, APPROVAL_ID)) {
    watch(await upsertCard(sender, tracker, chatId, APPROVAL_ID, approvalCard));
  }

  if (view.questionnaire && view.questionnaire.questions.length > 0) {
    watch(await upsertCard(sender, tracker, chatId, QUESTION_ID, formatQuestionnaireCard(view.questionnaire, registry)));
  } else if (tracker.get(chatId, QUESTION_ID)) {
    watch(await upsertText(sender, tracker, chatId, QUESTION_ID, '问卷已关闭。'));
  }

  const content = view.messages.filter(el => el.type !== 'loading');
  // The live mirror stays short so Feishu is not flooded on every poll. /history reads a longer slice.
  const tail = content.slice(-12);
  const booted = tracker.get(chatId, BOOT_ID);
  const slice = booted ? tail : tail.slice(-6);
  for (const el of slice) {
    if (!booted && tracker.get(chatId, el.id)) continue;
    if (elementNeedsCard(el)) {
      const card = formatElementCard(el, registry);
      if (card) {
        watch(await upsertCard(sender, tracker, chatId, el.id, card));
        continue;
      }
    }
    const text = formatElementText(el);
    if (text) watch(await upsertText(sender, tracker, chatId, el.id, text));
  }
  if (!booted) tracker.track(chatId, BOOT_ID, 'local', '1', 'text');

  const statusResult = await upsertText(sender, tracker, chatId, STATUS_ID, formatStatusText({
    connected: view.connected,
    windowTitle: view.windowTitle,
    agentStatus: view.agentStatus,
    activity: view.agentActivityText,
    mode: view.modeCurrent,
    model: view.modelCurrent,
    editLimited: limitState.limited || hit,
  }));
  limitState.limited = hit || statusResult === 'rate-limited';
}
