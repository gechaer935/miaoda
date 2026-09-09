import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function loadTypeScriptModule(relativePath) {
  const source = readFileSync(path.join(root, relativePath), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
    console,
    Set,
    RegExp,
    String,
    Number,
    Array,
    Object,
  });
  return module.exports;
}

const { classifyInterviewQuestion } = loadTypeScriptModule('src/utils/interviewQuestionGate.ts');

test('local gate answers explicit and implicit interview prompts, including short follow-ups', () => {
  const prompts = [
    '请介绍一下你自己。',
    '为什么选择我们公司？',
    '线程安全吗？',
    '复杂度？',
    '然后呢？',
    '是个导轨吗？',
    '什么倒轨了？',
    'HashMap 和 ConcurrentHashMap 有什么区别',
    '说一下 JVM 垃圾回收机制',
    '你平时怎么排查线上 CPU 飙高？',
    '我想听听你对加班的看法。',
    '请从架构角度分析这个方案。',
    '项目里遇到的最大挑战',
    '未来三年的打算',
    '你的期望薪资',
    '你平常是自己写代码，还是用大模型编程啊呢',
    '你们项目 QPS 多大',
    '这个技术你熟悉不熟悉',
    '你做过高并发项目没有',
    '你在项目里负责哪一块',
    '那这种插入 delete update 的时候会有锁吗',
    'OK，那我这边基本上问完了，你看你这边有什么需要问我的吗？',
    'volatile',
    '线程池',
    '你的职业规划',
    'garbage collection',
    'What is the difference between a process and a thread?',
    'How would you design a rate limiter?',
    'Tell me about a difficult production incident.',
    'Walk me through your most recent project.',
    'Your strengths and weaknesses',
    'Why?',
    'なぜこの設計を選びましたか？',
    '어떻게 성능을 개선했습니까?',
  ];
  for (const prompt of prompts) {
    assert.equal(classifyInterviewQuestion(prompt).decision, 'answer', prompt);
  }
});

test('local gate suppresses real acknowledgement, closing and ASR-debris patterns', () => {
  const nonPrompts = [
    'OK',
    'okay.',
    'Oh.',
    'hmm',
    '嗯',
    '是',
    '不是',
    '你',
    '你。你',
    '这',
    '地图。',
    '我设计上。',
    '嗯，我知道。',
    '对，FCN信号。',
    '工作强度的话，智云这边其实跟网上也差不多，估计您这边也在网上了解过，对吧',
    '嗯，因为校招是今年我这边第一届校招，它的流程我还不是太清楚。',
    '线程池可以复用线程并降低创建开销。',
    '线程池复用线程。',
    '我们这边的工作强度不算大。',
    'Java uses garbage collection to reclaim unreachable objects.',
    'Java uses GC.',
    '这个项目没什么特别的。',
    '目前没有什么问题。',
    '为什么用 Redis，主要是因为它的读写性能比较好。',
    '你能听见我说话吗？',
    '你那边声音清楚吗？',
    '你能看到我共享的屏幕吗？',
    '准备好了吗？',
    '稍等一下。',
    'Can you hear me?',
    'Can you see my screen?',
    'Are you ready?',
    'OK，那我们今天就到这里，谢谢你的时间。嗯，好，我们再见。',
    '好的，辛苦了。',
    'That is all for today. Thank you for your time.',
    'What?',
  ];
  for (const text of nonPrompts) {
    assert.equal(classifyInterviewQuestion(text).decision, 'ignore', text);
  }
});

test('unfinished interviewer prompts get one bounded grace period and then stop', () => {
  const fragments = [
    '写代码，你就',
    '那你能基于',
    '我想问',
    '关于这个项目，',
    'Can you',
    'What is',
    'Tell me about',
  ];
  for (const fragment of fragments) {
    assert.equal(classifyInterviewQuestion(fragment).decision, 'defer', fragment);
    assert.equal(classifyInterviewQuestion(fragment, { settled: true }).decision, 'ignore', fragment);
  }
});

test('a fuller late revision can turn a deferred fragment into exactly one valid prompt', () => {
  assert.equal(classifyInterviewQuestion('写代码，你就').decision, 'defer');
  assert.equal(
    classifyInterviewQuestion('写代码，你就写一下基本成员变量和删除方法。').decision,
    'answer',
  );
});
