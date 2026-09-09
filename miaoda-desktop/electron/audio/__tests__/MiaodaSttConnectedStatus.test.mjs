import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainSource = readFileSync(path.resolve(__dirname, '../../main.ts'), 'utf8');
const overlaySource = readFileSync(path.resolve(__dirname, '../../../src/components/LiteOverlay.tsx'), 'utf8');

function wireConnectedRecovery(stt, sendSttStatus) {
  let consecutiveErrors = 0;
  let lastState = 'awaiting-audio';

  stt.on('error', () => {
    consecutiveErrors += 1;
    lastState = 'reconnecting';
    sendSttStatus({ state: 'reconnecting', reconnectAttempts: consecutiveErrors });
  });

  stt.on('connected', () => {
    consecutiveErrors = 0;
    if (lastState !== 'connected') {
      lastState = 'awaiting-audio';
      sendSttStatus({ state: 'awaiting-audio' });
    }
  });
}

test('all streaming STT providers recover status on connected without waiting for transcript', () => {
  const transcriptListener = mainSource.indexOf("stt.on('transcript'");
  const connectedListener = mainSource.indexOf("stt.on('connected'");

  assert.ok(transcriptListener >= 0, 'could not locate the shared transcript listener');
  assert.ok(connectedListener > transcriptListener, 'connected recovery must be wired in the shared STT path');
  // The listener must stay provider-agnostic: no `instanceof` narrowing may gate
  // it to one engine, or providers without that class lose reconnect recovery.
  assert.doesNotMatch(
    mainSource.slice(transcriptListener, connectedListener),
    /if\s*\(\s*stt\s+instanceof\s+\w+\s*\)/,
    'connected recovery must not be limited to a single STT implementation',
  );
  assert.match(
    mainSource.slice(connectedListener, connectedListener + 600),
    /state\s*:\s*['"]awaiting-audio['"]/,
    'a ready WebSocket must clear reconnecting back to awaiting audio',
  );
});

test('Miaoda ready event clears reconnecting immediately while interviewer remains silent', () => {
  const stt = new EventEmitter();
  const statuses = [];
  wireConnectedRecovery(stt, (status) => statuses.push(status));

  stt.emit('error', new Error('temporary WebSocket interruption'));
  stt.emit('connected');

  assert.deepEqual(statuses.map((status) => status.state), ['reconnecting', 'awaiting-audio']);
  assert.equal(statuses.at(-1)?.reconnectAttempts, undefined);
});

test('overlay renders ready and transcript-connected states as listening', () => {
  assert.match(
    overlaySource,
    /next\.state\s*===\s*['"]connected['"]\s*\|\|\s*next\.state\s*===\s*['"]awaiting-audio['"][\s\S]{0,80}setStatus\(\s*['"]监听中['"]\s*\)/,
    'connected and awaiting-audio should both restore the listening label',
  );
});
