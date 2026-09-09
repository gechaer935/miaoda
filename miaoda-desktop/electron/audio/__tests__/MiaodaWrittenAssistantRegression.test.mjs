import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const main = readFileSync(path.join(root, 'electron/main.ts'), 'utf8');
const windows = readFileSync(path.join(root, 'electron/WindowHelper.ts'), 'utf8');
const settingsWindow = readFileSync(path.join(root, 'electron/SettingsWindowHelper.ts'), 'utf8');
const cropperWindow = readFileSync(path.join(root, 'electron/CropperWindowHelper.ts'), 'utf8');
const modelSelectorWindow = readFileSync(path.join(root, 'electron/ModelSelectorWindowHelper.ts'), 'utf8');
const overlay = readFileSync(path.join(root, 'src/components/LiteOverlay.tsx'), 'utf8');
const keybinds = readFileSync(path.join(root, 'electron/services/KeybindManager.ts'), 'utf8');
const ipc = readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8');
const authClient = readFileSync(path.join(root, 'electron/services/MiaodaAuthClient.ts'), 'utf8');
const miaodaStt = readFileSync(path.join(root, 'electron/audio/MiaodaStreamingSTT.ts'), 'utf8');
const preload = readFileSync(path.join(root, 'electron/preload.ts'), 'utf8');
const mobile = readFileSync(path.join(root, '../miaoda-mobile-web/src/App.tsx'), 'utf8');
const mobileApi = readFileSync(path.join(root, '../miaoda-mobile-web/src/api.ts'), 'utf8');
const server = readFileSync(path.join(root, '../miaoda-go-server/internal/httpapi/server.go'), 'utf8');
const asrServer = readFileSync(path.join(root, '../miaoda-go-server/internal/httpapi/asr_ws.go'), 'utf8');
const companion = readFileSync(path.join(root, '../miaoda-go-server/internal/httpapi/companion.go'), 'utf8');
const provider = readFileSync(path.join(root, '../miaoda-go-server/internal/provider/provider.go'), 'utf8');
const config = readFileSync(path.join(root, '../miaoda-go-server/internal/config/config.go'), 'utf8');
const nativeStealth = readFileSync(path.join(root, 'native-module/src/stealth_window_win.rs'), 'utf8');

test('ACM shortcut is routed dynamically and selects the ACM preference', () => {
  assert.match(main, /assistantKind\s*===\s*['"]written['"][\s\S]*captureWrittenScreen/);
  assert.match(main, /assistantKind\s*===\s*['"]interview['"][\s\S]*openAssistantWindow\(['"]written['"],\s*['"]captureWrittenScreen['"]\)/);
  assert.match(keybinds, /'general:capture-and-process':\s*'CommandOrControl\+Shift\+C'/);
  assert.match(overlay, /action\s*===\s*['"]captureWrittenScreen['"][\s\S]*captureWrittenScreen\(['"]code['"]\)/);
});

test('LeetCode capture shortcut uses the core-code solve mode', () => {
  assert.match(keybinds, /'general:capture-leetcode':\s*'CommandOrControl\+Shift\+V'/);
  assert.match(main, /actionId\s*===\s*['"]general:capture-leetcode['"][\s\S]*captureWrittenLeetCode/);
  assert.match(main, /assistantKind\s*===\s*['"]interview['"][\s\S]*openAssistantWindow\(['"]written['"],\s*['"]captureWrittenLeetCode['"]\)/);
  assert.match(overlay, /action\s*===\s*['"]captureWrittenLeetCode['"][\s\S]*captureWrittenScreen\(['"]leetcode['"]\)/);
  assert.match(overlay, /type:\s*solveType/);
  assert.match(server, /LeetCode（力扣）核心代码模式/);
  assert.match(server, /禁止输出 Main\/main 程序入口/);
});

test('interview assistant can switch to written mode and first-open shortcuts trigger one capture', () => {
  assert.match(overlay, /assistant-compact-mode-switch[\s\S]{0,220}openAssistant\(isInterview \? 'written' : 'interview'\)/);
  assert.match(overlay, /isInterview \? '切换笔试' : '切换面试'/);
  assert.match(windows, /initialAction\?: AssistantWindowInitialAction/);
  assert.match(windows, /initialActionQuery[\s\S]*initialAction=/);
  assert.match(overlay, /initialWrittenActionHandledRef/);
  assert.match(overlay, /initialAction === 'captureWrittenLeetCode' \? 'leetcode' : 'code'/);
});

test('switching from interview to written stops background interview billing', () => {
  const openStart = windows.indexOf('public openAssistantWindow');
  const openEnd = windows.indexOf('const existing = this.assistantWindows.get(kind)', openStart);
  const openBody = windows.slice(openStart, openEnd);
  assert.match(openBody, /kind === 'written'/);
  assert.match(openBody, /this\.activeAssistantKind === 'interview'/);
  assert.match(openBody, /this\.appState\.getIsMeetingActive\(\)/);
  assert.match(openBody, /this\.appState\.endMeeting\(\)/);
});

test('written quota is checked before launch, assistant switching, shortcuts, and screenshots', () => {
  assert.match(overlay, /const ensureWrittenQuota/);
  assert.match(overlay, /remainingWrittenQuestions/);
  assert.match(overlay, /kind === 'written'[\s\S]{0,120}ensureWrittenQuota/);
  const captureStart = overlay.indexOf('const captureWrittenScreen');
  const screenshotStart = overlay.indexOf('takeScreenshot', captureStart);
  const quotaCheck = overlay.indexOf('ensureWrittenQuota', captureStart);
  assert.ok(quotaCheck > captureStart && quotaCheck < screenshotStart, 'quota must be checked before taking a screenshot');
  assert.match(overlay, /writtenQuotaExhausted[\s\S]{0,100}showWrittenQuotaNotice/);
  assert.match(overlay, /Written question quota is exhausted/i);
  assert.match(main, /const hasWrittenQuota/);
  assert.match(main, /assistantKind === 'interview'[\s\S]{0,240}hasWrittenQuota\(\)[\s\S]{0,300}writtenQuotaExhausted/);
  assert.match(overlay, /capture\.request[\s\S]{0,260}ensureWrittenQuota/);
});

test('interview quota is checked before opening, listening, manual questions, and phone commands', () => {
  assert.match(overlay, /const ensureInterviewQuota/);
  assert.match(overlay, /remainingInterviewSeconds/);
  assert.match(overlay, /kind === 'interview'[^\n]*ensureInterviewQuota/);
  assert.match(overlay, /const startInterview[\s\S]{0,600}ensureInterviewQuota/);
  assert.match(overlay, /const submitManual[\s\S]{0,500}ensureInterviewQuota/);
  assert.match(overlay, /event\?\.type === 'interview\.start'[\s\S]{0,500}ensureInterviewQuota/);
  assert.match(overlay, /event\?\.type === 'question\.manual'[\s\S]{0,500}ensureInterviewQuota/);
  assert.match(ipc, /assistant-window:open[\s\S]{0,700}remainingInterviewSeconds/);
  assert.match(ipc, /start-meeting[\s\S]{0,500}remainingInterviewSeconds/);
  assert.match(server, /consumeInterviewRequest/);
  assert.match(server, /ReserveWrittenQuestion/);
});

test('ASR bearer token stays out of WebSocket URLs', () => {
  const asrUrlStart = authClient.indexOf('public getAsrWebSocketUrl');
  const asrUrlEnd = authClient.indexOf('public setAsrModel', asrUrlStart);
  assert.doesNotMatch(authClient.slice(asrUrlStart, asrUrlEnd), /token,/);
  assert.match(miaodaStt, /headers:\s*\{\s*Authorization:\s*`Bearer \$\{token\}`/);
  assert.doesNotMatch(asrServer, /Query\(\)\.Get\(["']token["']\)/);
});

test('all Electron renderers deny remote navigation and production devtools', () => {
  assert.match(main, /app\.on\('web-contents-created'/);
  assert.match(main, /setWindowOpenHandler[\s\S]{0,260}action:\s*'deny'/);
  assert.match(main, /will-navigate[\s\S]{0,300}preventDefault/);
  assert.match(main, /will-attach-webview[\s\S]{0,100}preventDefault/);
  assert.match(main, /app\.isPackaged[\s\S]{0,180}devtools-opened[\s\S]{0,100}closeDevTools/);
  for (const source of [windows, settingsWindow, cropperWindow, modelSelectorWindow]) {
    assert.match(source, /nodeIntegration:\s*false[\s\S]{0,100}contextIsolation:\s*true[\s\S]{0,100}sandbox:\s*true/);
  }
  assert.match(authClient, /parsed\.protocol !== 'https:'[\s\S]{0,220}API base URL must use HTTPS/);
  assert.match(authClient, /parsed\.username \|\| parsed\.password \|\| parsed\.search \|\| parsed\.hash/);
  assert.match(authClient, /safeStorage\.encryptString\(value\)/);
  assert.match(authClient, /safeStorage\.decryptString\(Buffer\.from\(encrypted, 'base64'\)\)/);
  assert.match(ipc, /const trustedIpcSender/);
  assert.match(ipc, /if \(!trustedIpcSender\(event\)\) throw new Error\('Untrusted IPC sender'\)/);
  assert.match(ipc, /const requireTrustedCapturePath/);
  assert.match(ipc, /\['screenshots', 'extra_screenshots'\][\s\S]{0,500}fs\.promises\.realpath/);
  assert.match(ipc, /miaoda-written:solve-screen[\s\S]{0,500}requireTrustedCapturePath/);
  assert.match(ipc, /miaoda-companion:upload-capture[\s\S]{0,500}requireTrustedCapturePath/);
  assert.match(preload, /const liteApiKeys/);
  assert.match(preload, /process\.env\.NODE_ENV === 'development'[\s\S]{0,120}MIAODA_LEGACY_FEATURES === '1'/);
  assert.match(preload, /Object\.fromEntries\(liteApiKeys\.map/);
  const liteKeys = preload.slice(preload.indexOf('const liteApiKeys'), preload.indexOf('const exposedElectronAPI'));
  assert.doesNotMatch(liteKeys, /saveCustomProvider|openMailto|selectServiceAccount|skillsOpenFolder/);
});

test('standalone assistant waits for auth hydration without flashing the login screen', () => {
  assert.match(overlay, /const \[authReady, setAuthReady\]/);
  assert.match(overlay, /refreshAuth\(\)[\s\S]{0,180}setAuthReady\(true\)/);
  assert.match(overlay, /if \(!authReady\)[\s\S]{0,180}lite-auth-loading/);
});

test('home stays fixed without scrolling and uses a compact configuration dashboard', () => {
  const css = readFileSync(path.join(root, 'src/components/LiteOverlay.css'), 'utf8');
  assert.match(css, /\.lite-home\s*\{[\s\S]{0,260}grid-template-rows:\s*76px 92px 94px 76px minmax\(68px, max-content\)/);
  assert.match(css, /\.lite-home\s*\{[\s\S]{0,360}overflow:\s*hidden/);
  assert.doesNotMatch(overlay, /欢迎回来，选择今天需要使用的辅助场景/);
  assert.match(overlay, /lite-home-status-head[\s\S]{0,180}岗位与偏好/);
  assert.match(css, /\.lite-home-status\s*\{[\s\S]{0,260}grid-template-columns:\s*126px minmax\(0, 1fr\)/);
});

test('both code preferences preserve automatic handling for non-code questions', () => {
  assert.match(server, /仅当题型为编程题（QUESTION_TYPE 为 code）时/);
  assert.match(server, /如果不是编程题（QUESTION_TYPE 为 non_code）/);
  assert.match(server, /questionType\s*!=\s*"code"[\s\S]*return true/);
  assert.match(server, /validateWrittenOutput\(kind, output\)/);
});

test('shortcut settings window exposes an Electron drag region without swallowing button clicks', () => {
  const settings = readFileSync(path.join(root, 'src/components/SettingsPopup.tsx'), 'utf8');
  const css = readFileSync(path.join(root, 'src/index.css'), 'utf8');
  assert.match(settings, /miaoda-settings-head[^>]*title="按住标题区域可拖动窗口"/);
  assert.match(css, /\.miaoda-settings-head\s*\{[\s\S]*-webkit-app-region:\s*drag/);
  assert.match(css, /\.miaoda-settings-head button\s*\{[\s\S]*-webkit-app-region:\s*no-drag/);
});

test('desktop and phone assistants scroll together by answer or half page', () => {
  assert.match(keybinds, /'general:mobile-written-scroll-up':\s*'CommandOrControl\+Shift\+Up'/);
  assert.match(keybinds, /'general:mobile-written-scroll-down':\s*'CommandOrControl\+Shift\+Down'/);
  assert.match(main, /general:mobile-written-scroll-up[\s\S]*scrollMobileWrittenUp/);
  assert.match(main, /general:mobile-written-scroll-down[\s\S]*scrollMobileWrittenDown/);
  assert.match(main, /getActiveAssistantWindow\(\) \?\? this\.getMainWindow\(\)/);
  assert.doesNotMatch(main, /assistantKind === 'written'[\s\S]{0,260}scrollMobileWritten/);
  assert.match(overlay, /scrollMobileWrittenDown[\s\S]*scrollDesktopAssistant\(mode, direction\)/);
  assert.match(overlay, /miaodaCompanionSend\?\.\('assistant\.scroll', \{ direction, assistant: mode \}\)/);
  assert.match(overlay, /mode === 'written'[\s\S]*container\.scrollBy/);
  assert.match(overlay, /assistant-compact-answer-card:not\(\.live\) \.assistant-compact-answer[\s\S]*targetIndex/);
  assert.match(mobile, /writtenAnswerRef\.current\?\.scrollIntoView/);
  assert.match(mobile, /case\s*'assistant\.scroll':[\s\S]*scrollInterviewByAnswer\(direction\)[\s\S]*scrollWrittenByHalfPage\(direction\)/);
  assert.match(mobile, /querySelectorAll<HTMLElement>\('\.interview-turn \.interview-answer-card'\)[\s\S]*targetIndex/);
  assert.match(mobile, /case\s*'written\.scroll':[\s\S]*scrollWrittenByHalfPage/);
  assert.match(mobile, /document\.scrollingElement \|\| document\.documentElement/);
  assert.match(mobile, /viewportHeight \* 0\.5/);
  assert.match(mobile, /scrollTo\(\{ top: target, behavior: 'auto' \}\)/);
});

test('desktop and phone expose the expanded written language selector and keep capture language in sync', () => {
  for (const language of ['Java', 'C++', 'Python', 'Go', 'TypeScript', 'C#', 'Kotlin', 'Rust', 'Swift', 'SQL', 'MATLAB', 'Bash']) {
    assert.match(overlay, new RegExp(language.replace(/[+]/g, '\\+')));
    assert.match(mobile, new RegExp(language.replace(/[+]/g, '\\+')));
  }
  assert.match(overlay, /assistant-compact-language-switch/);
  assert.match(overlay, /lite-written-language-switch/);
  assert.match(mobile, /written-language-toolbar/);
  assert.match(mobile, /send\('capture\.request',\s*\{\s*language,\s*mode:\s*solveMode\s*\}\)/);
  assert.match(overlay, /requestedLanguage[\s\S]*miaodaCompanionUploadCapture\?\.\([\s\S]*language:\s*requestedLanguage/);
  assert.match(overlay, /written\.language\.set/);
  assert.match(mobile, /written\.language\.changed/);
});

test('desktop and phone can toggle ACM and LeetCode modes and use the selected mode for capture', () => {
  assert.match(overlay, /assistant-compact-solve-mode/);
  assert.match(overlay, /writtenSolveMode === 'code' \? 'leetcode' : 'code'/);
  assert.match(overlay, /const solveType = typeOverride \?\? writtenSolveMode/);
  assert.match(overlay, /written\.mode\.changed/);
  assert.match(overlay, /written\.mode\.set/);
  assert.match(overlay, /type:\s*requestedMode/);
  assert.match(mobile, /written-mode-button/);
  assert.match(mobile, /send\('written\.mode\.set',\s*\{\s*mode:\s*nextMode\s*\}\)/);
  assert.match(mobile, /case 'written\.mode\.changed'/);
  assert.match(mobileApi, /body\.append\('type', mode\)/);
  assert.match(companion, /"written\.mode\.set"/);
});

test('written capture hides Miaoda windows so stale answers cannot contaminate the screenshot', () => {
  const captureStart = overlay.indexOf('const captureWrittenScreen');
  const captureEnd = overlay.indexOf('const createMobilePairing', captureStart);
  const captureBody = overlay.slice(captureStart, captureEnd);
  assert.match(captureBody, /takeScreenshot\?\.\(\{\s*hideWindows:\s*true\s*\}\)/);
  assert.doesNotMatch(captureBody, /hideWindows:\s*false/);
});

test('written result consumes the server response field names', () => {
  assert.match(overlay, /questionText\s*\|\|\s*payload\?\.question/);
  assert.match(overlay, /recognitionModel\s*\|\|\s*payload\?\.visionModel/);
  assert.match(overlay, /if\s*\(!normalized\.answer\)\s*throw/);
});

test('written assistants retain a scrollable question and answer history on desktop and phone', () => {
  assert.match(overlay, /useState<WrittenHistoryItem\[]>\(\[\]\)/);
  assert.match(overlay, /setWrittenHistory\(\(current\) => \[\.\.\.current,/);
  assert.match(overlay, /writtenHistory\.map\(\(item\)[\s\S]*item\.question[\s\S]*item\.answer/);
  assert.match(mobile, /useState<WrittenResult\[]>\(\[\]\)/);
  assert.match(mobile, /setWrittenHistory\(current =>[\s\S]*\.\.\.current,/);
  assert.match(mobile, /results\.map\(\(result, index\)[\s\S]*result\.question[\s\S]*result\.answer/);
  assert.match(mobile, /writtenHistoryRef\.current/);
});

test('desktop written capture publishes progress, result, and errors to the paired phone', () => {
  const captureStart = overlay.indexOf('const captureWrittenScreen');
  const captureEnd = overlay.indexOf('const createMobilePairing', captureStart);
  const captureBody = overlay.slice(captureStart, captureEnd);
  assert.match(captureBody, /miaodaCompanionSend\?\.\('written\.progress'/);
  assert.match(captureBody, /miaodaCompanionSend\?\.\('written\.done',[\s\S]*questionText:\s*normalized\.question,[\s\S]*answer:\s*normalized\.answer/);
  assert.match(captureBody, /miaodaCompanionSend\?\.\('written\.error',\s*\{\s*message\s*\}/);
});

test('desktop interview capture publishes partial and final transcripts to the paired phone', () => {
  const transcriptStart = overlay.indexOf('onNativeAudioTranscript');
  const transcriptEnd = overlay.indexOf('const appendCard', transcriptStart);
  const transcriptBody = overlay.slice(transcriptStart, transcriptEnd);
  assert.match(transcriptBody, /transcript\.final/);
  assert.match(transcriptBody, /transcript\.partial/);
  assert.match(transcriptBody, /queueTranscriptSync\(final \? 'transcript\.final' : 'transcript\.partial', syncedTranscript\)/);
});

test('written UI shows live processing seconds but hides completed duration and provider models', () => {
  assert.match(overlay, /writtenElapsedMs/);
  assert.match(overlay, /setInterval\(update, 100\)/);
  assert.match(overlay, /writtenLoadingSeconds[\s\S]*思考中 \$\{writtenLoadingSeconds\} 秒/);
  assert.match(overlay, /setWrittenStatus\('已生成'\)/);
  assert.doesNotMatch(overlay, /writtenLatencyView|已等待|总耗时|总延迟/);
  assert.doesNotMatch(overlay, /modelLabel|\{card\.meta\}/);
  assert.match(overlay, /MiaodaWrittenLatency/);
});

test('code answers require a compact standalone ACM program', () => {
  assert.match(server, /ACM\/ICPC/);
  assert.match(server, /标准输入/);
  assert.match(server, /标准输出/);
  assert.match(server, /class Solution/);
  assert.match(server, /禁止任何行注释、块注释、文档注释和空行/);
  assert.match(server, /代码块结束后再输出以“思路：”开头/);
  assert.match(server, /核心算法、关键数据结构和复杂度/);
  assert.match(overlay, /compactAcmCodeBlocks/);
});

test('written answers use the bounded direct multimodal solver', () => {
  assert.match(server, /SolveImage\(r\.Context\(\),\s*b,\s*mime,\s*routes,\s*prompt/);
  assert.match(server, /Thinking:\s*s\.cfg\.WrittenSolverThinking/);
  assert.match(server, /Retries:\s*s\.cfg\.WrittenSolverRetries/);
  assert.match(server, /AttemptTimeout:\s*s\.cfg\.WrittenSolverAttemptTimeout/);
  assert.match(server, /written solve completed/);
  assert.match(server, /"solver_ms",\s*solverMs/);
  assert.match(provider, /payload\["enable_thinking"\]\s*=\s*thinking/);
  assert.match(config, /WRITTEN_SOLVER_THINKING/);
  assert.match(config, /WRITTEN_SOLVER_RETRIES/);
  assert.match(config, /WRITTEN_SOLVER_ATTEMPT_TIMEOUT_SECONDS/);
});

test('assistant native capture exclusion is only reasserted in privacy mode', () => {
  const methodStart = windows.indexOf('private reassertAssistantStealth');
  const methodEnd = windows.indexOf('public pinCurrentWindowTopmost', methodStart);
  const methodBody = windows.slice(methodStart, methodEnd);
  assert.match(methodBody, /if\s*\(this\.contentProtection\)[\s\S]*applyNativeStealthAttributes/);
});

test('turning privacy off keeps assistant windows out of the taskbar', () => {
  const removeStart = nativeStealth.indexOf('pub fn remove_stealth_from_window');
  const removeBody = nativeStealth.slice(removeStart);
  assert.match(removeBody, /!WS_EX_APPWINDOW/);
  assert.match(removeBody, /\| WS_EX_TOOLWINDOW/);
  assert.doesNotMatch(removeBody, /!WS_EX_TOOLWINDOW/);
  assert.match(removeBody, /WDA_NONE/);
  assert.match(windows, /applyNativeCaptureProtection\(win, enable,[\s\S]*win\.setSkipTaskbar\(true\)/);
});
