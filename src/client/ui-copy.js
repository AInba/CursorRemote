/** Copy for the web client when Cursor is connected but the snapshot is old or code lines are not painted yet. */

export const emptyCodeNote =
  'This fills in after Cursor paints the lines. Bring Cursor forward if it stays empty.';

const foregroundHint = 'Bring Cursor to the foreground, then wait for the next snapshot.';

export function codeBlockPainted(item) {
  if (!item) return false;
  if (item.diffLines && item.diffLines.length > 0) return true;
  return String(item.code || '').trim().length > 0;
}

export function connectionUi(input) {
  const lastError = String(input.lastExtractionError || '').trim();
  const timeoutLike = /timeout/i.test(lastError);

  if (!input.socketConnected) {
    return {
      status: 'disconnected',
      label: 'Relay disconnected',
      emptyPrimary: 'Waiting for relay connection...',
      emptyHint: 'Check that this page can reach the CursorRemote server.',
    };
  }

  if (!input.cursorConnected) {
    return {
      status: 'reconnecting',
      label: 'Waiting for Cursor',
      emptyPrimary: 'Connecting to Cursor IDE...',
      emptyHint: 'Make sure Cursor is running with<br><code>--remote-debugging-port=9222</code>',
    };
  }

  if (input.extractorStatus === 'stale') {
    return {
      status: 'reconnecting',
      label: timeoutLike ? 'Cursor backgrounded' : 'Cursor stalled',
      emptyPrimary: timeoutLike
        ? 'Cursor is connected, but extraction is stalled.'
        : 'Cursor is connected, but extraction is failing.',
      emptyHint: timeoutLike
        ? foregroundHint
        : `${foregroundHint}<br>Last extractor error:<br><code>${escapeHtml(lastError || 'unknown error')}</code>`,
    };
  }

  if (input.extractorStatus === 'waiting') {
    return {
      status: 'reconnecting',
      label: 'Waiting for snapshot',
      emptyPrimary: 'Connected to Cursor, waiting for the first snapshot...',
      emptyHint: lastError
        ? `Last extractor error:<br><code>${escapeHtml(lastError)}</code>`
        : 'The relay is connected to Cursor but has not captured a fresh DOM snapshot yet.',
    };
  }

  return {
    status: 'connected',
    label: 'Connected',
    emptyPrimary: 'No messages in this chat yet.',
    emptyHint: 'Send a message below or switch chat tab / window in Cursor.',
  };
}

export const clientNoticeCopy = {
  notify: 'Notifications tell you when Cursor needs an approval, even if this tab is in the background. This page has to stay open. The browser asks only after you tap Allow.',
  allow: 'Allow',
  later: 'Not now',
  denied: 'Notifications are blocked for this site. Allow them in the browser site settings if you want approval alerts.',
  insecure: 'This connection is not secure, so the browser will not ask for notifications or offer install. Open localhost on this computer, or use HTTPS.',
  install: 'Add CursorRemote to your home screen so it opens like an app. Alerts still need this page to stay open.',
  installButton: 'Add',
  installIos: 'To keep this on your home screen, tap Share, then Add to Home Screen.',
};

/**
 * Notification explanation comes first. Home-screen install is offered only
 * after the user allows, blocks, or dismisses that explanation.
 */
export function nextClientNotice(input) {
  if (!input.secure) return input.insecureDismissed ? null : 'insecure';
  if (input.notificationPermission === 'default' && !input.notifyDismissed) return 'notify';
  if (input.notificationPermission === 'denied' && !input.notifyDismissed) return 'denied';
  const notifySettled = input.notificationPermission === 'granted'
    || input.notificationPermission === 'unsupported'
    || input.notifyDismissed;
  if (!notifySettled || input.installDismissed || input.standalone) return null;
  if (input.canInstall) return 'install';
  if (input.ios) return 'install-ios';
  return null;
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
