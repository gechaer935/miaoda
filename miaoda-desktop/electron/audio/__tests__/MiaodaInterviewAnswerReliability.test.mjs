import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const overlay = readFileSync(path.join(root, 'src/components/LiteOverlay.tsx'), 'utf8');

test('interview answers retain and submit the latest six completed turns', () => {
  assert.match(overlay, /const INTERVIEW_CONTEXT_TURN_LIMIT = 6/);
  assert.match(overlay, /turnsRef\.current = \[[\s\S]{0,180}\.slice\(-INTERVIEW_CONTEXT_TURN_LIMIT\)/);
  assert.match(overlay, /context: turnsRef\.current[\s\S]{0,120}\.slice\(-INTERVIEW_CONTEXT_TURN_LIMIT\)/);
});

test('interview answer failover is session-sticky across DeepSeek and Qwen', () => {
  assert.match(overlay, /model: 'deepseek-v4-flash'/);
  assert.match(overlay, /deepseek-v4-flash retry/);
  assert.match(overlay, /deepseek-v4-pro fallback/);
  assert.match(overlay, /model: 'aliyun:qwen3\.7-plus'/);
  assert.match(overlay, /preferredFamily === 'qwen'[\s\S]{0,100}\? \[qwenAttempt, \.\.\.deepseekAttempts\]/);
  assert.match(overlay, /interviewModelFamilyRef\.current = attempt\.family/);
  assert.match(overlay, /interviewModelFamilyRef\.current = 'deepseek'/);
  assert.match(overlay, /调用大模型失败，正在切换…/);
});
