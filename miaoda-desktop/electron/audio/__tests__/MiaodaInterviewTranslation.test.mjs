import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const overlay = readFileSync(path.join(root, 'src/components/LiteOverlay.tsx'), 'utf8');
const helperSource = readFileSync(path.join(root, 'src/utils/interviewTranslation.ts'), 'utf8');
const preload = readFileSync(path.join(root, 'electron/preload.ts'), 'utf8');
const handlers = readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8');
const authClient = readFileSync(path.join(root, 'electron/services/MiaodaAuthClient.ts'), 'utf8');

function loadHelpers() {
  const compiled = ts.transpileModule(
    `${helperSource.replace(/^export /gm, '')}\nglobalThis.helpers = { normalizeInterviewTranslationMode, shouldTranslateInterview };`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
  ).outputText;
  const sandbox = {};
  vm.runInNewContext(compiled, sandbox);
  return sandbox.helpers;
}

test('translation mode is optional and only applies to non-Chinese interviews', () => {
  const helpers = loadHelpers();
  assert.equal(helpers.normalizeInterviewTranslationMode(undefined), 'off');
  assert.equal(helpers.normalizeInterviewTranslationMode('sentence'), 'complete');
  assert.equal(helpers.normalizeInterviewTranslationMode('complete'), 'complete');
  assert.equal(helpers.shouldTranslateInterview('English', 'complete'), true);
  assert.equal(helpers.shouldTranslateInterview('Chinese', 'complete'), false);
  assert.equal(helpers.shouldTranslateInterview('English', 'off'), false);
});

test('Lite interview exposes only off and complete-answer translation modes', () => {
  assert.match(overlay, /value="off"[^>]*>不翻译</);
  assert.match(overlay, /value="complete"[^>]*>完整答案翻译/);
  assert.doesNotMatch(overlay, /value="sentence"/);
  assert.match(overlay, /lite_interview_translation_mode/);
  assert.match(overlay, /translateQuestionPreview/);
});

test('translation boxes omit redundant question and answer labels', () => {
  assert.doesNotMatch(overlay, /<span>题目翻译<\/span>/);
  assert.doesNotMatch(overlay, /<span>中文翻译<\/span>/);
});

test('packaged bridge exposes authenticated streaming translation only', () => {
  const liteKeys = preload.slice(preload.indexOf('const liteApiKeys'), preload.indexOf('const exposedElectronAPI'));
  assert.match(liteKeys, /['"]miaodaInterviewTranslateStream['"]/);
  assert.match(preload, /miaoda-interview:translate-stream-start/);
  assert.match(handlers, /miaoda-interview:translate-stream-start/);
  assert.match(authClient, /\/api\/interview\/translate-stream/);
  assert.doesNotMatch(overlay, /DASHSCOPE_API_KEY|SecretKey|apiKey/);
});
