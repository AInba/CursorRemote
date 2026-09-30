import 'dotenv/config';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { ServerConfig, SelectorConfig } from './types.js';

export function loadConfig(): ServerConfig {
  const preRegisteredRaw = process.env.TELEGRAM_ALLOWED_USERS ?? '';
  const preRegisteredUsers = preRegisteredRaw
    .split(',')
    .map(s => parseInt(s.trim(), 10))
    .filter(n => !isNaN(n));

  const feishuAllowed = (process.env.FEISHU_ALLOWED_USERS ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const qqAllowed = (process.env.QQ_ALLOWED_USERS ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const dataDir = process.env.DATA_DIR ?? resolve(process.cwd(), 'data');

  return {
    cdpUrl: process.env.CDP_URL ?? 'http://127.0.0.1:9222',
    serverPort: parseInt(process.env.SERVER_PORT ?? '3000', 10),
    serverHost: process.env.SERVER_HOST ?? '127.0.0.1',
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS ?? '300', 10),
    debounceMs: parseInt(process.env.DEBOUNCE_MS ?? '150', 10),
    selectorsPath: process.env.SELECTORS_PATH ?? './selectors.json',
    logLevel: (process.env.LOG_LEVEL as ServerConfig['logLevel']) ?? 'info',
    webappPassword: process.env.WEBAPP_PASSWORD ?? '',
    windowTitleQualifier: process.env.WINDOW_TITLE_QUALIFIER !== 'false',
    dataDir,
    telegram: {
      enabled: process.env.TELEGRAM_ENABLED === 'true',
      botToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
      preRegisteredUsers,
      impl: (process.env.TELEGRAM_IMPL === 'raw' ? 'raw' : 'grammy') as 'grammy' | 'raw',
    },
    feishu: {
      enabled: process.env.FEISHU_ENABLED === 'true',
      appId: process.env.FEISHU_APP_ID ?? '',
      appSecret: process.env.FEISHU_APP_SECRET ?? '',
      preRegisteredUsers: feishuAllowed,
    },
    qq: {
      enabled: process.env.QQ_ENABLED === 'true',
      appId: process.env.QQ_APP_ID ?? '',
      appSecret: process.env.QQ_APP_SECRET ?? '',
      preRegisteredUsers: qqAllowed,
      sandbox: process.env.QQ_SANDBOX === 'true',
    },
  };
}

export function loadSelectors(config: ServerConfig): SelectorConfig {
  const fullPath = resolve(config.selectorsPath);
  try {
    const raw = readFileSync(fullPath, 'utf-8');
    return JSON.parse(raw) as SelectorConfig;
  } catch (err) {
    console.warn(`[config] Could not load selectors from ${fullPath}, using defaults`);
    return getDefaultSelectors();
  }
}

function getDefaultSelectors(): SelectorConfig {
  return {
    chatContainer: {
      strategies: [
        "#workbench\\.parts\\.auxiliarybar",
        "div.composer-bar.editor",
        "[class*='composer-bar']",
        "[class*='composer-panel']",
        "[class*='chat-widget']",
      ],
    },
    approveButton: {
      strategies: [
        "button[aria-label*='Accept']",
        "button[aria-label*='Approve']",
        "button[aria-label*='Run']",
        "button[aria-label*='Allow']",
      ],
      textMatch: ['Accept', 'Approve', 'Run', 'Allow', 'Accept All'],
    },
    rejectButton: {
      strategies: [
        "button[aria-label*='Reject']",
        "button[aria-label*='Deny']",
        "button[aria-label*='Cancel']",
      ],
      textMatch: ['Reject', 'Deny', 'Cancel', 'Skip'],
    },
    chatInput: {
      strategies: [
        "textarea[class*='input']",
        "[contenteditable='true']",
        "[role='textbox']",
        "textarea",
      ],
    },
    agentStatus: {
      strategies: [
        "[class*='status']",
        "[class*='thinking']",
        "[class*='spinner']",
        "[class*='loading']",
      ],
    },
  };
}
