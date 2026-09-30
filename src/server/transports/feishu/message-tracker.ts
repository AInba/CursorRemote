import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';

export interface TrackedFeishuMessage {
  messageId: string;
  hash: string;
  kind: 'text' | 'card';
}

interface PersistFile {
  messages: Record<string, TrackedFeishuMessage>;
}

export class FeishuMessageTracker {
  private messages = new Map<string, TrackedFeishuMessage>();

  constructor(private readonly persistPath: string | null = null) {
    if (persistPath) this.load();
  }

  get(chatId: string, elementId: string): TrackedFeishuMessage | undefined {
    return this.messages.get(this.key(chatId, elementId));
  }

  track(chatId: string, elementId: string, messageId: string, hash: string, kind: 'text' | 'card'): void {
    this.messages.set(this.key(chatId, elementId), { messageId, hash, kind });
    this.save();
  }

  private key(chatId: string, elementId: string): string {
    return `${chatId}:${elementId}`;
  }

  private load(): void {
    if (!this.persistPath || !existsSync(this.persistPath)) return;
    try {
      const raw = JSON.parse(readFileSync(this.persistPath, 'utf-8')) as PersistFile;
      for (const [key, value] of Object.entries(raw.messages ?? {})) {
        if (value?.messageId) this.messages.set(key, value);
      }
    } catch (err) {
      console.warn(`[feishu] Could not read message tracker: ${err instanceof Error ? err.message : err}`);
    }
  }

  private save(): void {
    if (!this.persistPath) return;
    mkdirSync(dirname(this.persistPath), { recursive: true });
    const data: PersistFile = { messages: Object.fromEntries(this.messages) };
    writeFileSync(this.persistPath, JSON.stringify(data));
  }
}
