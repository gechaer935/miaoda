import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = readFileSync(path.resolve(__dirname, '../../../../miaoda-mobile-web/src/App.tsx'), 'utf8');
const main = readFileSync(path.resolve(__dirname, '../../../../miaoda-mobile-web/src/main.tsx'), 'utf8');
const desktop = readFileSync(path.resolve(__dirname, '../../../src/components/LiteOverlay.tsx'), 'utf8');
const desktopCss = readFileSync(path.resolve(__dirname, '../../../src/components/LiteOverlay.css'), 'utf8');
const preload = readFileSync(path.resolve(__dirname, '../../preload.ts'), 'utf8');
const handlers = readFileSync(path.resolve(__dirname, '../../ipcHandlers.ts'), 'utf8');

test('QR claim/bootstrap is shared across React StrictMode effect replays', () => {
  assert.match(main, /<StrictMode>/);
  assert.match(app, /let sessionInitialization: Promise<Bootstrap> \| null = null/);
  assert.match(app, /if \(sessionInitialization\) return sessionInitialization/);
  assert.match(app, /await api\.claimByTicket/);
  assert.match(app, /const data = await initializeSessionFromLocation\(\)/);
});

test('a stale WebSocket close cannot mark its replacement offline', () => {
  assert.match(app, /ws\.onclose = \(\) => \{[\s\S]*if \(wsRef\.current !== ws\) return/);
  assert.match(app, /const socket = wsRef\.current[\s\S]*wsRef\.current = null[\s\S]*socket\?\.close\(\)/);
});

test('the first visible connection state is connecting, not disconnected', () => {
  assert.match(app, /useState<Connection>\('connecting'\)/);
});

test('mobile companion detects stale sockets and sends a heartbeat', () => {
  assert.match(app, /COMPANION_HEARTBEAT_INTERVAL_MS\s*=\s*5_000/);
  assert.match(app, /COMPANION_STALE_AFTER_MS\s*=\s*10_000/);
  assert.match(app, /type:\s*'heartbeat'/);
  assert.match(app, /Date\.now\(\) - lastMessageAtRef\.current > COMPANION_STALE_AFTER_MS[\s\S]*restartConnection/);
});

test('paired mobile companion silently keeps the screen awake while visible', () => {
  assert.match(app, /if \(!boot\?\.pairingId \|\| !\('wakeLock' in navigator\)\) return undefined/);
  assert.match(app, /navigator\.wakeLock\.request\('screen'\)/);
  assert.match(app, /document\.visibilityState === 'visible'[\s\S]*acquireWakeLock/);
  assert.match(app, /if \(sentinel && !sentinel\.released\) void sentinel\.release\(\)/);
  assert.doesNotMatch(app, /屏幕常亮已开启/);
});

test('desktop batches transcript and answer streaming updates every 500 ms', () => {
  assert.match(desktop, /COMPANION_CONTENT_SYNC_INTERVAL_MS\s*=\s*500/);
  assert.match(desktop, /queueTranscriptSync\(final \? 'transcript\.final' : 'transcript\.partial', syncedTranscript\)/);
  assert.match(desktop, /queueAnswerSync\(cardId, token, syncRequestId\)/);
  assert.match(desktop, /await flushAnswerSync\(cardId\);[\s\S]{0,200}await sendCompanionSync\('answer\.done'/);
});

test('desktop pairing exposes the same ticket URL for manual phone opening and native copy', () => {
  assert.match(desktop, /aria-label="手机端配对网址"[\s\S]*value=\{pairing\.qrUrl\}/);
  assert.match(desktop, /copyPairingUrl[\s\S]*writeClipboardText\?\.\(pairing\.qrUrl\)/);
  assert.match(desktop, /二维码、网址和配对码 120 秒内有效/);
  assert.match(desktop, /复制失败，请选中网址后手动复制/);
  assert.match(desktopCss, /\.lite-pairing-url input:focus/);
  assert.match(preload, /writeClipboardText:[\s\S]*clipboard:write-text/);
  assert.match(handlers, /clipboard\.writeText\(text\)/);
});
