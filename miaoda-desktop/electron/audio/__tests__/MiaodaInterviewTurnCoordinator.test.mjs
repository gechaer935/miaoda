import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function loadCoordinator() {
  const source = readFileSync(path.join(root, 'src/utils/interviewTurnCoordinator.ts'), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
    Map,
    Set,
    Math,
    Date,
    String,
    Array,
  });
  return module.exports.InterviewTurnCoordinator;
}

const InterviewTurnCoordinator = loadCoordinator();

test('late correction keeps segment ownership and revises the original launched turn', () => {
  const coordinator = new InterviewTurnCoordinator();
  coordinator.reset(0);
  const first = coordinator.speechStarted(10).turn;
  coordinator.applyTranscript({ segmentId: 's1', text: '你如何保证线程安全', final: true }, 20);
  assert.equal(coordinator.markSettling(first.id), true);
  assert.equal(coordinator.markLaunched(first.id), true);
  coordinator.attachCard(first.id, 'card-1');

  const second = coordinator.speechStarted(3_000).turn;
  assert.notEqual(second.id, first.id);
  coordinator.applyTranscript({ segmentId: 's2', text: '说一下事务隔离级别', final: false }, 3_010);

  const correction = coordinator.applyTranscript({
    segmentId: 's1',
    text: '你如何保证这个类是线程安全的？',
    final: true,
  }, 3_020);
  assert.equal(correction.historical, true);
  assert.equal(correction.turn.id, first.id);
  assert.equal(correction.turn.cardId, 'card-1');
  assert.match(correction.turn.question, /线程安全/);
  assert.match(coordinator.get(second.id).question, /事务隔离/);
});

test('one logical turn can transition to launched only once', () => {
  const coordinator = new InterviewTurnCoordinator();
  const turn = coordinator.speechStarted(1).turn;
  coordinator.applyTranscript({ segmentId: 's1', text: '介绍一下线程池', final: true }, 2);
  assert.equal(coordinator.markLaunched(turn.id), true);
  assert.equal(coordinator.markLaunched(turn.id), false);
});

test('speech resumption during the settling window continues the same turn', () => {
  const coordinator = new InterviewTurnCoordinator();
  const first = coordinator.speechStarted(1).turn;
  coordinator.applyTranscript({ segmentId: 's1', text: '那你能基于', final: true }, 2);
  assert.equal(coordinator.markSettling(first.id), true);
  const resumed = coordinator.speechStarted(2_500);
  assert.equal(resumed.continued, true);
  assert.equal(resumed.turn.id, first.id);
  coordinator.applyTranscript({ segmentId: 's2', text: '这个方案继续优化吗？', final: true }, 2_510);
  assert.match(coordinator.get(first.id).question, /继续优化/);
});

test('an ignored fragment can be reconsidered by a late final before new speech', () => {
  const coordinator = new InterviewTurnCoordinator();
  const turn = coordinator.speechStarted(1).turn;
  coordinator.applyTranscript({ segmentId: 's1', text: '你', final: true }, 2);
  coordinator.markIgnored(turn.id);
  const revised = coordinator.applyTranscript({ segmentId: 's1', text: '你如何处理团队冲突？', final: true }, 100);
  assert.equal(revised.turn.id, turn.id);
  assert.equal(revised.turn.state, 'collecting');
  assert.match(revised.turn.question, /团队冲突/);
});

test('without native VAD, a fresh segment outside the revision window starts a new turn', () => {
  const coordinator = new InterviewTurnCoordinator({ revisionWindowMs: 1_000 });
  const first = coordinator.applyTranscript({ segmentId: 's1', text: '什么是索引？', final: true }, 1).turn;
  coordinator.markLaunched(first.id);
  const next = coordinator.applyTranscript({ segmentId: 's2', text: '什么是事务？', final: true }, 2_100);
  assert.notEqual(next.turn.id, first.id);
  assert.equal(next.historical, false);
});

test('without native VAD, a brand-new segment starts a new turn immediately after launch', () => {
  const coordinator = new InterviewTurnCoordinator({ revisionWindowMs: 8_000 });
  const first = coordinator.applyTranscript({ segmentId: 's1', text: '什么是索引？', final: true }, 1).turn;
  coordinator.markLaunched(first.id);
  const next = coordinator.applyTranscript({ segmentId: 's2', text: '什么是事务？', final: true }, 100);
  assert.notEqual(next.turn.id, first.id);
  assert.equal(next.historical, false);
  assert.equal(coordinator.get(first.id).question, '什么是索引？');
  assert.equal(next.turn.question, '什么是事务？');
});

test('an unowned late tail can be explicitly routed to the previous turn', () => {
  const coordinator = new InterviewTurnCoordinator();
  const first = coordinator.speechStarted(1).turn;
  coordinator.applyTranscript({ segmentId: 's1', text: '介绍一下线程池的核心参数', final: true }, 2);
  coordinator.markLaunched(first.id);
  const second = coordinator.speechStarted(3_000).turn;
  const late = coordinator.applyTranscript(
    { segmentId: 'late-new-id', text: '线程池的核心参数有哪些？', final: true },
    3_010,
    first.id,
  );
  assert.equal(late.historical, true);
  assert.equal(late.turn.id, first.id);
  assert.equal(coordinator.current().id, second.id);
  assert.equal(coordinator.current().question, '');
});
