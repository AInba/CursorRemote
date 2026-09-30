import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';

export type FeishuChatType = 'p2p' | 'group';

export interface FeishuSession {
  chatId: string;
  openId: string;
  chatType: FeishuChatType;
  /** Phase 1 always follows the relay's active Cursor window. */
  followActiveWindow: true;
}

export interface RouteDecision {
  ok: boolean;
  windowId?: string;
  error?: string;
}

const GROUP_PHASE_MESSAGE = '一期仅支持飞书单聊控制当前 Cursor 窗口。请私聊机器人发送任务。';
const DISCONNECTED_MESSAGE = 'Cursor 尚未连接。请用 --remote-debugging-port=9222 启动 Cursor 后再试。';

/**
 * Phase 1: a private chat controls whatever window the relay is currently
 * attached to. Group chats are acknowledged but not routed.
 */
export function routeSession(
  session: Pick<FeishuSession, 'chatType'>,
  activeWindowId: string,
): RouteDecision {
  if (session.chatType !== 'p2p') {
    return { ok: false, error: GROUP_PHASE_MESSAGE };
  }
  if (!activeWindowId) {
    return { ok: false, error: DISCONNECTED_MESSAGE };
  }
  return { ok: true, windowId: activeWindowId };
}

interface SessionFile {
  sessions: FeishuSession[];
}

export class FeishuSessionStore {
  private sessions = new Map<string, FeishuSession>();

  constructor(private readonly persistPath: string) {
    this.load();
  }

  upsert(session: Omit<FeishuSession, 'followActiveWindow'>): FeishuSession {
    const next: FeishuSession = { ...session, followActiveWindow: true };
    this.sessions.set(next.chatId, next);
    this.save();
    return next;
  }

  listP2P(): FeishuSession[] {
    return [...this.sessions.values()].filter(s => s.chatType === 'p2p');
  }

  forgetOpenId(openId: string): void {
    let changed = false;
    for (const [chatId, session] of this.sessions) {
      if (session.openId !== openId) continue;
      this.sessions.delete(chatId);
      changed = true;
    }
    if (changed) this.save();
  }

  private load(): void {
    if (!existsSync(this.persistPath)) return;
    try {
      const raw = JSON.parse(readFileSync(this.persistPath, 'utf-8')) as SessionFile;
      for (const session of raw.sessions ?? []) {
        if (session?.chatId && session.openId) {
          this.sessions.set(session.chatId, { ...session, followActiveWindow: true });
        }
      }
    } catch (err) {
      console.warn(`[feishu] Could not read sessions: ${err instanceof Error ? err.message : err}`);
    }
  }

  private save(): void {
    mkdirSync(dirname(this.persistPath), { recursive: true });
    const data: SessionFile = { sessions: [...this.sessions.values()] };
    writeFileSync(this.persistPath, JSON.stringify(data, null, 2));
  }
}
