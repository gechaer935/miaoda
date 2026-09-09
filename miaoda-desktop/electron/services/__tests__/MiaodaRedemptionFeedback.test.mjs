import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(currentDir, '../../..');
const overlaySource = readFileSync(path.join(desktopRoot, 'src/components/LiteOverlay.tsx'), 'utf8');
const overlayStyles = readFileSync(path.join(desktopRoot, 'src/components/LiteOverlay.css'), 'utf8');
const windowsBuildScript = readFileSync(path.resolve(desktopRoot, '../build-desktop.cmd'), 'utf8');

test('redemption button keeps a visible blue background while hovered', () => {
  assert.match(
    overlayStyles,
    /\.lite-root \.lite-card-redemption form button:hover:not\(:disabled\)\s*\{[^}]*background:\s*#1d4ed8;[^}]*color:\s*#fff;/s,
  );
  assert.match(
    overlayStyles,
    /\.lite-root \.lite-card-redemption form button:disabled:hover\s*\{[^}]*background:\s*#2563eb;[^}]*color:\s*#fff;/s,
  );
});

test('successful redemption uses a modal and inline feedback is reserved for errors', () => {
  assert.match(overlaySource, /const redemptionSuccessNotice = redeemStatus && \(/);
  assert.match(overlaySource, /aria-labelledby="lite-redemption-success-title"/);
  assert.match(overlaySource, /<h2 id="lite-redemption-success-title">兑换成功<\/h2>/);
  assert.match(overlaySource, /\{redeemError && <p className="error" role="alert">\{redeemError\}<\/p>\}/);
  assert.doesNotMatch(overlaySource, /\(redeemStatus \|\| redeemError\).*className=\{redeemError \? 'error' : 'success'\}/s);
  assert.match(overlaySource, /\{redemptionSuccessNotice\}/);
});

test('Windows release script returns from every nested cmd invocation', () => {
  assert.match(windowsBuildScript, /call npm\.cmd run build \|\| exit \/b 1/);
  assert.match(windowsBuildScript, /call npm\.cmd run build:electron \|\| exit \/b 1/);
  assert.match(windowsBuildScript, /call node_modules\\\.bin\\electron-builder\.cmd --win nsis --x64 \|\| exit \/b 1/);
});
