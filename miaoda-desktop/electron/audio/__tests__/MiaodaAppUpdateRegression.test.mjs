import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const main = readFileSync(path.join(root, 'electron/main.ts'), 'utf8');
const ipc = readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8');
const preload = readFileSync(path.join(root, 'electron/preload.ts'), 'utf8');
const overlay = readFileSync(path.join(root, 'src/components/LiteOverlay.tsx'), 'utf8');
const overlayCss = readFileSync(path.join(root, 'src/components/LiteOverlay.css'), 'utf8');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const feedScript = readFileSync(path.join(root, 'scripts/prepare-windows-update-feed.mjs'), 'utf8');

test('packaged clients check the stable update feed without downloading automatically', () => {
  assert.doesNotMatch(main, /Disabled for local interview-helper build/);
  assert.match(main, /const UPDATE_FEED_URL = 'https:\/\/example\.invalid\/download\/updates\/'/);
  assert.match(main, /autoUpdater\.autoDownload = false/);
  assert.match(main, /autoUpdater\.setFeedURL\([\s\S]{0,260}provider: 'generic'/);
  assert.match(main, /setTimeout\(check, UPDATE_CHECK_DELAY_MS\)/);
  assert.match(main, /setInterval\(check, UPDATE_CHECK_INTERVAL_MS\)/);
  assert.doesNotMatch(main, /checkForUpdatesAndNotify/);
});

test('update state survives renderer timing and crosses the isolated preload bridge', () => {
  assert.match(main, /public getUpdateState\(\): AppUpdateSnapshot/);
  assert.match(main, /broadcast\('app-update-state', this\.getUpdateState\(\)\)/);
  assert.match(ipc, /safeHandle\('get-update-state'[\s\S]{0,120}appState\.getUpdateState\(\)/);
  assert.match(preload, /getAppUpdateState: \(\) => ipcRenderer\.invoke\('get-update-state'\)/);
  assert.match(preload, /ipcRenderer\.on\('app-update-state'/);
  assert.match(preload, /const liteApiKeys =[\s\S]{0,900}'getAppUpdateState'[\s\S]{0,900}'onAppUpdateState'/);
  assert.match(preload, /const liteApiKeys =[\s\S]{0,1200}'downloadUpdate'[\s\S]{0,400}'restartAndInstall'/);
});

test('homepage shows a user-initiated update CTA immediately left of quota only when needed', () => {
  const headerStart = overlay.indexOf('<header className="lite-titlebar">');
  const headerEnd = overlay.indexOf('</header>', headerStart);
  const header = overlay.slice(headerStart, headerEnd);
  const updateIndex = header.indexOf('lite-update-button');
  const quotaIndex = header.indexOf('lite-quota-pill');

  assert.ok(updateIndex > 0, 'update CTA must be rendered in the homepage titlebar');
  assert.ok(quotaIndex > updateIndex, 'update CTA must appear to the left of quota');
  assert.match(overlay, /appUpdate\?\.status === 'available' \|\| appUpdate\?\.status === 'downloading' \|\| appUpdate\?\.status === 'downloaded'/);
  assert.match(overlay, /window\.electronAPI\.downloadUpdate\?\.\(\)/);
  assert.match(overlay, /window\.electronAPI\.restartAndInstall\?\.\(\)/);
  assert.match(overlayCss, /\.lite-root \.lite-update-button/);
});

test('install cannot be triggered before a verified download completes', () => {
  assert.match(main, /this\.updateDownloadState !== 'downloaded' \|\| !this\.downloadedUpdateInfo/);
  assert.match(main, /throw new Error\('No downloaded update is ready to install\.'\)/);
});

test('Windows build emits a generic feed with canonical English artifact names', () => {
  assert.deepEqual(pkg.build.publish, [{ provider: 'generic', url: 'https://example.invalid/download/updates/' }]);
  assert.equal(pkg.build.nsis.artifactName, 'Miaoda-Setup-${version}.${ext}');
  assert.match(feedScript, /miaoda-releases\/releases\/download\/v\$\{version\}/);
  assert.match(feedScript, /createHash\('sha256'\)/);
});
