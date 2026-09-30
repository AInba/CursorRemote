import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { clientNoticeCopy, codeBlockPainted, connectionUi, emptyCodeNote, nextClientNotice } from '../src/client/ui-copy.js';

describe('web client stale extraction', () => {
  it('tells the user to bring Cursor forward for every stale snapshot', () => {
    const timedOut = connectionUi({
      socketConnected: true,
      cursorConnected: true,
      extractorStatus: 'stale',
      lastExtractionError: 'Runtime.evaluate timeout',
    });
    assert.match(timedOut.emptyHint, /Bring Cursor to the foreground/);
    assert.equal(timedOut.label, 'Cursor backgrounded');

    const other = connectionUi({
      socketConnected: true,
      cursorConnected: true,
      extractorStatus: 'stale',
      lastExtractionError: 'boom <script>',
    });
    assert.match(other.emptyHint, /Bring Cursor to the foreground/);
    assert.match(other.emptyHint, /boom &lt;script&gt;/);
  });
});

describe('empty code blocks', () => {
  it('treats an unpainted block as empty and keeps a painted one', () => {
    assert.equal(codeBlockPainted({ code: '   ', diffLines: [] }), false);
    assert.equal(codeBlockPainted({ code: 'const n = 1;' }), true);
    assert.equal(codeBlockPainted({ code: '', diffLines: [{ kind: 'add', text: '+1' }] }), true);
    assert.match(emptyCodeNote, /paints the lines/);
  });
});

describe('web client notices', () => {
  const base = {
    secure: true,
    notificationPermission: 'default',
    notifyDismissed: false,
    installDismissed: false,
    insecureDismissed: false,
    canInstall: true,
    ios: false,
    standalone: false,
  };

  it('explains notifications before offering home-screen install', () => {
    assert.equal(nextClientNotice(base), 'notify');
    assert.match(clientNoticeCopy.notify, /tap Allow/);
    assert.equal(nextClientNotice({ ...base, notificationPermission: 'granted' }), 'install');
    assert.equal(nextClientNotice({ ...base, notificationPermission: 'granted', canInstall: false, ios: true }), 'install-ios');
    assert.equal(nextClientNotice({ ...base, notificationPermission: 'denied' }), 'denied');
    assert.equal(nextClientNotice({ ...base, secure: false }), 'insecure');
    assert.equal(nextClientNotice({ ...base, notificationPermission: 'granted', standalone: true }), null);
  });
});
