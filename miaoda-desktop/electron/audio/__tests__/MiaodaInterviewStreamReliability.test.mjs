import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const read = relativePath => readFileSync(path.join(root, relativePath), 'utf8');

const authClient = read('electron/services/MiaodaAuthClient.ts');
const handlers = read('electron/ipcHandlers.ts');
const preload = read('electron/preload.ts');
const overlay = read('src/components/LiteOverlay.tsx');
const mobile = read('../miaoda-mobile-web/src/App.tsx');

test('answer stream treats EOF without done as failure and has bounded watchdogs', () => {
  assert.match(authClient, /let receivedDone = false/);
  assert.match(authClient, /receivedDone = true/);
  assert.match(authClient, /if \(!receivedDone\)[\s\S]*ended before the done event/);
  assert.match(authClient, /AbortController\(\)/);
  assert.match(authClient, /controller\.abort\(\), 90_000/);
  assert.match(preload, /Interview answer stream timed out/);
  assert.match(preload, /100_000/);
  assert.match(handlers, /let terminalSent = false/);
  assert.match(handlers, /\.then\(\(result\) =>[\s\S]*type: 'done'/);
});

test('one local auto turn owns one model pipeline and stable companion request id', () => {
  assert.match(overlay, /answeredAutoTurnIdsRef\.current\.has\(logicalTurnId\)/);
  assert.match(overlay, /answeredAutoTurnIdsRef\.current\.add\(logicalTurnId\)/);
  assert.match(overlay, /const syncRequestId = companionRequestId \|\| logicalTurnId/);
  assert.match(overlay, /turnId: logicalTurnId/);
  assert.match(overlay, /pipelineId/);
  assert.match(overlay, /attemptId: attemptIndex/);
  assert.match(overlay, /sendCompanionSync\('answer\.started',[\s\S]{0,120}syncRequestId\)/);
  assert.match(overlay, /sendCompanionSync\('answer\.done',[\s\S]{0,180}syncRequestId\)/);
});

test('mobile routes concurrent tokens and terminal events by request id', () => {
  const tokenStart = mobile.indexOf("case 'answer.token'");
  const tokenEnd = mobile.indexOf("case 'answer.done'", tokenStart);
  const doneEnd = mobile.indexOf("case 'capture.result'", tokenEnd);
  assert.match(mobile.slice(tokenStart, tokenEnd), /event\.requestId \|\| activeTurnIdRef\.current/);
  assert.match(mobile.slice(tokenEnd, doneEnd), /event\.requestId \|\| activeTurnIdRef\.current/);
  assert.match(mobile.slice(tokenEnd, doneEnd), /activeTurnIdRef\.current === id/);
});
