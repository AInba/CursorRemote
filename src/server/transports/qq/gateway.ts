import WebSocket from 'ws';
import {
  heartbeatFrame,
  identifyFrame,
  parseGatewayFrame,
  resumeFrame,
  type GatewayFrame,
  type QqParsedFrame,
} from './protocol.js';

export interface QqGatewayOptions {
  gatewayUrl: () => Promise<string>;
  accessToken: () => Promise<string>;
  onEvent: (event: QqParsedFrame) => void;
  onLog?: (line: string) => void;
}

export class QqGateway {
  private ws: WebSocket | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private seq: number | null = null;
  private sessionId: string | null = null;
  private stopped = false;
  private backoffMs = 2000;
  private readyWait: { resolve: () => void; reject: (err: Error) => void } | null = null;

  constructor(private readonly options: QqGatewayOptions) {}

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.readyWait = { resolve, reject };
      void this.open();
    });
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.clearHeartbeat();
    this.ws?.close();
    this.ws = null;
  }

  private log(line: string): void {
    (this.options.onLog ?? ((msg) => console.log(msg)))(line);
  }

  private async open(): Promise<void> {
    if (this.stopped) return;
    let url: string;
    let token: string;
    try {
      [url, token] = await Promise.all([this.options.gatewayUrl(), this.options.accessToken()]);
    } catch (err) {
      this.failOrRetry(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    const ws = new WebSocket(url);
    this.ws = ws;
    const resume = Boolean(this.sessionId);
    ws.on('message', (data) => {
      this.onMessage(ws, token, data.toString(), resume);
    });
    ws.on('close', (code, reason) => {
      this.clearHeartbeat();
      const why = reason.toString() || String(code);
      this.log(`[qq] gateway closed ${code} ${why}`);
      if (code === 4914) {
        this.log('[qq] Bot is sandbox-only. Turn on QQ sandbox in Setup (or QQ_SANDBOX=true) and restart.');
      }
      if (code === 4006 || code === 4009) this.sessionId = null;
      if (!this.stopped) this.scheduleReconnect();
    });
    ws.on('error', (err) => {
      this.log(`[qq] gateway error: ${err.message}`);
    });
  }

  private onMessage(ws: WebSocket, token: string, raw: string, preferResume: boolean): void {
    let frame: GatewayFrame;
    try {
      frame = JSON.parse(raw) as GatewayFrame;
    } catch {
      return;
    }
    if (typeof frame.s === 'number') this.seq = frame.s;
    const parsed = parseGatewayFrame(frame);
    if (parsed.type === 'hello') {
      const helloResume = preferResume && this.sessionId;
      const payload = helloResume
        ? resumeFrame(token, this.sessionId as string, this.seq)
        : identifyFrame(token);
      ws.send(JSON.stringify(payload));
      this.armHeartbeat(parsed.heartbeatInterval, ws);
      return;
    }
    if (parsed.type === 'ready') {
      this.sessionId = parsed.sessionId;
      this.backoffMs = 2000;
      this.readyWait?.resolve();
      this.readyWait = null;
      this.log('[qq] gateway ready');
      return;
    }
    if (parsed.type === 'resumed') {
      this.backoffMs = 2000;
      this.log('[qq] gateway resumed');
      return;
    }
    if (parsed.type === 'invalid-session') {
      this.sessionId = null;
      this.log('[qq] session rejected, will identify again');
      return;
    }
    if (parsed.type === 'reconnect') {
      ws.close();
      return;
    }
    if (parsed.type === 'c2c' || parsed.type === 'interaction') {
      this.options.onEvent(parsed);
    }
  }

  private armHeartbeat(intervalMs: number, ws: WebSocket): void {
    this.clearHeartbeat();
    const every = Math.max(5_000, intervalMs);
    this.heartbeat = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(heartbeatFrame(this.seq)));
      }
    }, every);
  }

  private clearHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.stopped) return;
    const wait = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, 60_000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.open();
    }, wait);
  }

  private failOrRetry(err: Error): void {
    this.log(`[qq] ${err.message}`);
    this.scheduleReconnect();
  }
}
