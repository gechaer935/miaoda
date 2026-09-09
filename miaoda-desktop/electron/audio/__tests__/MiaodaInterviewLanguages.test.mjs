import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const overlay = readFileSync(path.join(root, 'src/components/LiteOverlay.tsx'), 'utf8');
const languages = readFileSync(path.join(root, 'electron/config/languages.ts'), 'utf8');
const preload = readFileSync(path.join(root, 'electron/preload.ts'), 'utf8');

test('Lite interview exposes every language supported by production Fun-ASR Realtime', () => {
  for (const key of [
    'zh', 'cantonese', 'wu-chinese', 'minnan', 'hakka', 'gan-chinese', 'xiang-chinese', 'jin-chinese',
    'en', 'japanese', 'korean', 'vietnamese', 'thai', 'indonesian', 'malay', 'filipino', 'hindi', 'arabic',
    'french', 'german', 'spanish', 'portuguese', 'russian', 'italian', 'dutch', 'swedish', 'danish', 'finnish',
    'norwegian', 'greek', 'polish', 'czech', 'hungarian', 'romanian', 'bulgarian', 'croatian', 'slovak',
  ]) {
    assert.match(overlay, new RegExp(`(?:^|\\s|['\"])${key.replace('-', '\\-')}['\"]?\\s*:`));
  }
  assert.match(overlay, /中文与方言/);
  assert.match(overlay, /亚洲语言/);
  assert.match(overlay, /欧洲语言/);
});

test('selected interview language configures recognition before audio starts', () => {
  const start = overlay.indexOf('const startInterview');
  const end = overlay.indexOf('const stopInterview', start);
  const body = overlay.slice(start, end);
  const setLanguage = body.indexOf('setRecognitionLanguage?.(LANGUAGES[language].recognition)');
  const startMeeting = body.indexOf('startMeeting({ liteOverlay: true');
  assert.ok(setLanguage >= 0, 'recognition language must be configured');
  assert.ok(startMeeting > setLanguage, 'recognition language must be configured before meeting start');
  const liteKeys = preload.slice(preload.indexOf('const liteApiKeys'), preload.indexOf('const exposedElectronAPI'));
  assert.match(liteKeys, /['"]setRecognitionLanguage['"]/);
});

test('shared recognition catalog includes Fun-ASR dialect and extra language keys', () => {
  for (const key of ['cantonese', 'wu-chinese', 'minnan', 'hakka', 'gan-chinese', 'xiang-chinese', 'jin-chinese', 'filipino', 'croatian', 'slovak']) {
    assert.match(languages, new RegExp(`['\"]${key}['\"]\\s*:`));
  }
});

test('packaged Lite windows receive live quota broadcasts', () => {
  const liteKeys = preload.slice(preload.indexOf('const liteApiKeys'), preload.indexOf('const exposedElectronAPI'));
  assert.match(liteKeys, /['"]onMiaodaQuotaChanged['"]/);
  assert.match(overlay, /onMiaodaQuotaChanged\?\.\(\(quota\)/);
  assert.match(overlay, /setInterval\(\(\) => void check\(\), 5_000\)/);
});

test('interview quota display decreases once per fully consumed minute', () => {
  assert.match(overlay, /Math\.max\(0, Math\.ceil\(seconds \/ 60\)\)/);
  assert.match(overlay, /setInterval\(\(\) => void check\(\), 5_000\)/);
});
