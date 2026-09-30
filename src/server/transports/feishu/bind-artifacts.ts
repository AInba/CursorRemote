import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import QRCode from 'qrcode';
import type { BindChallenge } from './bind-token.js';

export async function writeBindArtifacts(
  dataDir: string,
  challenge: BindChallenge,
  prefix = 'feishu',
): Promise<void> {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, `${prefix}-bind.json`), JSON.stringify({
    token: challenge.token,
    expiresAt: challenge.expiresAt,
    command: challenge.command,
    appLink: challenge.appLink,
  }, null, 2));
  const commandSvg = await QRCode.toString(challenge.command, {
    type: 'svg',
    margin: 1,
    errorCorrectionLevel: 'M',
  });
  writeFileSync(join(dataDir, `${prefix}-qr-command.svg`), commandSvg);
  if (challenge.appLink) {
    const appSvg = await QRCode.toString(challenge.appLink, {
      type: 'svg',
      margin: 1,
      errorCorrectionLevel: 'M',
    });
    writeFileSync(join(dataDir, `${prefix}-qr-applink.svg`), appSvg);
  }
}
