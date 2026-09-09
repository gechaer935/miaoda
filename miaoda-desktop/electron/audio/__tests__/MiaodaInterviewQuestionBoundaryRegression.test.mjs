import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const capture = readFileSync(path.join(root, 'electron/audio/SystemAudioCapture.ts'), 'utf8');
const main = readFileSync(path.join(root, 'electron/main.ts'), 'utf8');
const preload = readFileSync(path.join(root, 'electron/preload.ts'), 'utf8');
const overlay = readFileSync(path.join(root, 'src/components/LiteOverlay.tsx'), 'utf8');

test('Lite interview boundary follows native speech activity instead of ASR callback gaps', () => {
  assert.match(capture, /waitingForSpeechStart[\s\S]*containsAudiblePcm16[\s\S]*emit\('speech_started'\)/);
  assert.match(main, /speech_started[\s\S]*native-audio-speech-started/);
  assert.match(preload, /onNativeAudioSpeechStarted[\s\S]*native-audio-speech-started/);
  assert.match(overlay, /onNativeAudioSpeechStarted[\s\S]*clearTimeout\(silenceTimerRef\.current\)/);
  assert.match(overlay, /onNativeAudioSpeechEnded[\s\S]*SPEECH_END_CONFIRM_MS/);

  const transcriptStart = overlay.indexOf('onNativeAudioTranscript');
  const transcriptEnd = overlay.indexOf('onNativeAudioSpeechStarted', transcriptStart);
  const transcriptBody = overlay.slice(transcriptStart, transcriptEnd);
  assert.match(transcriptBody, /TRANSCRIPT_FALLBACK_MS/);
  assert.match(transcriptBody, /nativeSpeechStateRef\.current === 'silent'/);
  assert.match(transcriptBody, /else if \(nativeSpeechStateRef\.current === 'unknown'\)/);
  assert.doesNotMatch(transcriptBody, /nativeSpeechStateRef\.current === 'speaking'[\s\S]*setTimeout/);
});

test('overlapping ASR tails merge into the existing answer card', () => {
  assert.match(overlay, /function mergeRepeatedQuestion/);
  assert.match(overlay, /const REPEATED_QUESTION_TAIL_GUARD_MS = 120_000/);
  assert.match(overlay, /now - lastCommitted\.timestamp < REPEATED_QUESTION_TAIL_GUARD_MS/);
  assert.match(overlay, /updateCard\(lastCommitted\.cardId,\s*\{[\s\S]{0,120}question: mergedQuestion/);

  const helpersStart = overlay.indexOf('function normalizeText');
  const helpersEnd = overlay.indexOf('function normalizeCardKey', helpersStart);
  const helperSource = `${overlay.slice(helpersStart, helpersEnd)}\n` +
    'globalThis.helpers = { isRepeatedQuestionTail, mergeRepeatedQuestion };';
  const compiled = ts.transpileModule(helperSource, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const sandbox = {};
  vm.runInNewContext(compiled, sandbox);
  const helpers = sandbox.helpers;
  const first = '对，那在这个计算机里面，这个数据结构，我们常见的数据结构的分类有哪些。分类的话，你熟悉的数据结构';
  const repeatedTail = '分类的话，那你熟悉的数据结构有哪些？';
  const noisyRepeatedTail = '那那些这些数据结构呢，在 Java 里面，你你有用过哪些吗？';
  const noisyOriginal = '嗯，okay。那对于这个里面像 Java 里面的数据结构，我们常见的有 ArrayList、集合类和 Map 类。这那那些这些数据结构呢，在 Java 里面用过哪些吗？';
  const realFollowUp = '数组和链表在随机访问和插入删除上有什么区别？';
  const topicalFollowUp = '这些数据结构在 Java 里各自适合什么使用场景？';
  assert.equal(helpers.isRepeatedQuestionTail(first, repeatedTail), true);
  assert.equal(helpers.isRepeatedQuestionTail(noisyOriginal, noisyRepeatedTail), true);
  assert.equal(helpers.isRepeatedQuestionTail(first, realFollowUp), false);
  assert.equal(helpers.isRepeatedQuestionTail(noisyOriginal, topicalFollowUp), false);
  assert.equal(helpers.mergeRepeatedQuestion(first, repeatedTail).startsWith(first), true);
});

test('streaming ASR never clears the whole pending question as a dedupe side effect', () => {
  const transcriptStart = overlay.indexOf('onNativeAudioTranscript');
  const transcriptEnd = overlay.indexOf('onNativeAudioSpeechStarted', transcriptStart);
  const transcriptBody = overlay.slice(transcriptStart, transcriptEnd);
  assert.match(transcriptBody, /interviewTurnCoordinatorRef\.current\.applyTranscript/);
  assert.match(transcriptBody, /application\.historical/);
  assert.match(transcriptBody, /reviseAutoTurnRef\.current\(turn\)/);
  assert.doesNotMatch(transcriptBody, /isLateRevision/);
  assert.doesNotMatch(transcriptBody, /interviewTurnCoordinatorRef\.current\.reset/);
});

test('a transcript arriving after native silence re-arms a bounded commit', () => {
  const transcriptStart = overlay.indexOf('onNativeAudioTranscript');
  const transcriptEnd = overlay.indexOf('onNativeAudioSpeechStarted', transcriptStart);
  const transcriptBody = overlay.slice(transcriptStart, transcriptEnd);
  assert.match(transcriptBody, /nativeSpeechStateRef\.current === 'silent'/);
  assert.match(transcriptBody, /remainingConfirmation/);
  assert.match(transcriptBody, /Math\.max\(LATE_TRANSCRIPT_SETTLE_MS, remainingConfirmation\)/);
  assert.match(transcriptBody, /commitPendingQuestion\(audioEndedAt, turn\.id\)/);
});

test('speech resumption cancels pending evaluation and lets the coordinator decide continuation', () => {
  const speechStart = overlay.indexOf('onNativeAudioSpeechStarted');
  const speechEnd = overlay.indexOf('onNativeAudioSpeechEnded', speechStart);
  const speechStartBody = overlay.slice(speechStart, speechEnd);
  assert.match(speechStartBody, /interviewTurnCoordinatorRef\.current\.speechStarted\(now\)/);
  assert.match(speechStartBody, /questionEvaluationTimerRef\.current/);
  assert.match(speechStartBody, /if \(!continued\)/);
});

test('a final for a new ASR segment cannot discard the recognized question prefix', () => {
  const helpersStart = overlay.indexOf('function normalizeText');
  const helpersEnd = overlay.indexOf('function normalizeCardKey', helpersStart);
  const helperSource = `${overlay.slice(helpersStart, helpersEnd)}\n` +
    'globalThis.helpers = { updateTranscriptSegments, composeTranscriptSegments, isRepeatedQuestionTail };';
  const compiled = ts.transpileModule(helperSource, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const sandbox = {};
  vm.runInNewContext(compiled, sandbox);
  const helpers = sandbox.helpers;
  const prefix = '对，那在这个计算机里面，这个数据结构我们常见的数据结构的分类有哪些？';
  const tail = '分类的话，你熟悉的数据结构有哪些？';
  let segments = helpers.updateTranscriptSegments([], { segmentId: 'sentence-1', text: prefix, final: false }, 1);
  segments = helpers.updateTranscriptSegments(segments, { segmentId: 'sentence-2', text: tail, final: true }, 2);
  const question = helpers.composeTranscriptSegments(segments);
  assert.match(question, /对，那在这个计算机里面/);
  assert.match(question, /你熟悉的数据结构有哪些/);
  assert.equal(helpers.isRepeatedQuestionTail('数据结构有了解吗？', question), false);
});

test('partial throttling is isolated by ASR segment id', () => {
  assert.match(main, /const key = `\$\{payload\.speaker\}:\$\{payload\.segmentId \|\| '__active__'\}`/);
});

test('Lite meetings do not invoke the legacy automatic answer engine', () => {
  const transcriptStart = main.indexOf("stt.on('transcript'");
  const transcriptEnd = main.indexOf("stt.on('error'", transcriptStart);
  const transcriptBody = main.slice(transcriptStart, transcriptEnd);
  assert.match(transcriptBody, /if \(!this\.currentMeetingIsLite\) \{[\s\S]*intelligenceManager\.handleTranscript/);
});
