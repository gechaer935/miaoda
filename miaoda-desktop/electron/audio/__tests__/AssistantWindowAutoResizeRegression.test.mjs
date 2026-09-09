import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const windows = readFileSync(path.join(root, 'electron/WindowHelper.ts'), 'utf8');
const handlers = readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8');
const preload = readFileSync(path.join(root, 'electron/preload.ts'), 'utf8');
const overlay = readFileSync(path.join(root, 'src/components/LiteOverlay.tsx'), 'utf8');
const overlayCss = readFileSync(path.join(root, 'src/components/LiteOverlay.css'), 'utf8');
const mobileApp = readFileSync(path.join(root, '../miaoda-mobile-web/src/App.tsx'), 'utf8');

test('assistant windows start at the requested interview and written defaults', () => {
  const openStart = windows.indexOf('public openAssistantWindow');
  const openEnd = windows.indexOf('public closeAssistantWindow', openStart);
  const openBody = windows.slice(openStart, openEnd);
  assert.match(openBody, /const defaultWidth = kind === 'interview' \? 400 : 388/);
  assert.match(openBody, /const defaultHeight = kind === 'interview' \? 410 : 350/);
  assert.match(openBody, /const normalizeInitialAssistantHeight/);
  assert.match(openBody, /requestedContentHeight = process\.platform === 'win32' \? targetHeight - 1 : targetHeight/);
  assert.match(openBody, /win\.setContentSize\(win\.getContentSize\(\)\[0\], requestedContentHeight, false\)/);
  assert.match(openBody, /const minimumWidth = kind === 'written' \? 340 : 400/);
  assert.match(openBody, /const x = Math\.round\(workArea\.x \+ \(workArea\.width - width\) \/ 2\)/);
  assert.match(openBody, /const y = workArea\.y/);
  assert.match(openBody, /alwaysOnTop: true/);
  assert.match(openBody, /reassertAssistantStealth\(win, kind\)/);
});

test('written assistant fits only the newest completed answer card', () => {
  const measureStart = overlay.indexOf('function measureAssistantContentHeight');
  const measureEnd = overlay.indexOf('type LiteOverlayProps', measureStart);
  const measureBody = overlay.slice(measureStart, measureEnd);
  assert.match(measureBody, /answers\.children/);
  assert.match(measureBody, /answerItems\.at\(-1\)/);
  assert.match(measureBody, /!item\.classList\.contains\('live'\)/);
  assert.match(measureBody, /getBoundingClientRect\(\)\.height/);
  assert.doesNotMatch(measureBody, /answers\.scrollHeight/);
  assert.match(overlay, /resizeAssistantWindow\?\.\(height\)/);
  assert.match(overlay, /ref=\{assistantRootRef\}/);
});

test('streamed interview answers keep a stable native window until visible cards settle', () => {
  const effectStart = overlay.indexOf("if (standaloneAssistant !== 'interview'");
  const effectEnd = overlay.indexOf('useEffect(() => {', effectStart);
  const resizeEffect = overlay.slice(effectStart, effectEnd);
  assert.match(resizeEffect, /activePage !== 'interview'/);
  assert.match(resizeEffect, /hasPendingVisibleCard/);
  assert.match(resizeEffect, /card\.loading/);
  assert.match(resizeEffect, /card\.questionTranslationLoading/);
  assert.match(resizeEffect, /card\.answerTranslationLoading/);
  assert.match(resizeEffect, /liveTranscript \|\| liveTranscriptTranslationLoading \|\| hasPendingVisibleCard/);
  assert.match(resizeEffect, /measureInterviewContentHeight\(root\)/);
  assert.match(overlay, /className=\{`assistant-compact-live interview/);
  assert.match(overlayCss, /\.assistant-compact-live\.interview\s*\{[\s\S]*grid-template-rows:\s*minmax\(0,\s*1fr\)\s+38px/);
  assert.match(overlay, /element\.scrollTo\(\{ top: element\.scrollHeight, behavior: 'auto' \}\)/);
});

test('interview user can persistently show the latest one or two answer cards', () => {
  assert.match(overlay, /const INTERVIEW_IDLE_HEIGHT = 410/);
  assert.doesNotMatch(overlay, /INTERVIEW_DOUBLE_ANSWER_HEIGHT/);
  assert.match(overlay, /lite_interview_answer_view_count/);
  assert.match(overlay, /cards\.slice\(-interviewAnswerViewCount\)/);
  assert.match(overlay, /aria-label="答案显示数量"/);
  assert.match(overlay, /<option value=\{1\}>1题<\/option>/);
  assert.match(overlay, /<option value=\{2\}>2题<\/option>/);
  assert.match(overlay, /visibleInterviewCards\.map/);
  assert.match(overlay, /measureInterviewContentHeight/);
  assert.match(overlay, /resizeAssistantWindow\?\.\(height\)/);
  assert.match(windows, /Math\.abs\(currentHeight - targetHeight\) > 2/);
  assert.match(overlayCss, /\.assistant-compact-answer-count select/);
});

test('interview context is shown in the title without a separate status row', () => {
  const interviewStart = overlay.indexOf("{isInterview && activePage === 'interview'");
  const interviewEnd = overlay.indexOf("{!isInterview && activePage === 'written'", interviewStart);
  const interviewBody = overlay.slice(interviewStart, interviewEnd);
  assert.match(overlay, /assistant-compact-header-context[^>]*>\{activeJob\} · \{LANGUAGES\[language\]\.label\}/);
  assert.doesNotMatch(interviewBody, /assistant-compact-status/);
  assert.match(overlayCss, /\.assistant-compact-header-context/);
});

test('standalone assistant headers only show the assistant name', () => {
  const headerStart = overlay.indexOf('<header className="assistant-compact-header">');
  const headerEnd = overlay.indexOf('<div className="assistant-compact-tools">', headerStart);
  const headerBody = overlay.slice(headerStart, headerEnd);
  assert.match(headerBody, /<strong>\{isInterview \? '面试助手' : '笔试助手'\}<\/strong>/);
  assert.doesNotMatch(headerBody, /实时语音|屏幕识题/);
});

test('assistant resize is sender-scoped and clamped to the active display', () => {
  const resizeStart = windows.indexOf('public resizeAssistantWindow');
  const resizeEnd = windows.indexOf('public getAssistantWindows', resizeStart);
  const resizeBody = windows.slice(resizeStart, resizeEnd);
  assert.match(resizeBody, /win\.webContents\.id !== senderWebContentsId/);
  assert.match(resizeBody, /screen\.getDisplayMatching\(bounds\)\.workArea/);
  assert.match(resizeBody, /Math\.min\(maximumHeight/);
  assert.match(resizeBody, /width: bounds\.width, height/);
  assert.match(handlers, /assistant-window:resize[\s\S]*event\.sender\.id/);
  assert.match(preload, /resizeAssistantWindow:[\s\S]*assistant-window:resize/);
});

test('interview manual questions use an in-window composer with keyboard and loading states', () => {
  assert.doesNotMatch(overlay, /window\.prompt\(/);
  assert.match(overlay, /className="assistant-compact-manual" onSubmit=\{submitManual\}/);
  assert.match(overlay, /aria-label="手动输入面试问题"/);
  assert.match(overlay, /event\.key === 'Enter'[\s\S]*requestSubmit\(\)/);
  assert.match(overlay, /event\.key === 'Escape'[\s\S]*cancelManualQuestion\(\)/);
  assert.match(overlay, /manualQuestionSubmitting \? '生成中…' : '发送'/);
  assert.match(overlay, /正在生成回答，请稍候…/);
  assert.match(overlayCss, /\.assistant-compact-live\.manual-open/);
  assert.match(overlayCss, /\.assistant-compact-manual textarea:focus/);
});

test('mobile interview removes non-functional stop-answer and end-interview controls', () => {
  assert.doesNotMatch(mobileApp, /停止回答/);
  assert.doesNotMatch(mobileApp, /结束面试/);
  assert.doesNotMatch(mobileApp, /send\('answer\.cancel'\)/);
  assert.doesNotMatch(mobileApp, /send\('interview\.stop'\)/);
  assert.match(mobileApp, /send\('question\.manual'/);
});

test('standalone interview and written assistants can return home without quitting the app', () => {
  assert.match(overlay, /assistant-compact-home-button[^>]*[\s\S]{0,180}closeAssistantWindow\?\.\(\)/);
  assert.match(overlay, /assistant-compact-home-button[\s\S]{0,220}>主页<\/button>/);
  assert.doesNotMatch(overlay, /assistant-compact-home-button[^>]*[\s\S]{0,180}quitApp/);
  assert.match(handlers, /assistant-window:close[\s\S]*closeAssistantWindow\(event\.sender\.id\)/);
  assert.match(overlayCss, /\.assistant-compact-tools \.assistant-compact-home-button/);
});
