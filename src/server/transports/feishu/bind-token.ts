export const BIND_TOKEN_TTL_MS = 60_000;

export interface BindChallenge {
  token: string;
  expiresAt: number;
  command: string;
  appLink: string;
}

export function generateBindToken(random: () => number = Math.random): string {
  const n = Math.floor(100000 + random() * 900000);
  return String(n).padStart(6, '0').slice(0, 6);
}

export function feishuAppLink(appId: string): string {
  const id = appId.trim();
  if (!id) return '';
  return `https://applink.feishu.cn/client/bot/open?appId=${encodeURIComponent(id)}`;
}

export function buildBindChallenge(appId: string, token: string, now = Date.now()): BindChallenge {
  return {
    token,
    expiresAt: now + BIND_TOKEN_TTL_MS,
    command: `/bind ${token}`,
    appLink: feishuAppLink(appId),
  };
}

export function isBindTokenValid(
  challenge: BindChallenge | null,
  token: string,
  now = Date.now(),
): boolean {
  if (!challenge) return false;
  if (now >= challenge.expiresAt) return false;
  return challenge.token === token.trim();
}

export class BindTokenStore {
  private challenge: BindChallenge;

  constructor(
    private readonly appId: string,
    private readonly now: () => number = Date.now,
    private readonly random: () => number = Math.random,
  ) {
    this.challenge = buildBindChallenge(appId, generateBindToken(random), this.now());
  }

  current(): BindChallenge {
    if (this.now() >= this.challenge.expiresAt) this.rotate();
    return this.challenge;
  }

  rotate(): BindChallenge {
    this.challenge = buildBindChallenge(this.appId, generateBindToken(this.random), this.now());
    return this.challenge;
  }

  /** One-time use. A matching token is consumed even when accepted. */
  consume(token: string): boolean {
    const ok = isBindTokenValid(this.challenge, token, this.now());
    if (ok) this.rotate();
    return ok;
  }
}
