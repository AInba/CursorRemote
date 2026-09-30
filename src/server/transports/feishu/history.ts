import type { ChatElement } from '../../types.js';
import { formatElementText, truncate } from './formatter.js';

/** Live push only mirrors a short tail. /history asks for a longer slice. */
export const HISTORY_DEFAULT = 30;
export const HISTORY_MAX = 80;
const CHUNK_LIMIT = 3500;

export function parseHistoryCount(raw: string | undefined): number {
  const n = Number(raw);
  if (!raw || !Number.isFinite(n) || n <= 0) return HISTORY_DEFAULT;
  return Math.min(Math.floor(n), HISTORY_MAX);
}

export function renderHistory(
  messages: ChatElement[],
  count: number,
  windowTitle: string,
): { intro: string; chunks: string[] } {
  const readable = messages.filter(el => el.type !== 'loading');
  const title = windowTitle.trim() || '当前窗口';
  const lines = readable
    .slice(-count)
    .map(el => formatElementText(el))
    .filter(Boolean);
  if (lines.length === 0) {
    return { intro: `「${title}」里没有可读的对话。`, chunks: [] };
  }
  const notes = [`历史：${title} — ${lines.length} 条`];
  if (count >= HISTORY_MAX && readable.length > HISTORY_MAX) {
    notes.push(`一次最多 ${HISTORY_MAX} 条。`);
  } else if (readable.length > lines.length && count < HISTORY_MAX) {
    const next = Math.min(HISTORY_MAX, count + 20);
    notes.push(`还有更早的内容。发送 /history ${next} 再往前看。`);
  }
  return { intro: notes.join('\n'), chunks: packChunks(lines) };
}

function packChunks(lines: string[]): string[] {
  const chunks: string[] = [];
  let buf = '';
  for (const line of lines) {
    const piece = truncate(line, CHUNK_LIMIT);
    if (buf && buf.length + 2 + piece.length > CHUNK_LIMIT) {
      chunks.push(buf);
      buf = piece;
    } else {
      buf = buf ? `${buf}\n\n${piece}` : piece;
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}
