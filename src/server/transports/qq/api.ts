export interface QqHttp {
  (url: string, init?: RequestInit): Promise<Response>;
}

export class QqApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
  }
}

export class QqApi {
  private token = '';
  private tokenExp = 0;
  private seqByMsg = new Map<string, number>();

  constructor(
    private readonly appId: string,
    private readonly appSecret: string,
    private readonly baseUrl: string,
    private readonly http: QqHttp = fetch,
  ) {}

  async accessToken(now = Date.now()): Promise<string> {
    if (this.token && now < this.tokenExp - 60_000) return this.token;
    const res = await this.http(`${this.baseUrl}/app/getAppAccessToken`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId: this.appId, clientSecret: this.appSecret }),
    });
    const text = await res.text();
    const body = parseJson(text);
    const token = typeof body.access_token === 'string' ? body.access_token : '';
    if (!res.ok || !token) {
      throw new QqApiError(`QQ access token failed (${res.status})`, res.status, text);
    }
    const expires = Number(body.expires_in) || 7200;
    this.token = token;
    this.tokenExp = now + expires * 1000;
    return token;
  }

  async gatewayUrl(): Promise<string> {
    const body = await this.request('GET', '/gateway');
    if (typeof body.url !== 'string' || !body.url) {
      throw new QqApiError('QQ gateway response missing url', 200, JSON.stringify(body));
    }
    return body.url;
  }

  async sendC2cText(userOpenId: string, content: string, msgId?: string): Promise<void> {
    const payload: Record<string, unknown> = {
      content: content.slice(0, 1500),
      msg_type: 0,
    };
    if (msgId) {
      payload.msg_id = msgId;
      payload.msg_seq = this.nextSeq(msgId);
    }
    await this.request('POST', `/v2/users/${encodeURIComponent(userOpenId)}/messages`, payload);
  }

  async sendC2cMarkdown(
    userOpenId: string,
    markdown: string,
    keyboard: object,
    msgId?: string,
  ): Promise<void> {
    const payload: Record<string, unknown> = {
      msg_type: 2,
      markdown: { content: markdown.slice(0, 1500) },
      keyboard,
    };
    if (msgId) {
      payload.msg_id = msgId;
      payload.msg_seq = this.nextSeq(msgId);
    }
    await this.request('POST', `/v2/users/${encodeURIComponent(userOpenId)}/messages`, payload);
  }

  async ackInteraction(interactionId: string): Promise<void> {
    await this.request('PUT', `/interactions/${encodeURIComponent(interactionId)}`, { code: 0 });
  }

  nextSeq(msgId: string): number {
    const next = (this.seqByMsg.get(msgId) ?? 0) + 1;
    this.seqByMsg.set(msgId, next);
    return next;
  }

  private async request(method: string, path: string, body?: object): Promise<Record<string, unknown>> {
    const token = await this.accessToken();
    const res = await this.http(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `QQBot ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const parsed = text ? parseJson(text) : {};
    if (!res.ok) {
      throw new QqApiError(`QQ ${method} ${path} failed (${res.status})`, res.status, text);
    }
    return parsed;
  }
}

function parseJson(text: string): Record<string, unknown> {
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === 'object' ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
