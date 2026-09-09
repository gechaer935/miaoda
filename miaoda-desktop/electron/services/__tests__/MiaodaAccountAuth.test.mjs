import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('desktop exposes account login and registration while clearing persisted card sessions', () => {
  const auth = read('electron/services/MiaodaAuthClient.ts');
  const ipc = read('electron/ipcHandlers.ts');
  const preload = read('electron/preload.ts');
  const overlay = read('src/components/LiteOverlay.tsx');

  assert.doesNotMatch(ipc, /miaoda-auth:login/);
  assert.doesNotMatch(preload, /miaodaAuthLogin/);
  assert.doesNotMatch(overlay, /旧卡密|旧版授权卡密|loginMode/);
  assert.match(auth, /clearLegacyCardSession\(\)/);
  assert.match(auth, /setSetting\('miaodaAuthToken', ''\)/);
  assert.match(auth, /setSetting\('miaodaCardKey', undefined\)/);
  assert.match(auth, /setSetting\('miaodaAuthMode', undefined\)/);
  assert.doesNotMatch(auth, /authMode\?: 'account' \| 'card'/);
  assert.doesNotMatch(read('electron/services/SettingsManager.ts'), /'miaodaAuthToken',\s*\n\s*'miaodaAuthExpiresAt',\s*\n\s*'miaodaCardKey'/);
  assert.match(overlay, /if \(!authState\?\.isAuthenticated\)/);
  assert.match(auth, /public async registerAccount\(username: string, password: string\)/);
  assert.match(auth, /['"]\/api\/auth\/register['"]/);
  assert.match(ipc, /miaoda-auth:account-register/);
  assert.match(preload, /miaodaAccountRegister/);
  assert.match(overlay, /在客户端创建账户/);
  assert.match(overlay, /两次输入的密码不一致/);
});

test('logged-in desktop supports account card redemption and quota refresh', () => {
  const auth = read('electron/services/MiaodaAuthClient.ts');
  const ipc = read('electron/ipcHandlers.ts');
  const preload = read('electron/preload.ts');
  const overlay = read('src/components/LiteOverlay.tsx');

  assert.match(auth, /public async redeemCard\(cardKey: string\)/);
  assert.match(auth, /['"]\/api\/account\/redeem['"]/);
  assert.match(auth, /remainingInterviewSeconds: result\.remainingInterviewSeconds/);
  assert.match(ipc, /miaoda-account:redeem/);
  assert.match(preload, /miaodaAccountRedeem/);
  assert.match(overlay, /面试与笔试额度会立即充值到当前账号/);
  assert.match(overlay, /timeGreeting/);
  assert.match(overlay, /\$\{greeting\}，\$\{authState\?\.username \|\| username\}/);
  assert.match(overlay, /const CARD_SHOP_URL = 'https:\/\/example\.invalid\/'/);
  assert.match(overlay, />购买卡密</);
});

test('homepage exposes logout beside the greeting and returns to logged-out state', () => {
  const auth = read('electron/services/MiaodaAuthClient.ts');
  const ipc = read('electron/ipcHandlers.ts');
  const preload = read('electron/preload.ts');
  const overlay = read('src/components/LiteOverlay.tsx');

  assert.match(auth, /public async logout\(\)/);
  assert.match(auth, /this\.storeAuthToken\(''\)/);
  assert.match(ipc, /miaoda-auth:logout/);
  assert.match(preload, /miaodaAuthLogout/);
  assert.match(overlay, /className="lite-hero-account"/);
  assert.match(overlay, /className="lite-logout-button"/);
  assert.match(overlay, /await window\.electronAPI\.miaodaAuthLogout\?\.\(\)/);
  assert.match(overlay, /setAuthState\(state \|\| \{ isAuthenticated: false \}\)/);
  assert.match(overlay, /setPairing\(null\)/);
  assert.match(overlay, /setMobileConnected\(false\)/);
});

test('quota changes are broadcast to every desktop window and reflected by every renderer', () => {
  const ipc = read('electron/ipcHandlers.ts');
  const preload = read('electron/preload.ts');
  const overlay = read('src/components/LiteOverlay.tsx');

  assert.match(ipc, /BrowserWindow\.getAllWindows\(\)/);
  assert.match(ipc, /webContents\.send\('miaoda-auth:quota-changed', quota\)/);
  assert.match(ipc, /broadcastMiaodaQuota\(client\.getState\(\)\.quota\)/);
  assert.match(preload, /onMiaodaQuotaChanged/);
  assert.match(preload, /ipcRenderer\.on\('miaoda-auth:quota-changed', listener\)/);
  assert.match(overlay, /onMiaodaQuotaChanged\?\.\(\(quota\)/);
  assert.match(overlay, /current\?\.isAuthenticated \? \{ \.\.\.current, quota \} : current/);
  assert.match(overlay, /await refreshQuotaState\(\)\.catch\(\(\) => undefined\)/);
});
