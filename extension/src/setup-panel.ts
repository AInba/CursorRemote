import * as vscode from 'vscode';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { FEISHU_APP_SECRET_SECRET_KEY, QQ_APP_SECRET_SECRET_KEY, TELEGRAM_BOT_TOKEN_SECRET_KEY } from './secrets.js';
import { probeCdp } from './cdp-probe.js';
import { lanNeedsPassword, setupCopy } from './setup-copy.js';
import { removeBoundUser } from './bound-users.js';

interface TelegramAuth {
  token: string;
  registeredUsers: { id: number; username?: string; firstName?: string; registeredAt?: string }[];
}

function loadTelegramAuth(context: vscode.ExtensionContext): TelegramAuth | null {
  const dataDir = context.globalStorageUri.fsPath;
  const authPath = join(dataDir, 'telegram-auth.json');
  try {
    if (existsSync(authPath)) {
      return JSON.parse(readFileSync(authPath, 'utf-8'));
    }
  } catch { /* not available */ }
  return null;
}

interface FeishuUser {
  openId: string;
  name?: string;
  registeredAt?: string;
}

interface FeishuBindView {
  token: string;
  command: string;
  expiresAt: number;
  appLink: string;
  commandQr: string;
  appLinkQr: string;
}

function svgDataUri(path: string): string {
  try {
    if (!existsSync(path)) return '';
    const svg = readFileSync(path);
    return `data:image/svg+xml;base64,${svg.toString('base64')}`;
  } catch {
    return '';
  }
}

function loadNamedUsers(context: vscode.ExtensionContext, fileName: string): FeishuUser[] {
  const authPath = join(context.globalStorageUri.fsPath, fileName);
  try {
    if (!existsSync(authPath)) return [];
    const raw = JSON.parse(readFileSync(authPath, 'utf-8')) as { registeredUsers?: FeishuUser[] };
    return raw.registeredUsers ?? [];
  } catch {
    return [];
  }
}

function loadNamedBind(context: vscode.ExtensionContext, prefix: string): FeishuBindView | null {
  const dataDir = context.globalStorageUri.fsPath;
  const bindPath = join(dataDir, `${prefix}-bind.json`);
  try {
    if (!existsSync(bindPath)) return null;
    const raw = JSON.parse(readFileSync(bindPath, 'utf-8')) as {
      token?: string;
      command?: string;
      expiresAt?: number;
      appLink?: string;
    };
    if (!raw.token || !raw.command) return null;
    return {
      token: raw.token,
      command: raw.command,
      expiresAt: raw.expiresAt ?? 0,
      appLink: raw.appLink ?? '',
      commandQr: svgDataUri(join(dataDir, `${prefix}-qr-command.svg`)),
      appLinkQr: svgDataUri(join(dataDir, `${prefix}-qr-applink.svg`)),
    };
  } catch {
    return null;
  }
}

function loadFeishuUsers(context: vscode.ExtensionContext): FeishuUser[] {
  return loadNamedUsers(context, 'feishu-auth.json');
}

function loadFeishuBind(context: vscode.ExtensionContext): FeishuBindView | null {
  return loadNamedBind(context, 'feishu');
}

function loadQqUsers(context: vscode.ExtensionContext): FeishuUser[] {
  return loadNamedUsers(context, 'qq-auth.json');
}

function loadQqBind(context: vscode.ExtensionContext): FeishuBindView | null {
  return loadNamedBind(context, 'qq');
}

export class SetupPanel {
  public static currentPanel: SetupPanel | undefined;
  private static readonly viewType = 'cursorRemote.setup';
  private readonly panel: vscode.WebviewPanel;
  private readonly context: vscode.ExtensionContext;
  private disposables: vscode.Disposable[] = [];
  private bindTimer: ReturnType<typeof setInterval> | undefined;
  private cdpWarned = false;
  private _disposed = false;

  public static createOrShow(context: vscode.ExtensionContext): void {
    if (SetupPanel.currentPanel) {
      SetupPanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      void SetupPanel.currentPanel.updateWebview().then(() => SetupPanel.currentPanel?.pushLinkStatus());
      return;
    }

    const zh = vscode.env.language.toLowerCase().startsWith('zh');
    const panel = vscode.window.createWebviewPanel(
      SetupPanel.viewType,
      zh ? 'CursorRemote 设置' : 'CursorRemote Setup',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    SetupPanel.currentPanel = new SetupPanel(panel, context);
  }

  private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
    this.panel = panel;
    this.context = context;

    void this.updateWebview().then(() => this.pushLinkStatus());

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      async (msg) => this.handleMessage(msg),
      null,
      this.disposables
    );

    this.bindTimer = setInterval(() => {
      void this.pushFeishuBind();
      void this.pushLinkStatus();
    }, 15_000);
  }

  private async handleMessage(msg: { type: string; [key: string]: unknown }): Promise<void> {
    const config = vscode.workspace.getConfiguration('cursorRemote');
    switch (msg.type) {
      case 'setNetworking': {
        const mode = msg.mode as string;
        let host = config.get<string>('serverHost', '127.0.0.1') ?? '127.0.0.1';
        if (mode === 'localhost') {
          host = '127.0.0.1';
          await config.update('serverHost', host, vscode.ConfigurationTarget.Global);
        } else if (mode === 'custom') {
          const addr = (msg.address as string || '').trim();
          if (addr) {
            host = addr;
            await config.update('serverHost', host, vscode.ConfigurationTarget.Global);
          }
        } else {
          host = '0.0.0.0';
          await config.update('serverHost', host, vscode.ConfigurationTarget.Global);
        }
        const password = config.get<string>('webappPassword', '') ?? '';
        if (lanNeedsPassword(host, password)) {
          void vscode.window.showWarningMessage(setupCopy(vscode.env.language.toLowerCase().startsWith('zh')).lanOpenWarning);
        }
        await this.updateWebview();
        break;
      }
      case 'copySettingsFilter': {
        vscode.env.clipboard.writeText('@ext:cursor-remote.cursor-remote');
        vscode.window.showInformationMessage('Filter copied — paste it in the Settings search bar.');
        break;
      }
      case 'copyPassword': {
        const pw = config.get<string>('webappPassword', '');
        if (pw) {
          await vscode.env.clipboard.writeText(pw);
          vscode.window.showInformationMessage('Password copied to clipboard.');
        }
        break;
      }
      case 'savePassword': {
        const newPw = (msg.password as string).trim();
        await config.update('webappPassword', newPw, vscode.ConfigurationTarget.Global);
        const host = config.get<string>('serverHost', '127.0.0.1') ?? '';
        if (lanNeedsPassword(host, newPw)) {
          void vscode.window.showWarningMessage(setupCopy(vscode.env.language.toLowerCase().startsWith('zh')).lanOpenWarning);
        } else {
          vscode.window.showInformationMessage(
            newPw ? 'Password updated. Restart the server for changes to take effect.' : 'Password cleared.'
          );
        }
        await this.updateWebview();
        break;
      }
      case 'saveTelegramToken': {
        const token = (msg.token as string).trim();
        if (token) {
          await this.context.secrets.store(TELEGRAM_BOT_TOKEN_SECRET_KEY, token);
          await config.update('telegram.enabled', true, vscode.ConfigurationTarget.Global);
          await this.updateWebview();
        }
        break;
      }
      case 'setTelegramImpl': {
        const impl = msg.impl as string;
        if (impl === 'grammy' || impl === 'raw') {
          await config.update('telegram.impl', impl, vscode.ConfigurationTarget.Global);
          vscode.window.showInformationMessage(
            `Telegram transport set to "${impl}". Restart the server for changes to take effect.`
          );
          await this.updateWebview();
        }
        break;
      }
      case 'openExternal': {
        const url = msg.url as string;
        vscode.env.openExternal(vscode.Uri.parse(url));
        break;
      }
      case 'restartServer': {
        vscode.commands.executeCommand('cursorRemote.restart');
        break;
      }
      case 'refresh': {
        await this.updateWebview();
        break;
      }
      case 'saveFeishu': {
        const appId = String(msg.appId ?? '').trim();
        const appSecret = String(msg.appSecret ?? '').trim();
        if (!appId) {
          vscode.window.showWarningMessage('Feishu App ID is required.');
          break;
        }
        const existingSecret = await this.context.secrets.get(FEISHU_APP_SECRET_SECRET_KEY);
        if (!appSecret && !existingSecret) {
          vscode.window.showWarningMessage('Feishu App Secret is required.');
          break;
        }
        await config.update('feishu.appId', appId, vscode.ConfigurationTarget.Global);
        if (appSecret) {
          await this.context.secrets.store(FEISHU_APP_SECRET_SECRET_KEY, appSecret);
        }
        await config.update('feishu.enabled', true, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(
          'Feishu credentials saved. Restart the server to connect.'
        );
        await this.updateWebview();
        break;
      }
      case 'saveQq': {
        const appId = String(msg.appId ?? '').trim();
        const appSecret = String(msg.appSecret ?? '').trim();
        const sandbox = msg.sandbox === true;
        if (!appId) {
          vscode.window.showWarningMessage('QQ App ID is required.');
          break;
        }
        const existingSecret = await this.context.secrets.get(QQ_APP_SECRET_SECRET_KEY);
        if (!appSecret && !existingSecret) {
          vscode.window.showWarningMessage('QQ App Secret is required.');
          break;
        }
        await config.update('qq.appId', appId, vscode.ConfigurationTarget.Global);
        await config.update('qq.sandbox', sandbox, vscode.ConfigurationTarget.Global);
        if (appSecret) {
          await this.context.secrets.store(QQ_APP_SECRET_SECRET_KEY, appSecret);
        }
        await config.update('qq.enabled', true, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(
          'QQ credentials saved. Restart the server to connect.'
        );
        await this.updateWebview();
        break;
      }
      case 'unbindUser': {
        const transport = msg.transport === 'qq' ? 'qq' : msg.transport === 'feishu' ? 'feishu' : '';
        const openId = String(msg.openId ?? '').trim();
        const copy = setupCopy(vscode.env.language.toLowerCase().startsWith('zh'));
        if (!transport || !openId) break;
        const live = await requestLocalUnbind(config, transport, openId);
        if (live === 'down') {
          const removed = removeBoundUser(this.context.globalStorageUri.fsPath, transport, openId);
          void vscode.window.showInformationMessage(removed ? copy.userRemovedOffline : copy.userMissing);
        } else if (live === 'refused') {
          void vscode.window.showWarningMessage(copy.userRemoveRefused);
        } else if (live.removed) {
          void vscode.window.showInformationMessage(live.restoredOnRestart ? copy.userRemovedAllowlist : copy.userRemoved);
        } else {
          void vscode.window.showInformationMessage(copy.userMissing);
        }
        await this.updateWebview();
        break;
      }
    }
  }

  private async pushFeishuBind(): Promise<void> {
    if (this._disposed) return;
    const bind = loadFeishuBind(this.context);
    const users = loadFeishuUsers(this.context);
    await this.panel.webview.postMessage({ type: 'feishuBind', bind, users });
    await this.panel.webview.postMessage({
      type: 'qqBind',
      bind: loadQqBind(this.context),
      users: loadQqUsers(this.context),
    });
  }

  private async pushLinkStatus(): Promise<void> {
    if (this._disposed) return;
    const config = vscode.workspace.getConfiguration('cursorRemote');
    const zh = vscode.env.language.toLowerCase().startsWith('zh');
    const cdp = await probeCdp(config.get<string>('cdpUrl', 'http://127.0.0.1:9222'));
    let cdpText: string;
    if (cdp.ok) {
      cdpText = zh
        ? `Cursor 调试端口已打开（${cdp.detail} 个页面）。`
        : `Cursor debug port is open (${cdp.detail} pages).`;
    } else if (cdp.detail === 'closed') {
      cdpText = zh
        ? '调试端口没打开。请完全退出 Cursor（macOS 用 Cmd+Q），用 --remote-debugging-port=9222 重新启动。'
        : 'The debug port is closed. Fully quit Cursor (Cmd+Q on macOS), then start it with --remote-debugging-port=9222.';
      if (!this.cdpWarned) {
        this.cdpWarned = true;
        void vscode.window.showWarningMessage(cdpText);
      }
    } else if (cdp.detail === 'no-pages') {
      cdpText = zh
        ? '调试端口开着，但没有 Cursor 页面。请完全退出后再启动。'
        : 'The debug port is open, but no Cursor page is listed. Fully quit Cursor, then start it again.';
    } else {
      cdpText = zh ? `调试端口异常：${cdp.detail}` : `Debug port error: ${cdp.detail}`;
    }

    const health = await readRelayHealth(config);
    await this.panel.webview.postMessage({
      type: 'linkStatus',
      cdpText,
      feishu: describeLink('feishu', config.get<boolean>('feishu.enabled', false), health, zh),
      qq: describeLink('qq', config.get<boolean>('qq.enabled', false), health, zh),
    });
  }

  private async updateWebview(): Promise<void> {
    const config = vscode.workspace.getConfiguration('cursorRemote');
    const telegramAuth = loadTelegramAuth(this.context);
    const telegramBotToken = await this.context.secrets.get(TELEGRAM_BOT_TOKEN_SECRET_KEY);
    const feishuAppSecret = await this.context.secrets.get(FEISHU_APP_SECRET_SECRET_KEY);
    const qqAppSecret = await this.context.secrets.get(QQ_APP_SECRET_SECRET_KEY);
    const state = {
      serverHost: config.get<string>('serverHost', '127.0.0.1'),
      serverPort: config.get<number>('serverPort', 3000),
      webappPassword: config.get<string>('webappPassword', ''),
      telegramEnabled: config.get<boolean>('telegram.enabled', false),
      telegramBotToken: telegramBotToken ?? '',
      telegramImpl: config.get<string>('telegram.impl', 'grammy'),
      telegramRegisterToken: telegramAuth?.token ?? '',
      telegramRegisteredUsers: telegramAuth?.registeredUsers ?? [],
      feishuEnabled: config.get<boolean>('feishu.enabled', false),
      feishuAppId: config.get<string>('feishu.appId', ''),
      feishuHasSecret: Boolean(feishuAppSecret),
      feishuBind: loadFeishuBind(this.context),
      feishuUsers: loadFeishuUsers(this.context),
      qqEnabled: config.get<boolean>('qq.enabled', false),
      qqAppId: config.get<string>('qq.appId', ''),
      qqHasSecret: Boolean(qqAppSecret),
      qqSandbox: config.get<boolean>('qq.sandbox', false),
      qqBind: loadQqBind(this.context),
      qqUsers: loadQqUsers(this.context),
    };
    this.panel.webview.html = getWebviewContent(state);
  }

  private dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    if (this.bindTimer) clearInterval(this.bindTimer);
    SetupPanel.currentPanel = undefined;
    this.panel.dispose();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }
}

interface PanelState {
  serverHost: string;
  serverPort: number;
  webappPassword: string;
  telegramEnabled: boolean;
  telegramBotToken: string;
  telegramImpl: string;
  telegramRegisterToken: string;
  telegramRegisteredUsers: { id: number; username?: string; firstName?: string; registeredAt?: string }[];
  feishuEnabled: boolean;
  feishuAppId: string;
  feishuHasSecret: boolean;
  feishuBind: FeishuBindView | null;
  feishuUsers: FeishuUser[];
  qqEnabled: boolean;
  qqAppId: string;
  qqHasSecret: boolean;
  qqSandbox: boolean;
  qqBind: FeishuBindView | null;
  qqUsers: FeishuUser[];
}

interface RelayHealthBody {
  transports?: {
    feishu?: { state?: string; detail?: string };
    qq?: { state?: string; detail?: string };
  };
}

async function readRelayHealth(config: vscode.WorkspaceConfiguration): Promise<RelayHealthBody | null> {
  const host = config.get<string>('serverHost', '127.0.0.1');
  const port = config.get<number>('serverPort', 3000);
  const displayHost = host === '0.0.0.0' ? '127.0.0.1' : host;
  try {
    const resp = await fetch(`http://${displayHost}:${port}/health`, { signal: AbortSignal.timeout(2000) });
    if (!resp.ok) return null;
    return await resp.json() as RelayHealthBody;
  } catch {
    return null;
  }
}

async function requestLocalUnbind(
  config: vscode.WorkspaceConfiguration,
  transport: 'feishu' | 'qq',
  openId: string,
): Promise<'down' | 'refused' | { removed: boolean; restoredOnRestart: boolean }> {
  const host = config.get<string>('serverHost', '127.0.0.1');
  const port = config.get<number>('serverPort', 3000);
  const displayHost = host === '0.0.0.0' ? '127.0.0.1' : host;
  try {
    const resp = await fetch(`http://${displayHost}:${port}/local/unbind`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ transport, openId }),
      signal: AbortSignal.timeout(2000),
    });
    if (!resp.ok) return 'refused';
    const body = await resp.json() as { removed?: boolean; restoredOnRestart?: boolean };
    return { removed: body.removed === true, restoredOnRestart: body.restoredOnRestart === true };
  } catch {
    return 'down';
  }
}

function describeLink(
  name: 'feishu' | 'qq',
  enabled: boolean,
  health: RelayHealthBody | null,
  zh: boolean,
): string {
  const label = name === 'feishu' ? (zh ? '飞书' : 'Feishu') : 'QQ';
  if (!enabled) return zh ? `${label}未启用。` : `${label} is off.`;
  if (!health) return zh ? '中继没在运行。保存凭证后需要重启。' : 'The relay is not running. Save credentials, then restart.';
  const link = health.transports?.[name];
  if (!link) return zh ? '中继还没有报告连接状态。重启后再看。' : 'The relay has not reported a connection yet. Restart and check again.';
  if (link.state === 'ready') return link.detail || (zh ? `${label}已连接。` : `${label} is connected.`);
  if (link.state === 'starting') return link.detail || (zh ? `正在连接${label}…` : `Connecting to ${label}…`);
  if (link.state === 'error') return link.detail || (zh ? `${label}连接失败。` : `${label} failed to connect.`);
  return zh
    ? `${label}已在设置里启用，但中继还没加载（缺凭证或尚未重启）。`
    : `${label} is enabled in settings, but the relay has not loaded it (missing credentials, or it has not been restarted).`;
}

function getWebviewContent(state: PanelState): string {
  const networkMode = state.serverHost === '127.0.0.1' ? 'localhost'
    : state.serverHost === '0.0.0.0' ? 'lan' : 'custom';
  const customAddress = networkMode === 'custom' ? state.serverHost : '';
  const hasBotToken = !!state.telegramBotToken;
  const maskedToken = hasBotToken
    ? state.telegramBotToken.slice(0, 6) + '...' + state.telegramBotToken.slice(-4)
    : '';
  const bind = state.feishuBind;
  const qqBind = state.qqBind;
  const c = setupCopy(vscode.env.language.toLowerCase().startsWith('zh'));
  const ui = JSON.stringify({
    copied: c.copied,
    expiryLeft: c.expiryLeft,
    expiryGone: c.expiryGone,
    waitingCode: c.waitingCode,
    boundPrefix: c.boundPrefix,
    removeUser: c.removeUser,
    feishuNone: c.feishuNone,
    qqNone: c.qqNone,
  });
  const boundUsers = JSON.stringify({ feishu: state.feishuUsers, qq: state.qqUsers });
  const qqCommandQr = qqBind?.commandQr
    ? `<img class="qr" alt="QQ bind command QR" src="${qqBind.commandQr}" />`
    : '';
  const commandQr = bind?.commandQr
    ? `<img class="qr" alt="Bind command QR" src="${bind.commandQr}" />`
    : '';
  const appLinkQr = bind?.appLinkQr
    ? `<img class="qr" alt="Open Feishu bot QR" src="${bind.appLinkQr}" />`
    : '';
  const feishuSecretPh = state.feishuHasSecret ? c.feishuSecretSaved : c.feishuSecretNew;
  const qqSecretPh = state.qqHasSecret ? c.feishuSecretSaved : c.feishuSecretNew;
  const openHost = state.serverHost === '0.0.0.0' ? '&lt;your-ip&gt;' : escapeHtml(state.serverHost);

  return /*html*/ `<!DOCTYPE html>
<html lang="${c.htmlLang}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${c.title}</title>
  <style>
    :root {
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --border: var(--vscode-panel-border, var(--vscode-widget-border, #444));
      --btn-bg: var(--vscode-button-background);
      --btn-fg: var(--vscode-button-foreground);
      --btn-hover: var(--vscode-button-hoverBackground);
      --btn-secondary-bg: var(--vscode-button-secondaryBackground);
      --btn-secondary-fg: var(--vscode-button-secondaryForeground);
      --input-bg: var(--vscode-input-background);
      --input-fg: var(--vscode-input-foreground);
      --input-border: var(--vscode-input-border, var(--border));
      --success: var(--vscode-testing-iconPassed, #89d185);
      --warn: var(--vscode-editorWarning-foreground, #cca700);
      --link: var(--vscode-textLink-foreground);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family, system-ui, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      background: var(--bg);
      color: var(--fg);
      padding: 20px 28px;
      line-height: 1.5;
    }
    h1 {
      font-size: 1.6em;
      font-weight: 600;
      margin-bottom: 4px;
    }
    .subtitle {
      color: var(--vscode-descriptionForeground);
      margin-bottom: 24px;
    }

    /* Tabs */
    .tabs {
      display: flex;
      border-bottom: 1px solid var(--border);
      margin-bottom: 20px;
      gap: 0;
    }
    .tab {
      padding: 8px 20px;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      color: var(--vscode-descriptionForeground);
      transition: color 0.15s, border-color 0.15s;
      user-select: none;
    }
    .tab:hover { color: var(--fg); }
    .tab.active {
      color: var(--fg);
      border-bottom-color: var(--btn-bg);
    }
    .tab-content { display: none; }
    .tab-content.active { display: block; }

    /* Cards */
    .card {
      background: var(--vscode-sideBar-background, var(--bg));
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 16px 20px;
      margin-bottom: 16px;
    }
    .card h3 {
      font-size: 1.05em;
      margin-bottom: 8px;
    }
    .card p { margin-bottom: 8px; }

    /* Radio options */
    .radio-group { display: flex; flex-direction: column; gap: 10px; margin: 12px 0; }
    .radio-option {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 10px 14px;
      border: 1px solid var(--border);
      border-radius: 6px;
      cursor: pointer;
      transition: border-color 0.15s;
    }
    .radio-option:hover { border-color: var(--btn-bg); }
    .radio-option.selected {
      border-color: var(--btn-bg);
      background: color-mix(in srgb, var(--btn-bg) 10%, transparent);
    }
    .radio-option input { margin-top: 3px; accent-color: var(--btn-bg); }
    .radio-label strong { display: block; margin-bottom: 2px; }
    .radio-label span { color: var(--vscode-descriptionForeground); font-size: 0.92em; }

    /* Buttons */
    button {
      font-family: inherit;
      font-size: inherit;
      padding: 6px 14px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      color: var(--btn-fg);
      background: var(--btn-bg);
      transition: background 0.15s;
    }
    button:hover { background: var(--btn-hover); }
    button.secondary {
      background: var(--btn-secondary-bg);
      color: var(--btn-secondary-fg);
    }
    button.secondary:hover { opacity: 0.85; }
    .lan-warn {
      margin-top: 10px;
      padding: 8px 10px;
      border-radius: 4px;
      background: var(--vscode-inputValidation-warningBackground);
      color: var(--vscode-inputValidation-warningForeground, var(--vscode-foreground));
      border: 1px solid var(--vscode-inputValidation-warningBorder);
    }
    .bound-row { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
    .bound-row button { padding: 2px 10px; }

    /* Input fields */
    input[type="text"], input[type="password"] {
      width: 100%;
      padding: 6px 10px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: inherit;
      border: 1px solid var(--input-border);
      border-radius: 4px;
      background: var(--input-bg);
      color: var(--input-fg);
      outline: none;
    }
    input:focus { border-color: var(--btn-bg); }

    /* Password display */
    .password-row {
      display: flex;
      gap: 8px;
      align-items: center;
      margin: 8px 0;
    }
    .password-row code {
      flex: 1;
      padding: 6px 10px;
      background: var(--input-bg);
      border: 1px solid var(--input-border);
      border-radius: 4px;
      font-family: var(--vscode-editor-font-family, monospace);
      word-break: break-all;
    }

    /* Status badge */
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 0.85em;
      font-weight: 500;
    }
    .badge.done { background: color-mix(in srgb, var(--success) 20%, transparent); color: var(--success); }
    .badge.pending { background: color-mix(in srgb, var(--warn) 20%, transparent); color: var(--warn); }

    /* Wizard steps */
    .step {
      padding: 14px 0;
      border-bottom: 1px solid var(--border);
    }
    .step:last-child { border-bottom: none; }
    .step-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
    }
    .step-num {
      width: 26px; height: 26px;
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-weight: 600;
      font-size: 0.9em;
      background: var(--btn-bg);
      color: var(--btn-fg);
      flex-shrink: 0;
    }
    .step-num.done { background: var(--success); }

    a { color: var(--link); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .qr-grid { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 12px; }
    .qr-card { text-align: center; }
    .qr-card img, .qr { width: 160px; height: 160px; background: #fff; padding: 6px; border-radius: 4px; }
    .bind-code { font-size: 1.6em; letter-spacing: 0.2em; font-weight: 700; }

    .actions { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
    .info-text { color: var(--vscode-descriptionForeground); font-size: 0.92em; }
    .mt { margin-top: 12px; }
  </style>
</head>
<body>
  <h1>${c.title}</h1>
  <p class="subtitle">${c.subtitle}</p>

  <div class="tabs">
    <div class="tab active" data-tab="networking">${c.tabNetworking}</div>
    <div class="tab" data-tab="telegram">${c.tabTelegram}</div>
    <div class="tab" data-tab="feishu">${c.tabFeishu}</div>
    <div class="tab" data-tab="qq">${c.tabQq}</div>
  </div>

  <!-- Networking Tab -->
  <div id="tab-networking" class="tab-content active">
    <div class="card">
      <h3>${c.cdpHeading}</h3>
      <p class="info-text" id="cdpStatus">${c.cdpChecking}</p>
    </div>
    <div class="card">
      <h3>${c.bindHeading}</h3>
      <p>${c.bindIntro}</p>

      <div class="radio-group">
        <label class="radio-option ${networkMode === 'localhost' ? 'selected' : ''}">
          <input type="radio" name="netMode" value="localhost" ${networkMode === 'localhost' ? 'checked' : ''} />
          <div class="radio-label">
            <strong>${c.localhostTitle}</strong>
            <span>${c.localhostHint}</span>
          </div>
        </label>
        <label class="radio-option ${networkMode === 'lan' ? 'selected' : ''}">
          <input type="radio" name="netMode" value="lan" ${networkMode === 'lan' ? 'checked' : ''} />
          <div class="radio-label">
            <strong>${c.lanTitle}</strong>
            <span>${c.lanHint}</span>
          </div>
        </label>
        <label class="radio-option ${networkMode === 'custom' ? 'selected' : ''}">
          <input type="radio" name="netMode" value="custom" ${networkMode === 'custom' ? 'checked' : ''} />
          <div class="radio-label">
            <strong>${c.customTitle}</strong>
            <span>${c.customBeforeLink}<a href="#" onclick="event.stopPropagation(); sendMsg({type:'openExternal',url:'https://tailscale.com/'})">${c.tailscaleName}</a>${c.customAfterLink}</span>
            <div class="custom-addr-row" style="margin-top: 8px; ${networkMode === 'custom' ? '' : 'display:none;'}">
              <input type="text" id="customAddress" placeholder="${escapeHtml(c.customPlaceholder)}" value="${escapeHtml(customAddress)}" style="width: 200px;" />
            </div>
          </div>
        </label>
      </div>

      <div class="actions">
        <button id="saveNetworking">${c.saveRestart}</button>
      </div>
      <p id="lanPasswordWarn" class="lan-warn" ${lanNeedsPassword(state.serverHost, state.webappPassword) ? '' : 'hidden'}>${escapeHtml(c.lanOpenWarning)}</p>

      <p class="info-text mt">
        ${c.tailscaleBefore}<a href="#" onclick="sendMsg({type:'openExternal',url:'${c.networkingGuideUrl}'})">${c.tailscaleLink}</a>${c.tailscaleAfter}
      </p>
    </div>

    <div class="card">
      <h3>${c.passwordHeading}</h3>
      <p>${c.passwordIntro}</p>
      <div class="password-row">
        <input type="text" id="passwordInput" value="${escapeHtml(state.webappPassword)}" placeholder="${escapeHtml(c.passwordPlaceholder)}" style="flex:1;" />
        <button class="secondary" id="copyPassword">${c.copy}</button>
        <button id="savePassword">${c.save}</button>
      </div>
      <p class="info-text mt">
        ${c.openBefore} <strong>http://${openHost}:${state.serverPort}</strong>
      </p>
    </div>
  </div>

  <!-- Telegram Tab -->
  <div id="tab-telegram" class="tab-content">

    <div class="step">
      <div class="step-header">
        <div class="step-num ${hasBotToken ? 'done' : ''}">1</div>
        <strong>${c.tgStep1}</strong>
        <span class="badge ${hasBotToken ? 'done' : 'pending'}">${hasBotToken ? c.done : c.pending}</span>
      </div>
      <p>${c.tgCreateBefore}<a href="#" onclick="sendMsg({type:'openExternal',url:'https://t.me/BotFather'})">@BotFather</a>${c.tgCreateAfter}</p>
      ${hasBotToken
        ? `<p class="info-text mt">${c.tokenLabel}: <code>${escapeHtml(maskedToken)}</code></p>`
        : `<div class="mt">
            <input type="text" id="botTokenInput" placeholder="${escapeHtml(c.tokenPlaceholder)}" />
            <div class="actions">
              <button id="saveToken">${c.saveToken}</button>
            </div>
          </div>`
      }
    </div>

    <div class="step">
      <div class="step-header">
        <div class="step-num">2</div>
        <strong>${c.tgStep2}</strong>
      </div>
      <p>${c.tgGroupIntro}</p>
      <ol style="margin: 8px 0 0 20px;">
        <li>${c.tgGroupTopics}</li>
        <li>${c.tgGroupAdmin}</li>
      </ol>
    </div>

    <div class="step">
      <div class="step-header">
        <div class="step-num ${state.telegramRegisteredUsers.length > 0 ? 'done' : ''}">3</div>
        <strong>${c.tgStep3}</strong>
        <span class="badge ${state.telegramRegisteredUsers.length > 0 ? 'done' : 'pending'}">${state.telegramRegisteredUsers.length > 0 ? c.done : c.pending}</span>
      </div>
      ${state.telegramRegisteredUsers.length > 0
        ? `<p>${c.tgRegistered}: <strong>${escapeHtml(state.telegramRegisteredUsers.map(u => u.username ? '@' + u.username : u.firstName ?? String(u.id)).join(', '))}</strong></p>
           <p class="info-text mt">${c.tgRegisterOther}</p>`
        : `<p>${c.tgRegisterFirst}</p>`}
      ${state.telegramRegisterToken
        ? `<div class="password-row" style="margin:8px 0;">
            <code style="flex:1; padding:8px;">/register ${escapeHtml(state.telegramRegisterToken)}</code>
            <button class="secondary" onclick="navigator.clipboard.writeText('/register ${escapeHtml(state.telegramRegisterToken)}')">${c.copy}</button>
          </div>`
        : `<p class="info-text">${c.tgNoToken}</p>`}
    </div>

    <div class="step">
      <div class="step-header">
        <div class="step-num">4</div>
        <strong>${c.tgStep4}</strong>
      </div>
      <p>${c.tgSync}</p>
    </div>

    <div class="card" style="margin-top: 20px;">
      <h3>${c.engineHeading}</h3>
      <p>${c.engineIntro}</p>

      <div class="radio-group">
        <label class="radio-option ${state.telegramImpl === 'grammy' ? 'selected' : ''}">
          <input type="radio" name="tgImpl" value="grammy" ${state.telegramImpl === 'grammy' ? 'checked' : ''} />
          <div class="radio-label">
            <strong>${c.grammyTitle}</strong>
            <span>${c.grammyHint}</span>
          </div>
        </label>
        <label class="radio-option ${state.telegramImpl === 'raw' ? 'selected' : ''}">
          <input type="radio" name="tgImpl" value="raw" ${state.telegramImpl === 'raw' ? 'checked' : ''} />
          <div class="radio-label">
            <strong>${c.rawTitle}</strong>
            <span>${c.rawHintBefore}<code>"bot.init() failed: timed out"</code>${c.rawHintAfter}</span>
          </div>
        </label>
      </div>

      <div class="actions">
        <button id="saveTgImpl">${c.saveRestart}</button>
      </div>

      <p class="info-text mt">
        ${c.troubleBefore}<strong>${c.troubleRaw}</strong>${c.troubleAfter}<a href="#" onclick="sendMsg({type:'openExternal',url:'${c.telegramGuideUrl}'})">${c.troubleLink}</a>.
      </p>
    </div>

  </div>

  <div id="tab-feishu" class="tab-content">
    <div class="step">
      <div class="step-header">
        <div class="step-num ${state.feishuHasSecret && state.feishuAppId ? 'done' : ''}">1</div>
        <strong>${c.feishuStep1}</strong>
        <span class="badge ${state.feishuHasSecret && state.feishuAppId ? 'done' : 'pending'}">${state.feishuHasSecret && state.feishuAppId ? c.saved : c.pending}</span>
      </div>
      <p>${c.feishuIntro}<a href="#" onclick="sendMsg({type:'openExternal',url:'${c.feishuGuideUrl}'})">${c.tailscaleLink}</a>.</p>
      <div class="mt">
        <input type="text" id="feishuAppId" placeholder="${escapeHtml(c.feishuAppId)}" value="${escapeHtml(state.feishuAppId)}" />
        <input type="password" id="feishuAppSecret" placeholder="${escapeHtml(feishuSecretPh)}" style="margin-top:8px;" />
        <div class="actions">
          <button id="saveFeishu">${c.saveRestart}</button>
        </div>
        <p class="info-text" id="feishuLink">${c.feishuChecking}</p>
      </div>
    </div>

    <div class="step">
      <div class="step-header">
        <div class="step-num ${state.feishuUsers.length > 0 ? 'done' : ''}">2</div>
        <strong>${c.feishuStep2}</strong>
        <span class="badge ${state.feishuUsers.length > 0 ? 'done' : 'pending'}">${state.feishuUsers.length > 0 ? c.bound : c.pending}</span>
      </div>
      <p>${c.feishuBindIntro}</p>
      <p class="info-text">${c.feishuBindNote}</p>
      <div id="feishuUsers" class="info-text mt"></div>
      <p class="bind-code" id="feishuCode">${bind ? escapeHtml(bind.token) : '------'}</p>
      <p class="info-text" id="feishuExpiry" data-expires="${bind?.expiresAt ?? 0}"></p>
      <div class="password-row" style="margin:8px 0;">
        <code id="feishuCommand" style="flex:1; padding:8px;">${bind ? escapeHtml(bind.command) : c.waitingCode}</code>
        <button class="secondary" id="copyFeishuBind" type="button">${c.copy}</button>
      </div>
      <div class="qr-grid" id="feishuQr">
        <div class="qr-card"><div id="feishuAppQr">${appLinkQr}</div><div class="info-text">${c.openBot}</div></div>
        <div class="qr-card"><div id="feishuCommandQr">${commandQr}</div><div class="info-text">${c.bindCommand}</div></div>
      </div>
    </div>
  </div>

  <div id="tab-qq" class="tab-content">
    <div class="step">
      <div class="step-header">
        <div class="step-num ${state.qqHasSecret && state.qqAppId ? 'done' : ''}">1</div>
        <strong>${c.qqStep1}</strong>
        <span class="badge ${state.qqHasSecret && state.qqAppId ? 'done' : 'pending'}">${state.qqHasSecret && state.qqAppId ? c.saved : c.pending}</span>
      </div>
      <p>${c.qqIntroBefore}<a href="#" onclick="sendMsg({type:'openExternal',url:'https://q.qq.com/qqbot/'})">${c.qqPlatform}</a>${c.qqIntroAfter}<a href="#" onclick="sendMsg({type:'openExternal',url:'${c.qqGuideUrl}'})">${c.tailscaleLink}</a>.</p>
      <p class="info-text">${c.qqNote}</p>
      <div class="mt">
        <input type="text" id="qqAppId" placeholder="${escapeHtml(c.qqAppId)}" value="${escapeHtml(state.qqAppId)}" />
        <input type="password" id="qqAppSecret" placeholder="${escapeHtml(qqSecretPh)}" style="margin-top:8px;" />
        <label class="info-text mt" style="display:flex; gap:8px; align-items:center;">
          <input type="checkbox" id="qqSandbox" ${state.qqSandbox ? 'checked' : ''} />
          ${c.qqSandbox}
        </label>
        <div class="actions">
          <button id="saveQq">${c.saveRestart}</button>
        </div>
        <p class="info-text" id="qqLink">${c.qqChecking}</p>
      </div>
    </div>
    <div class="step">
      <div class="step-header">
        <div class="step-num ${state.qqUsers.length > 0 ? 'done' : ''}">2</div>
        <strong>${c.qqStep2}</strong>
        <span class="badge ${state.qqUsers.length > 0 ? 'done' : 'pending'}">${state.qqUsers.length > 0 ? c.bound : c.pending}</span>
      </div>
      <p>${c.qqBindIntro}</p>
      <div id="qqUsers" class="info-text mt"></div>
      <p class="bind-code" id="qqCode">${qqBind ? escapeHtml(qqBind.token) : '------'}</p>
      <p class="info-text" id="qqExpiry" data-expires="${qqBind?.expiresAt ?? 0}"></p>
      <div class="password-row" style="margin:8px 0;">
        <code id="qqCommand" style="flex:1; padding:8px;">${qqBind ? escapeHtml(qqBind.command) : c.waitingCode}</code>
        <button class="secondary" id="copyQqBind" type="button">${c.copy}</button>
      </div>
      <div class="qr-grid">
        <div class="qr-card"><div id="qqCommandQr">${qqCommandQr}</div><div class="info-text">${c.bindCommand}</div></div>
      </div>
    </div>
  </div>

  <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--border);">
    <p class="info-text">${c.footerBefore}<code>@ext:cursor-remote.cursor-remote</code>
    <button class="secondary" style="margin-left: 8px; display: inline; padding: 3px 10px; font-size: 0.9em;" id="copySettingsFilter">${c.copyFilter}</button></p>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const ui = ${ui};
    const boundUsers = ${boundUsers};
    function renderBound(prefix, users) {
      const root = document.getElementById(prefix + 'Users');
      if (!root) return;
      root.replaceChildren();
      if (!users || users.length === 0) {
        root.textContent = prefix === 'qq' ? ui.qqNone : ui.feishuNone;
        return;
      }
      const label = document.createElement('div');
      label.textContent = ui.boundPrefix;
      root.appendChild(label);
      for (const user of users) {
        const row = document.createElement('div');
        row.className = 'bound-row';
        const name = document.createElement('span');
        name.textContent = user.name || user.openId;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'secondary';
        button.textContent = ui.removeUser;
        button.addEventListener('click', () => {
          sendMsg({ type: 'unbindUser', transport: prefix, openId: user.openId });
        });
        row.append(name, button);
        root.appendChild(row);
      }
    }
    renderBound('feishu', boundUsers.feishu);
    renderBound('qq', boundUsers.qq);

    function sendMsg(msg) { vscode.postMessage(msg); }

    // Tab switching
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
      });
    });

    // Radio selection visual feedback + show/hide custom address field
    document.querySelectorAll('input[name="netMode"]').forEach(radio => {
      radio.addEventListener('change', () => {
        document.querySelectorAll('.radio-option').forEach(o => o.classList.remove('selected'));
        radio.closest('.radio-option').classList.add('selected');
        const customRow = document.querySelector('.custom-addr-row');
        if (customRow) customRow.style.display = radio.value === 'custom' ? '' : 'none';
        refreshLanWarn();
      });
    });
    document.getElementById('passwordInput')?.addEventListener('input', refreshLanWarn);
    function refreshLanWarn() {
      const mode = document.querySelector('input[name="netMode"]:checked');
      const pw = document.getElementById('passwordInput');
      const el = document.getElementById('lanPasswordWarn');
      if (!el || !pw) return;
      el.hidden = !(mode && mode.value === 'lan' && pw.value.trim() === '');
    }

    // Save networking
    document.getElementById('saveNetworking')?.addEventListener('click', () => {
      const mode = document.querySelector('input[name="netMode"]:checked')?.value;
      const msg = { type: 'setNetworking', mode };
      if (mode === 'custom') {
        msg.address = document.getElementById('customAddress')?.value || '';
      }
      sendMsg(msg);
      setTimeout(() => sendMsg({ type: 'restartServer' }), 500);
    });

    // Copy password from input field
    document.getElementById('copyPassword')?.addEventListener('click', () => {
      const pw = document.getElementById('passwordInput')?.value;
      if (pw) {
        navigator.clipboard.writeText(pw).then(() => {
          sendMsg({ type: 'copyPassword' });
        }).catch(() => {
          sendMsg({ type: 'copyPassword' });
        });
      }
    });

    // Save password
    document.getElementById('savePassword')?.addEventListener('click', () => {
      const pw = document.getElementById('passwordInput')?.value || '';
      sendMsg({ type: 'savePassword', password: pw });
    });

    // Save Telegram token
    document.getElementById('saveToken')?.addEventListener('click', () => {
      const token = document.getElementById('botTokenInput')?.value;
      if (token) sendMsg({ type: 'saveTelegramToken', token });
    });

    // Transport engine radio selection
    document.querySelectorAll('input[name="tgImpl"]').forEach(radio => {
      radio.addEventListener('change', () => {
        document.querySelectorAll('input[name="tgImpl"]').forEach(r => {
          r.closest('.radio-option').classList.remove('selected');
        });
        radio.closest('.radio-option').classList.add('selected');
      });
    });

    // Save transport engine
    document.getElementById('saveTgImpl')?.addEventListener('click', () => {
      const impl = document.querySelector('input[name="tgImpl"]:checked')?.value;
      if (impl) {
        sendMsg({ type: 'setTelegramImpl', impl });
        setTimeout(() => sendMsg({ type: 'restartServer' }), 500);
      }
    });

    document.getElementById('saveFeishu')?.addEventListener('click', () => {
      sendMsg({
        type: 'saveFeishu',
        appId: document.getElementById('feishuAppId')?.value || '',
        appSecret: document.getElementById('feishuAppSecret')?.value || '',
      });
      setTimeout(() => sendMsg({ type: 'restartServer' }), 500);
    });

    document.getElementById('copyFeishuBind')?.addEventListener('click', () => {
      copyBindCommand('feishuCommand', 'copyFeishuBind');
    });

    document.getElementById('saveQq')?.addEventListener('click', () => {
      sendMsg({
        type: 'saveQq',
        appId: document.getElementById('qqAppId')?.value || '',
        appSecret: document.getElementById('qqAppSecret')?.value || '',
        sandbox: document.getElementById('qqSandbox')?.checked === true,
      });
      setTimeout(() => sendMsg({ type: 'restartServer' }), 500);
    });

    document.getElementById('copyQqBind')?.addEventListener('click', () => {
      copyBindCommand('qqCommand', 'copyQqBind');
    });

    function copyBindCommand(commandId, buttonId) {
      const text = document.getElementById(commandId)?.textContent || '';
      const button = document.getElementById(buttonId);
      if (!text || !button) return;
      navigator.clipboard.writeText(text.trim()).then(() => {
        const prev = button.textContent;
        button.textContent = ui.copied;
        setTimeout(() => { button.textContent = prev; }, 1200);
      });
    }

    function renderExpiry(id) {
      const el = document.getElementById(id);
      if (!el) return;
      const at = Number(el.dataset.expires || 0);
      if (!at) { el.textContent = ''; return; }
      const left = Math.max(0, Math.ceil((at - Date.now()) / 1000));
      el.textContent = left > 0
        ? ui.expiryLeft.replace('{n}', String(left))
        : ui.expiryGone;
    }
    renderExpiry('feishuExpiry');
    renderExpiry('qqExpiry');
    setInterval(() => {
      renderExpiry('feishuExpiry');
      renderExpiry('qqExpiry');
    }, 1000);

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (!msg) return;
      if (msg.type === 'linkStatus') {
        const cdp = document.getElementById('cdpStatus');
        const feishu = document.getElementById('feishuLink');
        const qq = document.getElementById('qqLink');
        if (cdp) cdp.textContent = msg.cdpText || '';
        if (feishu) feishu.textContent = msg.feishu || '';
        if (qq) qq.textContent = msg.qq || '';
        return;
      }
      if (msg.type !== 'feishuBind' && msg.type !== 'qqBind') return;
      const prefix = msg.type === 'qqBind' ? 'qq' : 'feishu';
      const next = msg.bind;
      const code = document.getElementById(prefix + 'Code');
      const command = document.getElementById(prefix + 'Command');
      if (code) code.textContent = next?.token || '------';
      if (command) command.textContent = next?.command || ui.waitingCode;
      const expiry = document.getElementById(prefix + 'Expiry');
      if (expiry) expiry.dataset.expires = String(next?.expiresAt || 0);
      if (prefix === 'feishu') {
        const appQr = document.getElementById('feishuAppQr');
        const cmdQr = document.getElementById('feishuCommandQr');
        if (appQr) appQr.innerHTML = next?.appLinkQr ? '<img class="qr" alt="Open Feishu bot QR" src="' + next.appLinkQr + '" />' : '';
        if (cmdQr) cmdQr.innerHTML = next?.commandQr ? '<img class="qr" alt="Bind command QR" src="' + next.commandQr + '" />' : '';
      } else {
        const cmdQr = document.getElementById('qqCommandQr');
        if (cmdQr) cmdQr.innerHTML = next?.commandQr ? '<img class="qr" alt="QQ bind command QR" src="' + next.commandQr + '" />' : '';
      }
      renderBound(prefix, msg.users || []);
    });

    // Copy settings filter
    document.getElementById('copySettingsFilter')?.addEventListener('click', () => {
      sendMsg({ type: 'copySettingsFilter' });
    });
  </script>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
