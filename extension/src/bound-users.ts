import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

interface NamedUser {
  openId?: string;
}

interface SessionRow {
  openId?: string;
}

/** Drops a Feishu or QQ user from the data directory when the relay is not running. */
export function removeBoundUser(dataDir: string, transport: 'feishu' | 'qq', openId: string): boolean {
  const authRemoved = rewriteList(join(dataDir, `${transport}-auth.json`), 'registeredUsers', openId);
  rewriteList(join(dataDir, `${transport}-sessions.json`), 'sessions', openId);
  return authRemoved;
}

function rewriteList(path: string, key: 'registeredUsers' | 'sessions', openId: string): boolean {
  if (!existsSync(path)) return false;
  const raw = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
  const list = Array.isArray(raw[key]) ? raw[key] as Array<NamedUser & SessionRow> : [];
  const next = list.filter(item => item?.openId !== openId);
  if (next.length === list.length) return false;
  raw[key] = next;
  writeFileSync(path, JSON.stringify(raw, null, 2));
  return true;
}
