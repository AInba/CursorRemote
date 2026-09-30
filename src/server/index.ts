import { createWriteStream, appendFileSync, readFileSync } from 'fs';
import { checkLicense } from './license.js';
import { loadConfig, loadSelectors } from './config.js';
import { CDPBridge } from './cdp-bridge.js';
import { DOMExtractor } from './dom-extractor.js';
import { CommandExecutor } from './command-executor.js';
import { StateManager } from './state-manager.js';
import { WindowMonitor } from './window-monitor.js';
import { Relay } from './relay.js';
import type { Transport } from './transports/types.js';
import { TelegramTransport } from './transports/telegram/index.js';
import { RawTelegramTransport } from './transports/telegram-raw/index.js';
import { FeishuTransport } from './transports/feishu/index.js';
import { QqTransport } from './transports/qq/index.js';
import { setTransportLink } from './transport-status.js';

const logStream = createWriteStream('./temp/server.log', { flags: 'a' });
const origLog = console.log;
const origWarn = console.warn;
const origError = console.error;
function ts(): string {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}
function writeLog(line: string): void {
  try {
    logStream.write(`${ts()} ${line}\n`);
  } catch {
    /* ignore write errors */
  }
}
if (process.env.LOG_FORMAT === 'json') {
  console.log = (...args: unknown[]) => {
    const line = args.map(String).join(' ');
    origLog(JSON.stringify({ ts: Date.now(), level: 'info', msg: line }));
    writeLog(line);
  };
  console.warn = (...args: unknown[]) => {
    const line = args.map(String).join(' ');
    origWarn(JSON.stringify({ ts: Date.now(), level: 'warn', msg: line }));
    writeLog(`[WARN] ${line}`);
  };
  console.error = (...args: unknown[]) => {
    const line = args.map(String).join(' ');
    origError(JSON.stringify({ ts: Date.now(), level: 'error', msg: line }));
    writeLog(`[ERROR] ${line}`);
  };
} else {
  console.log = (...args: unknown[]) => { const line = args.map(String).join(' '); origLog(`${ts()} ${line}`); writeLog(line); };
  console.warn = (...args: unknown[]) => { const line = args.map(String).join(' '); origWarn(`${ts()} [WARN] ${line}`); writeLog(`[WARN] ${line}`); };
  console.error = (...args: unknown[]) => { const line = args.map(String).join(' '); origError(`${ts()} [ERROR] ${line}`); writeLog(`[ERROR] ${line}`); };
}

process.on('uncaughtException', (err) => {
  const msg = `[CRASH] Uncaught exception: ${err.message}\n${err.stack ?? ''}`;
  try {
    appendFileSync('./temp/server.log', `${ts()} ${msg}\n`);
  } catch {
    /* ignore */
  }
  origError(msg);
  setTimeout(() => process.exit(1), 100);
});

type UnbindableTransport = Transport & {
  unbindUser(openId: string): { removed: boolean; restoredOnRestart: boolean };
};

function hasUnbindUser(item: Transport): item is UnbindableTransport {
  return typeof (item as UnbindableTransport).unbindUser === 'function';
}

async function main(): Promise<void> {
  let version = 'unknown';
  for (const rel of ['../../package.json', '../package.json', '../../../package.json']) {
    try {
      const pkg = JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf-8'));
      if (pkg.name === 'cursor-remote') { version = pkg.version; break; }
    } catch { /* try next */ }
  }
  console.log(`=== CursorRemote v${version} ===`);
  console.log();

  checkLicense();

  const config = loadConfig();
  const selectors = loadSelectors(config);

  console.log(`[main] CDP URL: ${config.cdpUrl}`);
  console.log(`[main] Server: http://${config.serverHost}:${config.serverPort}`);
  console.log(`[main] Poll interval: ${config.pollIntervalMs}ms`);
  console.log(`[main] Debounce: ${config.debounceMs}ms`);
  console.log(`[main] Telegram: ${config.telegram.enabled ? 'enabled' : 'disabled'}`);
  console.log(`[main] Feishu: ${config.feishu.enabled ? 'enabled' : 'disabled'}`);
  console.log(`[main] QQ: ${config.qq.enabled ? 'enabled' : 'disabled'}${config.qq.sandbox ? ' (sandbox)' : ''}`);
  console.log();

  const stateManager = new StateManager(config.debounceMs);
  const commandExecutor = new CommandExecutor(selectors);

  const cdpBridge = new CDPBridge(config);

  const extractor = new DOMExtractor(
    selectors,
    (state, errorMessage) => {
      if (state) stateManager.onExtraction(state);
      else stateManager.onExtractionFailure(errorMessage ?? 'Extraction failed');
    },
    () => cdpBridge.windows.find(w => w.id === cdpBridge.activeTargetId)?.title ?? ''
  );

  const windowMonitor = new WindowMonitor(cdpBridge, stateManager, extractor, config, selectors);

  cdpBridge.on('connected', () => {
    const client = cdpBridge.getClient();
    stateManager.onConnectionChanged(true);
    stateManager.updateWindows(cdpBridge.windows, cdpBridge.activeTargetId);
    commandExecutor.setClient(client);
    if (client) {
      extractor.start(client, config.pollIntervalMs);
    }
  });

  cdpBridge.on('disconnected', () => {
    stateManager.onConnectionChanged(false);
    commandExecutor.setClient(null);
    extractor.stop();
  });

  cdpBridge.on('error', (err: Error) => {
    console.error(`[main] CDP error: ${err.message}`);
  });

  const transports: Transport[] = [];

  const relay = new Relay(config, stateManager, commandExecutor, cdpBridge);
  await relay.start();

  console.log('[main] Connecting to Cursor IDE...');
  await cdpBridge.connect();

  if (config.telegram.enabled && config.telegram.botToken) {
    const TgTransport = config.telegram.impl === 'raw' ? RawTelegramTransport : TelegramTransport;
    if (config.telegram.impl === 'raw') {
      console.log('[telegram] Using raw Bot API transport (no Grammy)');
    }
    const telegram = new TgTransport(
      config.telegram,
      windowMonitor,
      stateManager,
      commandExecutor,
      cdpBridge
    );

    const names = telegram.registeredUserNames;
    if (names.length > 0) {
      console.log(`[telegram] Registered user(s): ${names.join(', ')}`);
      console.log(`[telegram] To register a different user: /register ${telegram.registerToken}`);
    } else {
      console.log(`[telegram] To register, send in your Telegram group: /register ${telegram.registerToken}`);
    }

    telegram.start().catch(err => {
      console.error(`[telegram] Failed to start: ${err instanceof Error ? err.message : String(err)}`);
    });
    transports.push(telegram);
  }

  if (config.feishu.enabled && config.feishu.appId && config.feishu.appSecret) {
    const feishu = new FeishuTransport(
      config.feishu,
      config.dataDir,
      windowMonitor,
      stateManager,
      commandExecutor,
      cdpBridge,
    );
    feishu.start().catch(err => {
      const message = err instanceof Error ? err.message : String(err);
      setTransportLink('feishu', 'error', message);
      console.error(`[feishu] Failed to start: ${message}`);
    });
    transports.push(feishu);
  } else if (config.feishu.enabled) {
    setTransportLink('feishu', 'error', '已启用，但缺少 App ID 或 App Secret');
    console.warn('[feishu] Enabled but FEISHU_APP_ID or FEISHU_APP_SECRET is missing');
  }

  if (config.qq.enabled && config.qq.appId && config.qq.appSecret) {
    const qq = new QqTransport(
      config.qq,
      config.dataDir,
      windowMonitor,
      stateManager,
      commandExecutor,
      cdpBridge,
    );
    qq.start().catch(err => {
      const message = err instanceof Error ? err.message : String(err);
      setTransportLink('qq', 'error', message);
      console.error(`[qq] Failed to start: ${message}`);
    });
    transports.push(qq);
  } else if (config.qq.enabled) {
    setTransportLink('qq', 'error', '已启用，但缺少 App ID 或 App Secret');
    console.warn('[qq] Enabled but QQ_APP_ID or QQ_APP_SECRET is missing');
  }

  relay.setLocalUnbind((transport, openId) => {
    const target = transports.find(item => item.name === transport);
    if (target && hasUnbindUser(target)) return target.unbindUser(openId);
    return { removed: false, restoredOnRestart: false };
  });

  windowMonitor.start();

  const shutdown = async () => {
    console.log('\n[main] Shutting down...');
    windowMonitor.stop();
    extractor.stop();
    for (const transport of transports) {
      await transport.stop();
    }
    await cdpBridge.disconnect();
    await relay.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('unhandledRejection', (reason) => {
    const msg = `[main] Unhandled rejection: ${String(reason)}`;
    try {
      appendFileSync('./temp/server.log', `${ts()} [ERROR] ${msg}\n`);
    } catch {
      /* ignore */
    }
    console.error(msg);
  });
}

main().catch((err) => {
  const msg = `[main] Fatal error: ${err instanceof Error ? err.message : String(err)}\n${err instanceof Error ? err.stack ?? '' : ''}`;
  try {
    appendFileSync('./temp/server.log', `${ts()} [ERROR] ${msg}\n`);
  } catch {
    /* ignore */
  }
  console.error(msg);
  setTimeout(() => process.exit(1), 100);
});
