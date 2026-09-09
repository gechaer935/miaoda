import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const source = readFileSync(path.join(root, 'src/data/jobCategories.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
Function('exports', 'module', compiled)(module.exports, module);
const { JOB_CATEGORIES, normalizeJobCategory, normalizeJobForCategory } = module.exports;

test('job catalog stays broad without overwhelming the selectors', () => {
  assert.ok(JOB_CATEGORIES.length >= 15 && JOB_CATEGORIES.length <= 18);
  const jobCount = JOB_CATEGORIES.reduce((total, category) => total + category.jobs.length, 0);
  assert.ok(jobCount >= 250 && jobCount <= 350);

  const keys = JOB_CATEGORIES.map((category) => category.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const category of JOB_CATEGORIES) {
    assert.ok(category.label.trim().length > 0);
    assert.ok(category.jobs.length >= 15 && category.jobs.length <= 30, `${category.label}岗位数量不合理`);
    assert.equal(new Set(category.jobs).size, category.jobs.length, `${category.label}存在重复岗位`);
  }
});

test('saved category and job values fall back safely', () => {
  assert.equal(normalizeJobCategory('product'), 'product');
  assert.equal(normalizeJobCategory('manufacturing'), 'machinery');
  assert.equal(normalizeJobCategory('legal'), 'hr_admin');
  assert.equal(normalizeJobCategory('trade'), 'supply_chain');
  assert.equal(normalizeJobCategory('removed-category'), 'it');
  assert.equal(normalizeJobForCategory('it', 'Java开发工程师'), 'Java开发工程师');
  assert.equal(normalizeJobForCategory('it', '不存在的岗位'), JOB_CATEGORIES[0].jobs[0]);
});
