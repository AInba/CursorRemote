import type { CommandExecutor } from '../../command-executor.js';
import type { CommandResult } from '../../types.js';

export type CardCommandName = 'approve' | 'reject' | 'approve_all' | 'click' | 'mode' | 'window' | 'tab' | 'model';

export interface StoredAction {
  cmd: CardCommandName;
  selectorPath?: string;
  approvalId?: string;
  label?: string;
  modeId?: string;
  windowId?: string;
  tabTitle?: string;
  modelId?: string;
}

export class ActionRegistry {
  private items = new Map<string, StoredAction>();

  put(action: StoredAction): string {
    const id = Math.random().toString(36).slice(2, 10);
    this.items.set(id, action);
    return id;
  }

  get(id: string): StoredAction | undefined {
    return this.items.get(id);
  }
}

export function buttonValue(registry: ActionRegistry, action: StoredAction): Record<string, string> {
  if (action.cmd === 'mode' && action.modeId) {
    return { cmd: 'mode', modeId: action.modeId };
  }
  return { cmd: action.cmd, id: registry.put(action) };
}

export function parseCardValue(value: unknown, registry: ActionRegistry): StoredAction | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const cmd = raw.cmd;
  if (cmd === 'mode' && typeof raw.modeId === 'string' && raw.modeId) {
    return { cmd: 'mode', modeId: raw.modeId };
  }
  if (typeof raw.id !== 'string') return null;
  if (
    cmd !== 'approve' && cmd !== 'reject' && cmd !== 'approve_all' && cmd !== 'click'
    && cmd !== 'mode' && cmd !== 'window' && cmd !== 'tab' && cmd !== 'model'
  ) {
    return null;
  }
  return registry.get(raw.id) ?? null;
}

export interface CardHooks {
  switchWindow?(windowId: string): Promise<void>;
}

export function actionResultText(action: StoredAction, ok: boolean, error?: string, windowTitle?: string): string {
  if (!ok) return `执行失败: ${error ?? 'unknown'}`;
  const where = windowTitle ? `（${windowTitle}）` : '';
  if (action.cmd === 'window') return `已切换到窗口：${action.label || action.windowId || ''}`;
  if (action.cmd === 'tab') return `已切换到标签：${action.label || action.tabTitle || ''}${where}`;
  if (action.cmd === 'model') return `已切换模型：${action.label || action.modelId || ''}${where}`;
  const label = action.label || action.modeId || action.cmd;
  return `已执行: ${label}${where}`;
}

function commandId(): string {
  return `fs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function runCardCommand(
  action: StoredAction,
  executor: CommandExecutor,
  hooks?: CardHooks,
): Promise<CommandResult> {
  const id = commandId();
  switch (action.cmd) {
    case 'approve':
      if (!action.selectorPath) return { commandId: id, ok: false, error: 'missing selector' };
      return executor.clickApproval(id, action.selectorPath);
    case 'reject':
      if (!action.selectorPath) return { commandId: id, ok: false, error: 'missing selector' };
      return executor.reject(id, action.selectorPath);
    case 'approve_all':
      return executor.approveAll(id);
    case 'click':
      if (!action.selectorPath) return { commandId: id, ok: false, error: 'missing selector' };
      return executor.clickAction(id, action.selectorPath, action.label);
    case 'mode':
      if (!action.modeId) return { commandId: id, ok: false, error: 'missing mode' };
      return executor.setMode(id, action.modeId);
    case 'window':
      if (!action.windowId || !hooks?.switchWindow) return { commandId: id, ok: false, error: 'missing window' };
      await hooks.switchWindow(action.windowId);
      return { commandId: id, ok: true };
    case 'tab':
      if (!action.tabTitle) return { commandId: id, ok: false, error: 'missing tab' };
      return executor.switchTab(id, action.tabTitle);
    case 'model':
      if (!action.modelId) return { commandId: id, ok: false, error: 'missing model' };
      return executor.setModel(id, action.modelId);
    default:
      return { commandId: id, ok: false, error: 'unknown action' };
  }
}
