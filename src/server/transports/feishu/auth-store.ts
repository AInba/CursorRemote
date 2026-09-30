import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';

export interface FeishuUser {
  openId: string;
  name?: string;
  registeredAt: string;
}

interface AuthFile {
  registeredUsers: FeishuUser[];
}

export class FeishuAuthStore {
  private users = new Map<string, FeishuUser>();
  private preRegistered = new Set<string>();

  constructor(
    private readonly persistPath: string,
    preRegisteredOpenIds: string[] = [],
  ) {
    this.load();
    this.preRegistered = new Set(preRegisteredOpenIds.map(id => id.trim()).filter(Boolean));
    let changed = false;
    for (const openId of this.preRegistered) {
      if (this.users.has(openId)) continue;
      this.users.set(openId, { openId, registeredAt: new Date().toISOString() });
      changed = true;
    }
    if (changed) this.save();
  }

  /** Ids from the allow-list env var. revoke() drops them until the next process start. */
  isPreRegistered(openId: string): boolean {
    return this.preRegistered.has(openId);
  }

  isAllowed(openId: string): boolean {
    return this.users.has(openId);
  }

  register(openId: string, name?: string): FeishuUser {
    const existing = this.users.get(openId);
    const user: FeishuUser = {
      openId,
      name: name || existing?.name,
      registeredAt: existing?.registeredAt ?? new Date().toISOString(),
    };
    this.users.set(openId, user);
    this.save();
    return user;
  }

  /** Removes a bound user. Ids listed in allowedUsers are added again the next time the process starts. */
  revoke(openId: string): boolean {
    const removed = this.users.delete(openId);
    if (removed) this.save();
    return removed;
  }

  list(): FeishuUser[] {
    return [...this.users.values()];
  }

  private load(): void {
    if (!existsSync(this.persistPath)) return;
    try {
      const raw = JSON.parse(readFileSync(this.persistPath, 'utf-8')) as AuthFile;
      for (const user of raw.registeredUsers ?? []) {
        if (user?.openId) this.users.set(user.openId, user);
      }
    } catch (err) {
      console.warn(`[feishu] Could not read auth store: ${err instanceof Error ? err.message : err}`);
    }
  }

  private save(): void {
    const dir = dirname(this.persistPath);
    mkdirSync(dir, { recursive: true });
    const data: AuthFile = { registeredUsers: this.list() };
    writeFileSync(this.persistPath, JSON.stringify(data, null, 2));
  }
}
