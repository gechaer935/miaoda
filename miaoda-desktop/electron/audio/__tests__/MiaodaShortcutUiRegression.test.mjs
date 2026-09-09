import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const overlay = readFileSync(path.join(root, 'src/components/LiteOverlay.tsx'), 'utf8');
const overlayCss = readFileSync(path.join(root, 'src/components/LiteOverlay.css'), 'utf8');
const settings = readFileSync(path.join(root, 'src/components/SettingsPopup.tsx'), 'utf8');
const settingsCss = readFileSync(path.join(root, 'src/index.css'), 'utf8');
const keybinds = readFileSync(path.join(root, 'electron/services/KeybindManager.ts'), 'utf8');
const main = readFileSync(path.join(root, 'electron/main.ts'), 'utf8');
const windowHelper = readFileSync(path.join(root, 'electron/WindowHelper.ts'), 'utf8');
const settingsWindow = readFileSync(path.join(root, 'electron/SettingsWindowHelper.ts'), 'utf8');
const nativeShortcutRecorder = readFileSync(path.join(root, 'native-module/src/shortcut_recorder_win.rs'), 'utf8');

test('top-bar shortcut hints use immediate custom tooltips and centered standard icons', () => {
  assert.match(overlay, /data-tooltip={`鼠标穿透 · \$\{shortcutFor\('general:toggle-mouse-passthrough'\)\}`}/);
  assert.match(overlay, /MousePointer2 className="lite-action-icon"/);
  assert.doesNotMatch(overlay, /Minus className="lite-action-icon"/);
  assert.match(overlayCss, /\.assistant-compact-tools button[\s\S]*display:\s*inline-grid;[\s\S]*place-items:\s*center/);
  assert.match(overlayCss, /\.lite-instant-tooltip::after[\s\S]*transition:\s*none/);
  assert.match(overlayCss, /\.lite-instant-tooltip:hover::after[\s\S]*visibility:\s*visible/);
});

test('shortcut editor rejects and highlights application and OS conflicts', () => {
  assert.match(settings, /setDraftAccelerator\(accelerator\)[\s\S]*conflictingKeybind/);
  assert.match(settings, /recording \? draftAccelerator \? displayAccelerator\(draftAccelerator\)/);
  assert.match(settings, /conflictingKeybind[\s\S]*setConflict/);
  assert.match(settings, /快捷键冲突：[\s\S]*系统或其他软件占用/);
  assert.match(settingsCss, /\.miaoda-settings-hint\.error/);
  assert.match(settingsCss, /\.miaoda-shortcut-item\.conflict/);
  assert.match(keybinds, /if \(conflictId\) return false/);
  assert.match(keybinds, /!globalShortcut\.isRegistered\(accelerator\)[\s\S]*return false/);
});

test('recording temporarily suspends global shortcuts and restores them on every exit path', () => {
  assert.match(settings, /setKeybindRecordingSuspended\?\.\(true\)/);
  assert.match(settings, /setKeybindRecordingSuspended\?\.\(false\)/);
  assert.match(keybinds, /shortcutRecordingSuspended/);
  assert.match(keybinds, /globalShortcut\.unregisterAll\(\)[\s\S]*stopHealthCheck\(\)/);
  assert.match(keybinds, /keybinds:set-recording-suspended/);
  assert.match(keybinds, /shortcutRecordingSuspended[\s\S]*Menu\.setApplicationMenu/);
  assert.match(settings, /onKeybindRecordingCancelled/);
  assert.match(settingsWindow, /before-input-event/);
  assert.match(settingsWindow, /event\.preventDefault\(\)/);
  assert.match(settingsWindow, /keybinds:recording-input/);
  assert.match(settings, /onKeybindRecordingInput/);
});

test('Windows shortcut recording observes keys consumed before Chromium and rejects shell reservations', () => {
  assert.match(nativeShortcutRecorder, /GetAsyncKeyState/);
  assert.match(nativeShortcutRecorder, /get_pressed_shortcut_key/);
  assert.match(settingsWindow, /getPressedShortcutKey/);
  assert.match(settingsWindow, /setInterval\([\s\S]*16/);
  assert.match(settingsWindow, /lastShortcutSignature/);
  assert.match(settings, /Super/);
  assert.match(settings, /\.replace\(\/Super\/gi, 'Win'\)/);
  assert.match(keybinds, /isReservedSystemAccelerator/);
  assert.match(keybinds, /windowsShellKeys/);
  assert.match(keybinds, /RegisterHotKey|globalShortcut\.isRegistered/);
});

test('the close button and configurable Ctrl+Esc shortcut quit while Ctrl+Shift+M hides and restores', () => {
  assert.doesNotMatch(settings, /general:force-show-window/);
  assert.doesNotMatch(keybinds, /general:force-show-window/);
  assert.doesNotMatch(settings, /general:quit-lite/);
  assert.doesNotMatch(keybinds, /general:quit-lite/);
  assert.match(overlay, /aria-label="隐藏客户端窗口"[\s\S]{0,300}toggleWindow/);
  assert.match(overlay, /MonitorOff className="lite-action-icon"/);
  assert.match(overlay, /aria-label="退出秒答"[\s\S]{0,300}quitApp/);
  assert.doesNotMatch(overlay, /aria-label="退出秒答"[\s\S]{0,300}toggleWindow/);
  assert.match(keybinds, /general:toggle-visibility'[\s\S]{0,180}CommandOrControl\+Shift\+M/);
  assert.match(keybinds, /LEGACY_LITE_ACCELERATORS[\s\S]*general:toggle-visibility': \['CommandOrControl\+Shift\+X', 'CommandOrControl\+Shift\+Y'\]/);
  assert.match(main, /explicit "hide the client" control[\s\S]{0,300}windowHelper\.toggleMainWindow\(\)/);
  assert.match(settings, /隐藏 \/ 恢复窗口/);
  assert.match(settings, /'general:quit-app'/);
  assert.match(settings, /input\.key === 'Escape' && !input\.ctrlKey/);
  assert.match(settings, /退出秒答[\s\S]*完全退出客户端并结束后台进程/);
  assert.match(keybinds, /id: 'general:quit-app'[^\n]+accelerator: 'Control\+Esc'[^\n]+defaultAccelerator: 'Control\+Esc'/);
  assert.match(keybinds, /usesNativeExitShortcutFallback/);
  assert.match(keybinds, /getPressedShortcutKey/);
  assert.match(keybinds, /cb\('general:quit-app'\)/);
  assert.match(main, /actionId === 'general:quit-app'[\s\S]{0,100}app\.quit\(\)/);
  assert.match(overlay, /退出秒答 · \$\{shortcutFor\('general:quit-app'\)\}/);
  assert.match(windowHelper, /if \(!this\.appState\.isQuitting\(\) && this\.overlayWindow\?\.isVisible\(\)\)/);
});

test('factory shortcut defaults match the current Lite client configuration', () => {
  const expectedDefaults = [
    ['general:toggle-visibility', 'M'],
    ['general:toggle-mouse-passthrough', 'Z'],
    ['general:capture-and-process', 'C'],
    ['general:capture-leetcode', 'V'],
    ['general:mobile-written-scroll-up', 'Up'],
    ['general:mobile-written-scroll-down', 'Down'],
  ];

  for (const [id, key] of expectedDefaults) {
    const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedAccelerator = `CommandOrControl\\+Shift\\+${key}`;
    assert.match(
      keybinds,
      new RegExp(`id: '${escapedId}'[^\\n]+accelerator: '${escapedAccelerator}'[^\\n]+defaultAccelerator: '${escapedAccelerator}'`),
    );
  }
});
