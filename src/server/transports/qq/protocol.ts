/** GROUP_AND_C2C_EVENT — private chats and group @bot messages. */
export const QQ_INTENT_C2C = 1 << 25;
/** INTERACTION_CREATE — keyboard callback buttons. */
export const QQ_INTENT_INTERACTION = 1 << 26;
export const QQ_INTENTS = QQ_INTENT_C2C | QQ_INTENT_INTERACTION;

export const PASSIVE_REPLY_MS = 4 * 60 * 1000;

export interface GatewayFrame {
  op: number;
  d?: unknown;
  s?: number;
  t?: string;
}

export interface QqC2cMessage {
  id: string;
  content: string;
  userOpenId: string;
}

export interface QqInteraction {
  id: string;
  userOpenId: string;
  buttonData: string;
  scene: string;
}

export type QqParsedFrame =
  | { type: 'hello'; heartbeatInterval: number }
  | { type: 'ready'; sessionId: string }
  | { type: 'resumed' }
  | { type: 'reconnect' }
  | { type: 'invalid-session' }
  | { type: 'heartbeat-ack' }
  | { type: 'c2c'; message: QqC2cMessage }
  | { type: 'interaction'; interaction: QqInteraction }
  | { type: 'ignore' };

export function qqApiBase(sandbox: boolean): string {
  return sandbox ? 'https://sandbox.api.sgroup.qq.com' : 'https://api.bot.qq.com';
}

export function identifyFrame(accessToken: string): GatewayFrame {
  return {
    op: 2,
    d: {
      token: `QQBot ${accessToken}`,
      intents: QQ_INTENTS,
      shard: [0, 1],
      properties: { $os: process.platform, $browser: 'cursor-remote', $device: 'cursor-remote' },
    },
  };
}

export function resumeFrame(accessToken: string, sessionId: string, seq: number | null): GatewayFrame {
  return {
    op: 6,
    d: { token: `QQBot ${accessToken}`, session_id: sessionId, seq },
  };
}

export function heartbeatFrame(seq: number | null): GatewayFrame {
  return { op: 1, d: seq };
}

export function parseGatewayFrame(frame: GatewayFrame): QqParsedFrame {
  if (frame.op === 10) {
    const interval = numberField(frame.d, 'heartbeat_interval') ?? 45_000;
    return { type: 'hello', heartbeatInterval: interval };
  }
  if (frame.op === 7) return { type: 'reconnect' };
  if (frame.op === 9) return { type: 'invalid-session' };
  if (frame.op === 11) return { type: 'heartbeat-ack' };
  if (frame.op !== 0) return { type: 'ignore' };

  if (frame.t === 'READY') {
    const sessionId = stringField(frame.d, 'session_id');
    return sessionId ? { type: 'ready', sessionId } : { type: 'ignore' };
  }
  if (frame.t === 'RESUMED') return { type: 'resumed' };
  if (frame.t === 'C2C_MESSAGE_CREATE') {
    const message = parseC2c(frame.d);
    return message ? { type: 'c2c', message } : { type: 'ignore' };
  }
  if (frame.t === 'INTERACTION_CREATE') {
    const interaction = parseInteraction(frame.d);
    return interaction ? { type: 'interaction', interaction } : { type: 'ignore' };
  }
  return { type: 'ignore' };
}

export function parseC2c(data: unknown): QqC2cMessage | null {
  if (!data || typeof data !== 'object') return null;
  const raw = data as Record<string, unknown>;
  const id = typeof raw.id === 'string' ? raw.id : '';
  const content = typeof raw.content === 'string' ? raw.content : '';
  const author = raw.author;
  const userOpenId = author && typeof author === 'object'
    ? stringField(author, 'user_openid') || stringField(author, 'id')
    : '';
  if (!id || !userOpenId) return null;
  return { id, content, userOpenId };
}

export function parseInteraction(data: unknown): QqInteraction | null {
  if (!data || typeof data !== 'object') return null;
  const raw = data as Record<string, unknown>;
  const id = typeof raw.id === 'string' ? raw.id : '';
  const userOpenId = typeof raw.user_openid === 'string' ? raw.user_openid : '';
  const scene = typeof raw.scene === 'string' ? raw.scene : '';
  const buttonData = readButtonData(raw.data);
  if (!id || !userOpenId || !buttonData) return null;
  if (scene && scene !== 'c2c') return null;
  return { id, userOpenId, buttonData, scene: scene || 'c2c' };
}

function readButtonData(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const raw = data as Record<string, unknown>;
  const resolved = (raw.resolved ?? raw.resoloved) as unknown;
  if (!resolved || typeof resolved !== 'object') return '';
  const button = (resolved as Record<string, unknown>).button_data;
  return typeof button === 'string' ? button : '';
}

function stringField(value: unknown, key: string): string {
  if (!value || typeof value !== 'object') return '';
  const field = (value as Record<string, unknown>)[key];
  return typeof field === 'string' ? field : '';
}

function numberField(value: unknown, key: string): number | null {
  if (!value || typeof value !== 'object') return null;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === 'number' ? field : null;
}
