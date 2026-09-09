import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const windows = readFileSync(path.join(root, 'electron/WindowHelper.ts'), 'utf8');
const main = readFileSync(path.join(root, 'electron/main.ts'), 'utf8');

test('Windows package contains only the runtime artwork it uses', () => {
  const windowsResources = packageJson.build.win.extraResources;
  assert.deepEqual(windowsResources, [
    {
      from: 'assets/fakeicon/win/',
      to: 'assets/fakeicon/win/',
      filter: ['**/*'],
    },
    {
      from: 'assets/icons/win/icon1.ico',
      to: 'assets/icons/win/icon1.ico',
    },
  ]);
  assert.equal(packageJson.build.extraResources, undefined);
  assert.equal(packageJson.build.win.icon, 'assets/icons/win/icon1.ico');
});

test('Windows runtime and executable use the same brand icon', () => {
  assert.match(windows, /assets\/icons\/win\/icon1\.ico/);
  assert.doesNotMatch(windows, /assets\/icons\/win\/icon\.ico/);
  assert.match(main, /assets\/icons\/win\/icon1\.ico/);
  assert.doesNotMatch(main, /assets\/icons\/win\/icon\.ico/);
});

test('electron-updater elevation helper is not disabled', () => {
  assert.notEqual(packageJson.build.nsis.packElevateHelper, false);
});

test('legacy unreferenced artwork is removed from source assets', () => {
  for (const relativePath of [
    'assets/icons/win/icon.ico',
    'assets/icons/win/icon2.png',
    'assets/icon.icns',
    'assets/icons/mac/icon.icns',
    'assets/pumpfun-card.png',
  ]) {
    assert.equal(existsSync(path.join(root, relativePath)), false, `${relativePath} should stay removed`);
  }
});

test('native dependency build metadata is excluded from the runtime package', () => {
  for (const pattern of [
    '!node_modules/better-sqlite3/build/Release/*.exp',
    '!node_modules/better-sqlite3/build/*.vcxproj',
    '!node_modules/better-sqlite3/build/*.vcxproj.filters',
    '!node_modules/keytar/build/Release/*.exp',
    '!node_modules/keytar/build/Release/*.lib',
    '!node_modules/keytar/build/*.vcxproj',
    '!node_modules/keytar/build/*.vcxproj.filters',
  ]) {
    assert.ok(packageJson.build.files.includes(pattern), `${pattern} must stay excluded`);
  }
});
