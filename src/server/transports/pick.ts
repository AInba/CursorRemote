export interface PickItem {
  id: string;
  label: string;
  active?: boolean;
}

export type PickResolution =
  | { type: 'list' }
  | { type: 'chosen'; item: PickItem }
  | { type: 'error'; text: string };

export function formatPickList(items: PickItem[]): string {
  if (items.length === 0) return '（无）';
  return items.map((item, index) => `${index + 1}. ${item.label}${item.active ? ' ← 当前' : ''}`).join('\n');
}

/** `query` empty lists the items. A number is 1-based. Other text must match one label. */
export function resolvePick(query: string | undefined, items: PickItem[], noun: string): PickResolution {
  const q = query?.trim() ?? '';
  if (!q) return { type: 'list' };
  if (items.length === 0) return { type: 'error', text: `没有${noun}。` };
  if (/^\d+$/.test(q)) {
    const index = Number(q);
    const item = items[index - 1];
    if (!item) return { type: 'error', text: `没有第 ${index} 个${noun}。当前共 ${items.length} 个。\n${formatPickList(items)}` };
    return { type: 'chosen', item };
  }
  const lower = q.toLowerCase();
  const hits = items.filter(item => item.label.toLowerCase().includes(lower));
  if (hits.length === 1) return { type: 'chosen', item: hits[0] };
  if (hits.length === 0) return { type: 'error', text: `没有匹配「${q}」的${noun}。\n${formatPickList(items)}` };
  return { type: 'error', text: `「${q}」匹配到多个${noun}，请用序号：\n${formatPickList(hits)}` };
}

export function modelOptionsFrom(data: unknown): PickItem[] {
  const raw = data as { options?: { id?: string; label?: string; selected?: boolean }[] } | undefined;
  if (!Array.isArray(raw?.options)) return [];
  return raw.options.flatMap(option => {
    if (!option?.id || !option.label) return [];
    return [{ id: option.id, label: option.label, active: option.selected === true }];
  });
}
