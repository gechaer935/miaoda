import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')

test('settings keeps display preferences without exposing obsolete display location controls', () => {
  assert.match(app, /答案字号/)
  assert.match(app, /自动滚动/)
  assert.match(app, /当前会话/)
  assert.doesNotMatch(app, /显示位置/)
  assert.doesNotMatch(app, /display\.mode\.set/)
})
