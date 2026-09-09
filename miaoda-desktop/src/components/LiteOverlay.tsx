import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Download, EyeOff, MonitorOff, MousePointer2, RefreshCw, Settings, X } from 'lucide-react';
import { JOB_CATEGORIES, normalizeJobCategory, normalizeJobForCategory, type JobCategoryKey } from '../data/jobCategories';
import {
  interviewTranslationModeLabel,
  normalizeInterviewTranslationMode,
  shouldTranslateInterview,
  type InterviewTranslationMode,
} from '../utils/interviewTranslation';
import { classifyInterviewQuestion } from '../utils/interviewQuestionGate';
import {
  InterviewTurnCoordinator,
  type AutoQuestionTurn,
} from '../utils/interviewTurnCoordinator';
import './LiteOverlay.css';

type LatencyBreakdown = {
  silenceMs: number;
  clientPrepMs: number;
  uploadMs: number;
  apiFirstTokenMs: number;
  generationMs: number;
  totalMs: number;
};
type WrittenLatencyBreakdown = {
  captureMs: number;
  serviceMs: number;
  uploadMs?: number;
  visionMs?: number;
  answerMs?: number;
  solverMs?: number;
  serverMs?: number;
  totalMs: number;
  completed: boolean;
};
type Card = {
  id: string;
  question?: string;
  questionTranslation?: string;
  questionTranslationLoading?: boolean;
  questionTranslationError?: string;
  answer: string;
  answerTranslation?: string;
  answerTranslationLoading?: boolean;
  answerTranslationError?: string;
  meta?: string;
  loading?: boolean;
  latency?: LatencyBreakdown;
};
type WrittenHistoryItem = { id: string; question: string; answer: string; loading?: boolean };
type Turn = { id: string; question: string; answer: string; ts: number };
type InterviewModelFamily = 'deepseek' | 'qwen';
type InterviewModelAttempt = { model: string; meta: string; family: InterviewModelFamily };
type Page = 'home' | 'interview-setup' | 'written-setup' | 'interview' | 'written';
type AssistantScrollMode = 'interview' | 'written';
type WrittenSolveMode = 'auto' | 'code' | 'leetcode';
type WrittenCodeMode = Exclude<WrittenSolveMode, 'auto'>;
type HeaderKeybind = { id: string; accelerator: string };
type BufferedTranscriptSegment = { id: string; text: string; final: boolean; order: number };
type TranscriptSegmentUpdate = { segmentId?: string; text: string; final: boolean };
type PendingTranscriptSync = { type: 'transcript.partial' | 'transcript.final'; text: string; timer: number | null };
type PendingAnswerSync = { token: string; requestId?: string; timer: number | null };
type TranslationResult = { translation: string; model?: string };
type AutoTurnCardRecord = { cardId: string; question: string; timestamp: number };
type AppUpdateUiState = {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded';
  currentVersion: string;
  version?: string;
  percent?: number;
  error?: string;
  canAutoUpdate: boolean;
};
// Native system-audio VAD reports speech-ended after roughly 600 ms of
// hangover. Wait only the remainder here so the user-facing boundary stays at
// about two seconds of real silence, rather than two seconds without ASR text.
const SILENCE_MS = 2000;
const NATIVE_VAD_HANGOVER_MS = 600;
const SPEECH_END_CONFIRM_MS = SILENCE_MS - NATIVE_VAD_HANGOVER_MS;
const TRANSCRIPT_FALLBACK_MS = 4000;
// A provider final can arrive just after the native two-second boundary fired.
// Give that late final one event-loop-sized settle window, then commit it. This
// is not added to the normal path unless the ASR event itself arrived late.
const LATE_TRANSCRIPT_SETTLE_MS = 180;
// A complete question receives a very short correction window after the
// two-second silence boundary. Only incomplete prompt prefixes get the longer
// grace period; ordinary interview questions retain near-current latency.
const COMPLETE_QUESTION_STABILITY_MS = 280;
const INCOMPLETE_QUESTION_SETTLE_MS = 1_000;
// Streaming ASR can deliver a revised final tail after the answer request has
// already spent tens of seconds generating. Keep this guard independent from
// model latency so a late revision cannot become a second question.
const REPEATED_QUESTION_TAIL_GUARD_MS = 120_000;
const COMPANION_CONTENT_SYNC_INTERVAL_MS = 500;
const INTERVIEW_CONTEXT_TURN_LIMIT = 6;
const INTERVIEW_IDLE_HEIGHT = 410;
const INTERVIEW_MODEL_SWITCHING_MESSAGE = '调用大模型失败，正在切换…';
const AUTOMATIC_VISION_MODE = 'auto' as const;

function interviewModelAttempts(preferredFamily: InterviewModelFamily): InterviewModelAttempt[] {
  const deepseekAttempts: InterviewModelAttempt[] = [
    { model: 'deepseek-v4-flash', meta: 'Server / deepseek-v4-flash', family: 'deepseek' },
    { model: 'deepseek-v4-flash', meta: 'Server / deepseek-v4-flash retry', family: 'deepseek' },
    { model: 'deepseek-v4-pro', meta: 'Server / deepseek-v4-pro fallback', family: 'deepseek' },
  ];
  const qwenAttempt: InterviewModelAttempt = {
    model: 'aliyun:qwen3.7-plus',
    meta: 'Server / qwen3.7-plus fallback',
    family: 'qwen',
  };
  return preferredFamily === 'qwen'
    ? [qwenAttempt, ...deepseekAttempts]
    : [...deepseekAttempts, qwenAttempt];
}

const LANGUAGES = {
  zh: { label: '中文（普通话）', response: 'Chinese', recognition: 'chinese' },
  cantonese: { label: '粤语', response: 'Chinese', recognition: 'cantonese' },
  'wu-chinese': { label: '吴语', response: 'Chinese', recognition: 'wu-chinese' },
  minnan: { label: '闽南语', response: 'Chinese', recognition: 'minnan' },
  hakka: { label: '客家话', response: 'Chinese', recognition: 'hakka' },
  'gan-chinese': { label: '赣语', response: 'Chinese', recognition: 'gan-chinese' },
  'xiang-chinese': { label: '湘语', response: 'Chinese', recognition: 'xiang-chinese' },
  'jin-chinese': { label: '晋语', response: 'Chinese', recognition: 'jin-chinese' },
  en: { label: 'English', response: 'English', recognition: 'english-us' },
  japanese: { label: '日本語', response: 'Japanese', recognition: 'japanese' },
  korean: { label: '한국어', response: 'Korean', recognition: 'korean' },
  vietnamese: { label: 'Tiếng Việt', response: 'Vietnamese', recognition: 'vietnamese' },
  thai: { label: 'ภาษาไทย', response: 'Thai', recognition: 'thai' },
  indonesian: { label: 'Bahasa Indonesia', response: 'Indonesian', recognition: 'indonesian' },
  malay: { label: 'Bahasa Melayu', response: 'Malay', recognition: 'malay' },
  filipino: { label: 'Filipino', response: 'Filipino', recognition: 'filipino' },
  hindi: { label: 'हिन्दी', response: 'Hindi', recognition: 'hindi' },
  arabic: { label: 'العربية', response: 'Arabic', recognition: 'arabic' },
  french: { label: 'Français', response: 'French', recognition: 'french' },
  german: { label: 'Deutsch', response: 'German', recognition: 'german' },
  spanish: { label: 'Español', response: 'Spanish', recognition: 'spanish' },
  portuguese: { label: 'Português', response: 'Portuguese', recognition: 'portuguese' },
  russian: { label: 'Русский', response: 'Russian', recognition: 'russian' },
  italian: { label: 'Italiano', response: 'Italian', recognition: 'italian' },
  dutch: { label: 'Nederlands', response: 'Dutch', recognition: 'dutch' },
  swedish: { label: 'Svenska', response: 'Swedish', recognition: 'swedish' },
  danish: { label: 'Dansk', response: 'Danish', recognition: 'danish' },
  finnish: { label: 'Suomi', response: 'Finnish', recognition: 'finnish' },
  norwegian: { label: 'Norsk', response: 'Norwegian', recognition: 'norwegian' },
  greek: { label: 'Ελληνικά', response: 'Greek', recognition: 'greek' },
  polish: { label: 'Polski', response: 'Polish', recognition: 'polish' },
  czech: { label: 'Čeština', response: 'Czech', recognition: 'czech' },
  hungarian: { label: 'Magyar', response: 'Hungarian', recognition: 'hungarian' },
  romanian: { label: 'Română', response: 'Romanian', recognition: 'romanian' },
  bulgarian: { label: 'Български', response: 'Bulgarian', recognition: 'bulgarian' },
  croatian: { label: 'Hrvatski', response: 'Croatian', recognition: 'croatian' },
  slovak: { label: 'Slovenčina', response: 'Slovak', recognition: 'slovak' },
} as const;

type InterviewLanguage = keyof typeof LANGUAGES;

const INTERVIEW_LANGUAGE_GROUPS: Array<{ label: string; options: InterviewLanguage[] }> = [
  { label: '中文与方言', options: ['zh', 'cantonese', 'wu-chinese', 'minnan', 'hakka', 'gan-chinese', 'xiang-chinese', 'jin-chinese'] },
  { label: '亚洲语言', options: ['en', 'japanese', 'korean', 'vietnamese', 'thai', 'indonesian', 'malay', 'filipino', 'hindi', 'arabic'] },
  { label: '欧洲语言', options: ['french', 'german', 'spanish', 'portuguese', 'russian', 'italian', 'dutch', 'swedish', 'danish', 'finnish', 'norwegian', 'greek', 'polish', 'czech', 'hungarian', 'romanian', 'bulgarian', 'croatian', 'slovak'] },
];

function normalizeInterviewLanguage(value: unknown): InterviewLanguage {
  const candidate = String(value || '').trim() as InterviewLanguage;
  return candidate in LANGUAGES ? candidate : 'zh';
}

function InterviewLanguageOptions() {
  return <>{INTERVIEW_LANGUAGE_GROUPS.map((group) => (
    <optgroup key={group.label} label={group.label}>
      {group.options.map((key) => <option key={key} value={key}>{LANGUAGES[key].label}</option>)}
    </optgroup>
  ))}</>;
}

function InterviewTranslationModeOptions() {
  return (
    <>
      <option value="off">不翻译</option>
      <option value="complete">完整答案翻译</option>
    </>
  );
}

const WRITTEN_LANGUAGE_GROUPS = [
  { label: '常用语言', options: ['Java', 'C++', 'Python', 'Go', 'JavaScript', 'TypeScript', 'C', 'C#', 'Kotlin', 'Rust'] },
  { label: '移动与应用', options: ['Swift', 'Objective-C', 'Dart', 'PHP', 'Ruby'] },
  { label: '数据与脚本', options: ['SQL', 'R', 'MATLAB', 'Bash', 'Lua', 'Perl'] },
  { label: '其他语言', options: ['Scala', 'Groovy', 'Haskell', 'F#', 'Visual Basic', 'Pascal'] },
] as const;

const WRITTEN_LANGUAGES = WRITTEN_LANGUAGE_GROUPS.flatMap((group) => [...group.options]);

function normalizeWrittenLanguage(value: unknown): string {
  const candidate = String(value || '').trim();
  return WRITTEN_LANGUAGES.includes(candidate as typeof WRITTEN_LANGUAGES[number]) ? candidate : 'Java';
}

function normalizeWrittenSolveMode(value: unknown): WrittenCodeMode {
  return value === 'leetcode' ? 'leetcode' : 'code';
}

function writtenSolveModeLabel(mode: WrittenCodeMode): string {
  return mode === 'leetcode' ? '力扣模式' : 'ACM 完整程序';
}

function WrittenLanguageOptions() {
  return <>{WRITTEN_LANGUAGE_GROUPS.map((group) => (
    <optgroup key={group.label} label={group.label}>
      {group.options.map((item) => <option key={item} value={item}>{item}</option>)}
    </optgroup>
  ))}</>;
}

function normalizeText(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeInterviewAnswerViewCount(value: unknown): 1 | 2 {
  return Number(value) === 2 ? 2 : 1;
}

function displayShortcut(value?: string): string {
  if (!value) return '未设置';
  return value
    .replace(/CommandOrControl/gi, 'Ctrl')
    .replace(/Command/gi, 'Cmd')
    .replace(/Control/gi, 'Ctrl');
}

function questionFingerprint(value: string): string {
  return normalizeText(value)
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}\s]/gu, '');
}

function repeatedTailFingerprint(value: string): string {
  return questionFingerprint(value)
    // Streaming ASR often inserts conversational fillers or repeats pronouns
    // while revising the tail of a sentence. Ignore that noise only for
    // duplicate comparison; the visible transcript keeps the original text.
    .replace(/(?:okay|ok|嗯|呃|额|哦)/giu, '')
    .replace(/(?:这些|那些|这个|那个|这|那)/gu, '')
    .replace(/([你我他她它])\1+/gu, '$1')
    .replace(/[呢嘛呀啊吧]/gu, '');
}

function editDistance(left: string, right: string): number {
  if (!left) return right.length;
  if (!right) return left.length;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length];
}

function isSimilarQuestion(left: string, right: string): boolean {
  const a = questionFingerprint(left);
  const b = questionFingerprint(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const lengthRatio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
  if (lengthRatio < 0.82) return false;
  if ((a.includes(b) || b.includes(a)) && lengthRatio >= 0.9) return true;
  const similarity = 1 - editDistance(a, b) / Math.max(a.length, b.length);
  return similarity >= 0.9;
}

function ngramContainment(left: string, right: string, size = 2): number {
  const grams = (value: string): Set<string> => {
    const result = new Set<string>();
    for (let index = 0; index <= value.length - size; index += 1) result.add(value.slice(index, index + size));
    return result;
  };
  const a = grams(left);
  const b = grams(right);
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  const smaller = a.size <= b.size ? a : b;
  const larger = smaller === a ? b : a;
  smaller.forEach((gram) => { if (larger.has(gram)) shared += 1; });
  return shared / smaller.size;
}

function isRepeatedQuestionTail(previousQuestion: string, nextFragment: string): boolean {
  const previous = repeatedTailFingerprint(previousQuestion);
  const fragment = repeatedTailFingerprint(nextFragment);
  if (fragment.length < 6 || previous.length < 6) return false;
  if (isSimilarQuestion(previous, fragment)) return true;
  // Only accept a contained fragment or a highly similar suffix as a repeated
  // tail. Broad topical n-gram overlap is not enough: two consecutive interview
  // questions often share terms such as "数据结构", but are still distinct.
  if (previous.includes(fragment)) return true;
  if (previous.length <= fragment.length) return false;
  // A lightly revised tail must be anchored in the latter half of the previous
  // question. This keeps Fun-ASR tail corrections working without treating
  // general topic overlap as duplication.
  for (let anchorSize = Math.min(8, fragment.length); anchorSize >= 4; anchorSize -= 1) {
    const anchorIndex = previous.lastIndexOf(fragment.slice(0, anchorSize));
    if (anchorIndex >= Math.floor(previous.length * 0.45)) {
      const previousTail = previous.slice(anchorIndex);
      if (ngramContainment(previousTail, fragment) >= 0.68) return true;
    }
  }
  const minSize = Math.max(6, fragment.length - 2);
  const maxSize = Math.min(previous.length, fragment.length + 3);
  for (let size = minSize; size <= maxSize; size += 1) {
    const suffix = previous.slice(-size);
    const similarity = 1 - editDistance(fragment, suffix) / Math.max(fragment.length, suffix.length);
    if (similarity >= 0.88) return true;
  }
  return false;
}

function chooseFinalSegmentText(previousText: string, finalText: string): string {
  const previous = normalizeText(previousText);
  const final = normalizeText(finalText);
  if (!previous) return final;
  if (!final) return previous;
  const previousFingerprint = questionFingerprint(previous);
  const finalFingerprint = questionFingerprint(final);
  if (finalFingerprint.includes(previousFingerprint)) return final;
  if (previousFingerprint.includes(finalFingerprint)) {
    const ending = final.match(/[?？。！!]\s*$/)?.[0] || '';
    return ending && !/[?？。！!]\s*$/.test(previous) ? `${previous}${ending}` : previous;
  }
  // A final normally supersedes the partial of the same segment. Some ASR
  // providers occasionally emit only a short final tail, though; retaining the
  // fuller partial is safer than silently deleting recognized words.
  if (finalFingerprint.length < previousFingerprint.length * 0.7) return previous;
  return final;
}

function updateTranscriptSegments(
  current: BufferedTranscriptSegment[],
  update: TranscriptSegmentUpdate,
  fallbackOrder: number,
): BufferedTranscriptSegment[] {
  const text = normalizeText(update.text);
  if (!text) return current;
  const explicitId = normalizeText(update.segmentId || '');
  let index = explicitId
    ? current.findIndex((segment) => segment.id === explicitId)
    : current.findIndex((segment) => segment.id.startsWith('__anonymous__') && !segment.final);

  if (index < 0) {
    const id = explicitId || `__anonymous__${fallbackOrder}`;
    return [...current, { id, text, final: update.final, order: fallbackOrder }];
  }

  const existing = current[index];
  const nextText = update.final ? chooseFinalSegmentText(existing.text, text) : text;
  const next = [...current];
  next[index] = { ...existing, text: nextText, final: existing.final || update.final };
  return next;
}

function mergeTranscriptPieces(previousText: string, nextText: string): string {
  const previous = normalizeText(previousText);
  const next = normalizeText(nextText);
  if (!previous) return next;
  if (!next) return previous;
  if (previous.endsWith(next)) return previous;
  if (next.startsWith(previous)) return next;

  const maxOverlap = Math.min(previous.length, next.length);
  for (let size = maxOverlap; size >= 4; size -= 1) {
    if (previous.slice(-size) === next.slice(0, size)) {
      return normalizeText(`${previous}${next.slice(size)}`);
    }
  }
  return normalizeText(`${previous} ${next}`);
}

function composeTranscriptSegments(segments: BufferedTranscriptSegment[]): string {
  return [...segments]
    .sort((left, right) => left.order - right.order)
    .reduce((result, segment) => mergeTranscriptPieces(result, segment.text), '');
}

function mergeRepeatedQuestion(previousQuestion: string, nextFragment: string): string {
  const previous = normalizeText(previousQuestion);
  const fragment = normalizeText(nextFragment);
  const previousFingerprint = questionFingerprint(previous);
  const fragmentFingerprint = questionFingerprint(fragment);
  if (!previousFingerprint) return fragment;
  if (!fragmentFingerprint) return previous;
  if (previousFingerprint.includes(fragmentFingerprint)) return previous;
  if (fragmentFingerprint.includes(previousFingerprint)) return fragment;
  // A shorter repeated tail usually only adds a final question particle. Keep
  // the fuller ASR sentence so the visible card does not contain duplicated text.
  if (fragmentFingerprint.length <= previousFingerprint.length * 0.75) {
    const ending = fragment.match(/[?？。！!]\s*$/)?.[0] || '';
    return ending && !/[?？。！!]\s*$/.test(previous) ? `${previous}${ending}` : previous;
  }
  return fragmentFingerprint.length > previousFingerprint.length ? fragment : previous;
}

function normalizeCardKey(value: string): string {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[‐‑‒–—−]/g, '-')
    .replace(/\s+/g, '');
}

const CARD_SHOP_URL = 'https://example.invalid/';

function friendlyLoginError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || '');
  if (/用户名或密码错误|invalid[ _-]?credentials/i.test(raw)) {
    return '用户名或密码错误';
  }
  if (/登录尝试过多|too many login|rate[ _-]?limit|\b429\b/i.test(raw)) {
    return '登录尝试过多，请稍后再试';
  }
  if (/experience[ _-]?requires[ _-]?account/i.test(raw)) {
    return '体验卡需要先在官网账户中心兑换，再使用账户登录';
  }
  if (/invalid[ _-]?card|card[ _-]?not[ _-]?found|no rows/i.test(raw)) {
    return '卡密不存在或已被删除，请在管理后台确认后重新输入';
  }
  if (/device[ _-]?limit|max devices|too many devices/i.test(raw)) {
    return '该卡密的设备数量已达上限，请先在管理后台清除设备绑定';
  }
  if (/expired|inactive|disabled/i.test(raw)) {
    return '该卡密已过期或被停用，请联系管理员';
  }
  if (/fetch failed|failed to fetch|econnrefused|network/i.test(raw)) {
    return '无法连接秒答后端，请确认后端服务已启动';
  }
  return raw
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    || '登录失败，请稍后重试';
}

function friendlyRegisterError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || '');
  if (/用户名须为|invalid[ _-]?username/i.test(raw)) return '用户名须为 4～32 个字符';
  if (/密码长度须为|invalid[ _-]?password/i.test(raw)) return '密码长度须为 8～24 个字符';
  if (/用户名不可用|username[ _-]?unavailable|unique/i.test(raw)) return '该用户名已被使用，请更换后重试';
  if (/注册.*过多|registration[ _-]?rate[ _-]?limited|rate[ _-]?limit|\b429\b/i.test(raw)) return '当前网络注册账户过多，请稍后再试';
  if (/fetch failed|failed to fetch|ECONNREFUSED|ENOTFOUND|network|timeout/i.test(raw)) return '暂时无法连接秒答服务，请检查网络后重试';
  return raw || '注册失败，请稍后重试';
}

function friendlyRedeemError(error: unknown): string {
  const raw = (error instanceof Error ? error.message : String(error || ''))
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '');
  if (/卡密无效或已被兑换|invalid[ _-]?redemption/i.test(raw)) return '卡密无效或已经兑换，请核对后重试';
  if (/卡密已过期|card[ _-]?expired/i.test(raw)) return '卡密已经过期，请联系客服';
  if (/请先使用用户名和密码登录|account[ _-]?required/i.test(raw)) return '请先使用用户名和密码登录';
  if (/fetch failed|failed to fetch|econnrefused|network/i.test(raw)) return '暂时无法连接秒答服务，请检查网络后重试';
  return raw || '兑换失败，请稍后重试';
}

function timeGreeting(date = new Date()): string {
  const hour = date.getHours();
  if (hour >= 5 && hour < 11) return '早上好';
  if (hour >= 11 && hour < 14) return '中午好';
  if (hour >= 14 && hour < 19) return '下午好';
  return '晚上好';
}

function friendlyServiceError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || '');
  if (/written question quota is exhausted|written[_ -]?quota[_ -]?(?:is[_ -]?)?exhausted|笔试(?:题目)?(?:次数|额度).*(?:不足|用完|耗尽)/i.test(raw)) {
    return '笔试次数已用完，请先兑换卡密';
  }
  if (/\b401\b|unauthori[sz]ed|authorization token|invalid[_ -]?token|token.*(?:invalid|expired|revoked)/i.test(raw)) {
    return '登录状态已失效，请重新登录';
  }
  if (/fetch failed|failed to fetch|ECONNREFUSED|ENOTFOUND|network|timeout/i.test(raw)) {
    return '暂时无法连接秒答服务，请检查网络后重试';
  }
  return raw
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    || '服务暂时不可用，请稍后重试';
}

function formatCardText(text: string) {
  return text.split(/(```[\s\S]*?```)/g).filter(Boolean).map((part, index) => {
    if (part.startsWith('```')) {
      return <pre key={index} className="lite-code-block">{part.replace(/^```[a-zA-Z0-9_-]*\n?/, '').replace(/```$/, '').trim()}</pre>;
    }
    const compact = part
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]*\n+/g, '\n')
      .trim();
    return compact ? <React.Fragment key={index}>{compact}</React.Fragment> : null;
  });
}

function compactAcmCodeBlocks(text: string, language: string): string {
  const isPython = /^python$/i.test(language.trim());
  return String(text || '').replace(/```([^\n`]*)\n([\s\S]*?)```/g, (_match, tag: string, body: string) => {
    const output: string[] = [];
    let inBlockComment = false;
    for (const rawLine of String(body).replace(/\r\n/g, '\n').split('\n')) {
      const trimmed = rawLine.trim();
      if (!trimmed) continue;
      if (inBlockComment) {
        if (trimmed.includes('*/')) inBlockComment = false;
        continue;
      }
      if (!isPython && trimmed.startsWith('/*')) {
        if (!trimmed.includes('*/')) inBlockComment = true;
        continue;
      }
      if ((!isPython && trimmed.startsWith('//')) || (isPython && trimmed.startsWith('#'))) continue;
      output.push(rawLine.replace(/[ \t]+$/g, ''));
    }
    const codeTag = String(tag || language).trim().toLowerCase();
    return `\`\`\`${codeTag}\n${output.join('\n')}\n\`\`\``;
  });
}

function normalizeWrittenResult(result: any, language: string, compactAcm: boolean): {
  question: string;
  answer: string;
  recognitionModel: string;
  answerModel: string;
} {
  const payload = result?.data && typeof result.data === 'object' ? result.data : result;
  const question = String(payload?.questionText || payload?.question || '').trim();
  let answer = String(payload?.answer || payload?.answerText || payload?.solution || '').trim();
  const code = String(payload?.code || payload?.solutionCode || '').trim();

  // Some providers return code separately from the explanation. Preserve it
  // as a visible fenced block instead of rendering an apparently blank answer.
  if (code && !answer.includes(code)) {
    const fencedCode = `\`\`\`${language.toLowerCase()}\n${code}\n\`\`\``;
    answer = answer ? `${fencedCode}\n\n${answer}` : fencedCode;
  }

  if (compactAcm) answer = compactAcmCodeBlocks(answer, language);

  return {
    question,
    answer,
    recognitionModel: String(payload?.recognitionModel || payload?.visionModel || '').trim(),
    answerModel: String(payload?.answerModel || payload?.model || '').trim(),
  };
}

function translationErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || '');
  if (/quota|402|interview_quota_exhausted/i.test(message)) return '面试额度已用完，暂时无法翻译';
  return '翻译暂时不可用，原文不受影响';
}

function InterviewCardContent({ card, compact }: { card: Card; compact: boolean }) {
  const questionClass = compact ? 'assistant-compact-question' : 'lite-question';
  const answerClass = compact
    ? `assistant-compact-answer${card.loading ? ' loading' : ''}`
    : `lite-answer${card.loading ? ' loading' : ''}`;
  const translationClass = compact
    ? 'interview-translation compact'
    : 'interview-translation';
  const pendingTranslationText = '英文答案完成后翻译整段';

  return (
    <>
      <div className={questionClass}>{card.question}</div>
      {(card.questionTranslation || card.questionTranslationLoading || card.questionTranslationError) && (
        <div className={`${translationClass} question`}>
          {card.questionTranslation && <div>{card.questionTranslation}</div>}
          {!card.questionTranslation && card.questionTranslationLoading && <small>正在翻译题目…</small>}
          {card.questionTranslationError && <small className="error">{card.questionTranslationError}</small>}
        </div>
      )}
      <div className={answerClass}>{formatCardText(card.answer)}</div>
      {(card.answerTranslation || card.answerTranslationLoading || card.answerTranslationError) && (
        <div className={`${translationClass} answer`}>
          {card.answerTranslation && <div>{formatCardText(card.answerTranslation)}</div>}
          {!card.answerTranslation && card.answerTranslationLoading && <small>{pendingTranslationText}</small>}
          {card.answerTranslationError && <small className="error">{card.answerTranslationError}</small>}
        </div>
      )}
      {card.loading && (compact ? <small>生成中</small> : <div className="lite-meta">生成中</div>)}
      {!card.loading && card.answerTranslationLoading && (
        compact ? <small>翻译中</small> : <div className="lite-meta">翻译中</div>
      )}
    </>
  );
}

function measureAssistantContentHeight(root: HTMLElement): number {
  const header = root.querySelector<HTMLElement>('.assistant-compact-header');
  const main = root.querySelector<HTMLElement>('.assistant-compact-main');
  const live = root.querySelector<HTMLElement>('.assistant-compact-live');
  const answers = root.querySelector<HTMLElement>('.assistant-compact-answers');
  if (!header || !main || !live || !answers) return Math.ceil(root.scrollHeight);

  const px = (value: string): number => Number.parseFloat(value) || 0;
  const outerHeight = (element: Element): number => {
    const htmlElement = element as HTMLElement;
    const style = window.getComputedStyle(htmlElement);
    return htmlElement.getBoundingClientRect().height + px(style.marginTop) + px(style.marginBottom);
  };
  const answerItems = Array.from(answers.children).filter((item) => (
    item.classList.contains('assistant-compact-answer-card') && !item.classList.contains('live')
  ));
  const currentAnswer = answerItems.at(-1);
  // Size the native window for the newest answer only. Older cards remain in
  // the same overflow container and are reachable by scrolling upward.
  const answersHeight = currentAnswer ? outerHeight(currentAnswer) : 0;
  const liveStyle = window.getComputedStyle(live);
  const mainStyle = window.getComputedStyle(main);
  const fixedRows = Array.from(live.children).filter((child) => child !== answers);
  const fixedHeight = fixedRows.reduce((total, item) => total + outerHeight(item), 0);
  const rowGaps = Math.max(0, live.children.length - 1) * px(liveStyle.rowGap || liveStyle.gap);

  return Math.ceil(
    header.getBoundingClientRect().height
      + px(mainStyle.paddingTop)
      + px(mainStyle.paddingBottom)
      + fixedHeight
      + answersHeight
      + rowGaps
      + 2,
  );
}

function measureInterviewContentHeight(root: HTMLElement): number {
  const header = root.querySelector<HTMLElement>('.assistant-compact-header');
  const main = root.querySelector<HTMLElement>('.assistant-compact-main');
  const live = root.querySelector<HTMLElement>('.assistant-compact-live.interview');
  const answers = root.querySelector<HTMLElement>('.assistant-compact-answers');
  if (!header || !main || !live || !answers) return Math.ceil(root.scrollHeight);

  const px = (value: string): number => Number.parseFloat(value) || 0;
  const outerHeight = (element: Element): number => {
    const htmlElement = element as HTMLElement;
    const style = window.getComputedStyle(htmlElement);
    return htmlElement.getBoundingClientRect().height + px(style.marginTop) + px(style.marginBottom);
  };
  const answerItems = Array.from(answers.children).filter((item) => (
    item.classList.contains('assistant-compact-answer-card') && !item.classList.contains('live')
  ));
  const answersStyle = window.getComputedStyle(answers);
  const answersHeight = answerItems.reduce((total, item) => total + outerHeight(item), 0)
    + Math.max(0, answerItems.length - 1) * px(answersStyle.rowGap || answersStyle.gap);
  const liveStyle = window.getComputedStyle(live);
  const mainStyle = window.getComputedStyle(main);
  const fixedRows = Array.from(live.children).filter((child) => child !== answers);
  const fixedHeight = fixedRows.reduce((total, item) => total + outerHeight(item), 0);
  const rowGaps = Math.max(0, live.children.length - 1) * px(liveStyle.rowGap || liveStyle.gap);

  return Math.ceil(
    header.getBoundingClientRect().height
      + px(mainStyle.paddingTop)
      + px(mainStyle.paddingBottom)
      + fixedHeight
      + answersHeight
      + rowGaps
      + 2,
  );
}

type LiteOverlayProps = {
  standaloneAssistant?: 'interview' | 'written';
};

export default function LiteOverlay({ standaloneAssistant }: LiteOverlayProps = {}) {
  const [authState, setAuthState] = useState<any>(null);
  const [authReady, setAuthReady] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [loginError, setLoginError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [redeemCardKey, setRedeemCardKey] = useState('');
  const [redeemStatus, setRedeemStatus] = useState('');
  const [redeemError, setRedeemError] = useState('');
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [interviewQuotaNoticeOpen, setInterviewQuotaNoticeOpen] = useState(false);
  const [writtenQuotaNoticeOpen, setWrittenQuotaNoticeOpen] = useState(false);
  const [pendingAssistantLaunch, setPendingAssistantLaunch] = useState<'interview' | 'written' | null>(null);
  const [pairing, setPairing] = useState<{ pairId: string; qrUrl: string; code: string; expiresAt: string } | null>(null);
  const [pairingQr, setPairingQr] = useState('');
  const [pairingCopyStatus, setPairingCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const [mobileConnected, setMobileConnected] = useState(false);
  const [pairingError, setPairingError] = useState('');
  const [activePage, setActivePage] = useState<Page>(() => (
    standaloneAssistant === 'interview'
      ? 'interview'
      : standaloneAssistant === 'written'
        ? 'written'
        : 'home'
  ));
  const [isListening, setIsListening] = useState(false);
  const [status, setStatus] = useState('准备就绪');
  const [cards, setCards] = useState<Card[]>([]);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [liveTranscriptHint, setLiveTranscriptHint] = useState('正在识别问题，停顿后自动回答');
  const [liveTranscriptTranslation, setLiveTranscriptTranslation] = useState('');
  const [liveTranscriptTranslationLoading, setLiveTranscriptTranslationLoading] = useState(false);
  const [liveTranscriptTranslationError, setLiveTranscriptTranslationError] = useState('');
  const [manualQuestion, setManualQuestion] = useState('');
  const [manualQuestionOpen, setManualQuestionOpen] = useState(false);
  const [manualQuestionSubmitting, setManualQuestionSubmitting] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<JobCategoryKey>(() => normalizeJobCategory(localStorage.getItem('lite_job_category')));
  const [selectedJob, setSelectedJob] = useState(() => {
    const initialCategory = normalizeJobCategory(localStorage.getItem('lite_job_category'));
    return normalizeJobForCategory(initialCategory, localStorage.getItem('lite_selected_job'));
  });
  const [manualJob, setManualJob] = useState(() => localStorage.getItem('lite_manual_job') || '');
  const [language, setLanguage] = useState<InterviewLanguage>(() => normalizeInterviewLanguage(localStorage.getItem('lite_interview_language')));
  const [translationMode, setTranslationMode] = useState<InterviewTranslationMode>(() => normalizeInterviewTranslationMode(localStorage.getItem('lite_interview_translation_mode')));
  const [resumeText, setResumeText] = useState(() => localStorage.getItem('lite_resume_text') || '');
  const [writtenLanguage, setWrittenLanguage] = useState(() => normalizeWrittenLanguage(localStorage.getItem('lite_written_language')));
  const [writtenSolveMode, setWrittenSolveMode] = useState<WrittenCodeMode>(() => normalizeWrittenSolveMode(localStorage.getItem('lite_written_type')));
  const [writtenStatus, setWrittenStatus] = useState('准备识别题目');
  const [writtenQuestion, setWrittenQuestion] = useState('');
  const [writtenAnswer, setWrittenAnswer] = useState('');
  const [writtenHistory, setWrittenHistory] = useState<WrittenHistoryItem[]>([]);
  const [writtenLoading, setWrittenLoading] = useState(false);
  const [writtenElapsedMs, setWrittenElapsedMs] = useState(0);
  const [privacyMode, setPrivacyMode] = useState(false);
  const [privacyModeChanging, setPrivacyModeChanging] = useState(false);
  const [mousePassthrough, setMousePassthrough] = useState(false);
  const [headerKeybinds, setHeaderKeybinds] = useState<HeaderKeybind[]>([]);
  const [greeting, setGreeting] = useState(() => timeGreeting());
  const [appUpdate, setAppUpdate] = useState<AppUpdateUiState | null>(null);
  const [appUpdateActionPending, setAppUpdateActionPending] = useState(false);
  const [interviewAnswerViewCount, setInterviewAnswerViewCount] = useState<1 | 2>(() => (
    normalizeInterviewAnswerViewCount(localStorage.getItem('lite_interview_answer_view_count'))
  ));

  const silenceTimerRef = useRef<number | null>(null);
  const transcriptFallbackTimerRef = useRef<number | null>(null);
  const questionEvaluationTimerRef = useRef<number | null>(null);
  const lastTranscriptAtRef = useRef(0);
  const nativeSpeechStateRef = useRef<'unknown' | 'speaking' | 'silent'>('unknown');
  const nativeSpeechEndedObservedAtRef = useRef<number | null>(null);
  const nativeAudioEndedAtRef = useRef<number | undefined>(undefined);
  const interviewTurnCoordinatorRef = useRef(new InterviewTurnCoordinator());
  const autoAnswerRef = useRef<(turnId: string, question: string, audioEndedAt?: number, turnCreatedAt?: number) => void>(() => undefined);
  const reviseAutoTurnRef = useRef<(turn: AutoQuestionTurn) => void>(() => undefined);
  const answeredAutoTurnIdsRef = useRef<Set<string>>(new Set());
  const answerCancellationRef = useRef(0);
  const interviewModelFamilyRef = useRef<InterviewModelFamily>('deepseek');
  const listeningRef = useRef(false);
  const turnsRef = useRef<Turn[]>([]);
  const answersRef = useRef<HTMLDivElement>(null);
  const writtenAnswersRef = useRef<HTMLDivElement>(null);
  const interviewScrollIndexRef = useRef<number | null>(null);
  const assistantRootRef = useRef<HTMLDivElement>(null);
  const manualQuestionInputRef = useRef<HTMLTextAreaElement>(null);
  const recentAutoQuestionsRef = useRef<Array<{ question: string; timestamp: number }>>([]);
  const lastCommittedAutoQuestionRef = useRef<{ turnId: string; question: string; cardId: string; timestamp: number } | null>(null);
  const autoTurnCardsRef = useRef<Map<string, AutoTurnCardRecord>>(new Map());
  const standaloneInterviewStartedRef = useRef(false);
  const writtenStartedAtRef = useRef<number | null>(null);
  const initialWrittenActionHandledRef = useRef(false);
  const pendingTranscriptSyncRef = useRef<PendingTranscriptSync | null>(null);
  const pendingAnswerSyncRef = useRef<Map<string, PendingAnswerSync>>(new Map());
  const liveQuestionTranslationRef = useRef<{ source: string; translation: string }>({ source: '', translation: '' });
  const liveQuestionTranslationGenerationRef = useRef(0);
  const questionTranslationCacheRef = useRef<Map<string, TranslationResult>>(new Map());
  const questionTranslationPromisesRef = useRef<Map<string, Promise<TranslationResult>>>(new Map());

  const category = JOB_CATEGORIES.find((item) => item.key === selectedCategory) || JOB_CATEGORIES[0];
  const activeJob = normalizeText(manualJob) || selectedJob || category.jobs[0];
  const activeJobContext = `领域：${category.label}；岗位：${activeJob}`;
  const hasValidAuth = Boolean(authState?.isAuthenticated && !authState?.connectionError);
  const responseLanguage = LANGUAGES[language].response;
  const interviewTranslationActive = shouldTranslateInterview(responseLanguage, translationMode);
  const activeTranslationMode: InterviewTranslationMode = interviewTranslationActive ? translationMode : 'off';
  const visibleInterviewCards = useMemo(
    () => cards.slice(-interviewAnswerViewCount),
    [cards, interviewAnswerViewCount],
  );

  useEffect(() => {
    if (standaloneAssistant) return undefined;
    let mounted = true;
    const acceptState = (next: AppUpdateUiState) => {
      if (mounted && next && typeof next.status === 'string') setAppUpdate(next);
    };
    const unsubscribe = window.electronAPI.onAppUpdateState?.(acceptState);
    void window.electronAPI.getAppUpdateState?.()
      .then(acceptState)
      .catch(() => undefined);
    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, [standaloneAssistant]);

  const appUpdateVisible = !standaloneAssistant
    && Boolean(appUpdate?.version)
    && (appUpdate?.status === 'available' || appUpdate?.status === 'downloading' || appUpdate?.status === 'downloaded');
  const appUpdateLabel = appUpdate?.status === 'downloading'
    ? `正在下载 ${Math.round(appUpdate.percent || 0)}%`
    : appUpdate?.status === 'downloaded'
      ? '重启并安装'
      : appUpdate?.error
        ? '下载失败 · 重试'
        : `发现新版本 v${appUpdate?.version || ''}`;

  const handleAppUpdate = useCallback(async () => {
    if (!appUpdate || appUpdateActionPending || appUpdate.status === 'downloading') return;
    setAppUpdateActionPending(true);
    try {
      if (appUpdate.status === 'downloaded') {
        const result = await window.electronAPI.restartAndInstall?.();
        if (result && result.success === false) {
          setAppUpdate((current) => current ? { ...current, error: result.error || '安装失败，请重试' } : current);
        }
        return;
      }

      setAppUpdate((current) => current ? { ...current, status: 'downloading', percent: 0, error: undefined } : current);
      const result = await window.electronAPI.downloadUpdate?.();
      if (result && result.success === false) {
        setAppUpdate((current) => current ? { ...current, status: 'available', error: result.error || '下载失败，请重试' } : current);
      }
    } catch (error) {
      setAppUpdate((current) => current ? {
        ...current,
        status: current.status === 'downloaded' ? 'downloaded' : 'available',
        error: error instanceof Error ? error.message : '更新失败，请重试',
      } : current);
    } finally {
      setAppUpdateActionPending(false);
    }
  }, [appUpdate, appUpdateActionPending]);

  const sendCompanionSync = useCallback(async (type: string, payload: Record<string, unknown>, requestId?: string) => {
    try {
      return await window.electronAPI.miaodaCompanionSend?.(type, payload, requestId);
    } catch (error) {
      console.warn(`[MiaodaCompanion] failed to send ${type}`, error);
      return undefined;
    }
  }, []);

  const flushTranscriptSync = useCallback(async () => {
    const pending = pendingTranscriptSyncRef.current;
    if (!pending) return;
    pendingTranscriptSyncRef.current = null;
    if (pending.timer !== null) window.clearTimeout(pending.timer);
    await sendCompanionSync(pending.type, { text: pending.text });
  }, [sendCompanionSync]);

  const queueTranscriptSync = useCallback((type: PendingTranscriptSync['type'], text: string) => {
    const current = pendingTranscriptSyncRef.current;
    if (current) {
      current.type = type;
      current.text = text;
      return;
    }
    const pending: PendingTranscriptSync = { type, text, timer: null };
    pending.timer = window.setTimeout(() => { void flushTranscriptSync(); }, COMPANION_CONTENT_SYNC_INTERVAL_MS);
    pendingTranscriptSyncRef.current = pending;
  }, [flushTranscriptSync]);

  const flushAnswerSync = useCallback(async (key: string) => {
    const pending = pendingAnswerSyncRef.current.get(key);
    if (!pending) return;
    pendingAnswerSyncRef.current.delete(key);
    if (pending.timer !== null) window.clearTimeout(pending.timer);
    if (pending.token) await sendCompanionSync('answer.token', { token: pending.token }, pending.requestId);
  }, [sendCompanionSync]);

  const queueAnswerSync = useCallback((key: string, token: string, requestId?: string) => {
    const current = pendingAnswerSyncRef.current.get(key);
    if (current) {
      current.token += token;
      return;
    }
    const pending: PendingAnswerSync = { token, requestId, timer: null };
    pending.timer = window.setTimeout(() => { void flushAnswerSync(key); }, COMPANION_CONTENT_SYNC_INTERVAL_MS);
    pendingAnswerSyncRef.current.set(key, pending);
  }, [flushAnswerSync]);

  const discardAnswerSync = useCallback((key: string) => {
    const pending = pendingAnswerSyncRef.current.get(key);
    if (pending?.timer !== null && pending?.timer !== undefined) window.clearTimeout(pending.timer);
    pendingAnswerSyncRef.current.delete(key);
  }, []);

  const streamTranslation = useCallback(async (
    text: string,
    sourceLanguage: string,
    onProgress?: (translation: string) => void,
  ): Promise<TranslationResult> => {
    if (!window.electronAPI.miaodaInterviewTranslateStream) {
      throw new Error('当前客户端不支持翻译，请更新后重试');
    }
    let streamed = '';
    const result = await window.electronAPI.miaodaInterviewTranslateStream(
      { text, sourceLanguage },
      (token) => {
        streamed += token;
        onProgress?.(streamed);
      },
    );
    const translation = String(result?.translation || streamed).trim();
    if (!translation) throw new Error('翻译服务返回了空内容');
    if (translation !== streamed) onProgress?.(translation);
    return { translation, model: result?.model };
  }, []);

  const requestQuestionTranslation = useCallback((
    text: string,
    onProgress?: (translation: string) => void,
  ): Promise<TranslationResult> => {
    const normalized = normalizeText(text);
    const key = `${responseLanguage}\n${normalized}`;
    const cached = questionTranslationCacheRef.current.get(key);
    if (cached) {
      onProgress?.(cached.translation);
      return Promise.resolve(cached);
    }
    const pending = questionTranslationPromisesRef.current.get(key);
    if (pending) return pending;

    const request = streamTranslation(normalized, responseLanguage, onProgress)
      .then((result) => {
        questionTranslationCacheRef.current.set(key, result);
        return result;
      })
      .finally(() => {
        questionTranslationPromisesRef.current.delete(key);
      });
    questionTranslationPromisesRef.current.set(key, request);
    return request;
  }, [responseLanguage, streamTranslation]);

  const translateQuestionPreview = useCallback((text: string) => {
    const normalized = normalizeText(text);
    if (!interviewTranslationActive || !normalized) return;
    if (liveQuestionTranslationRef.current.source === normalized && (
      liveQuestionTranslationRef.current.translation || liveTranscriptTranslationLoading
    )) return;

    const generation = liveQuestionTranslationGenerationRef.current + 1;
    liveQuestionTranslationGenerationRef.current = generation;
    liveQuestionTranslationRef.current = { source: normalized, translation: '' };
    setLiveTranscriptTranslation('');
    setLiveTranscriptTranslationError('');
    setLiveTranscriptTranslationLoading(true);
    void requestQuestionTranslation(normalized, (translation) => {
      if (generation !== liveQuestionTranslationGenerationRef.current) return;
      liveQuestionTranslationRef.current = { source: normalized, translation };
      setLiveTranscriptTranslation(translation);
    }).then((result) => {
      if (generation !== liveQuestionTranslationGenerationRef.current) return;
      liveQuestionTranslationRef.current = { source: normalized, translation: result.translation };
      setLiveTranscriptTranslation(result.translation);
      setLiveTranscriptTranslationLoading(false);
    }).catch((error) => {
      if (generation !== liveQuestionTranslationGenerationRef.current) return;
      setLiveTranscriptTranslationLoading(false);
      setLiveTranscriptTranslationError(translationErrorMessage(error));
    });
  }, [interviewTranslationActive, liveTranscriptTranslationLoading, requestQuestionTranslation]);

  const changeInterviewTranslationMode = useCallback((value: unknown) => {
    const nextMode = normalizeInterviewTranslationMode(value);
    setTranslationMode(nextMode);
    localStorage.setItem('lite_interview_translation_mode', nextMode);
    if (nextMode === 'off') {
      liveQuestionTranslationGenerationRef.current += 1;
      liveQuestionTranslationRef.current = { source: '', translation: '' };
      setLiveTranscriptTranslation('');
      setLiveTranscriptTranslationLoading(false);
      setLiveTranscriptTranslationError('');
    }
  }, []);

  useEffect(() => {
    if (interviewTranslationActive) return;
    liveQuestionTranslationGenerationRef.current += 1;
    liveQuestionTranslationRef.current = { source: '', translation: '' };
    setLiveTranscriptTranslation('');
    setLiveTranscriptTranslationLoading(false);
    setLiveTranscriptTranslationError('');
  }, [interviewTranslationActive]);

  useEffect(() => () => {
    if (questionEvaluationTimerRef.current !== null) window.clearTimeout(questionEvaluationTimerRef.current);
    questionEvaluationTimerRef.current = null;
    const transcript = pendingTranscriptSyncRef.current;
    if (transcript?.timer !== null && transcript?.timer !== undefined) window.clearTimeout(transcript.timer);
    pendingTranscriptSyncRef.current = null;
    for (const pending of pendingAnswerSyncRef.current.values()) {
      if (pending.timer !== null) window.clearTimeout(pending.timer);
    }
    pendingAnswerSyncRef.current.clear();
  }, []);

  const changeWrittenLanguage = useCallback((value: unknown, notifyMobile = true) => {
    const nextLanguage = normalizeWrittenLanguage(value);
    setWrittenLanguage(nextLanguage);
    localStorage.setItem('lite_written_language', nextLanguage);
    if (notifyMobile) {
      void window.electronAPI.miaodaCompanionSend?.('written.language.changed', { language: nextLanguage }).catch(() => undefined);
    }
  }, []);

  const changeWrittenSolveMode = useCallback((value: unknown, notifyMobile = true) => {
    const nextMode = normalizeWrittenSolveMode(value);
    setWrittenSolveMode(nextMode);
    localStorage.setItem('lite_written_type', nextMode);
    if (notifyMobile) {
      void window.electronAPI.miaodaCompanionSend?.('written.mode.changed', { mode: nextMode }).catch(() => undefined);
    }
  }, []);

  const scrollDesktopAssistant = useCallback((mode: AssistantScrollMode, direction: 'up' | 'down') => {
    const container = mode === 'interview' ? answersRef.current : writtenAnswersRef.current;
    if (!container) return;

    if (mode === 'written') {
      const amount = Math.max(80, Math.round(container.clientHeight * 0.5));
      container.scrollBy({ top: direction === 'up' ? -amount : amount, behavior: 'auto' });
      return;
    }

    const answerBlocks = Array.from(container.querySelectorAll<HTMLElement>('.assistant-compact-answer-card:not(.live) .assistant-compact-answer, .lite-card:not(.lite-question-stream) .lite-answer'));
    if (!answerBlocks.length) return;
    const currentIndex = interviewScrollIndexRef.current ?? answerBlocks.length - 1;
    const targetIndex = Math.max(0, Math.min(answerBlocks.length - 1, currentIndex + (direction === 'up' ? -1 : 1)));
    const target = answerBlocks[targetIndex];
    const containerTop = container.getBoundingClientRect().top;
    const targetTop = container.scrollTop + target.getBoundingClientRect().top - containerTop;
    interviewScrollIndexRef.current = targetIndex;
    container.scrollTo({ top: targetTop, behavior: 'auto' });
  }, []);

  const commitPendingQuestion = useCallback((audioEndedAt?: number, requestedTurnId?: string) => {
    if (silenceTimerRef.current) window.clearTimeout(silenceTimerRef.current);
    if (transcriptFallbackTimerRef.current) window.clearTimeout(transcriptFallbackTimerRef.current);
    if (questionEvaluationTimerRef.current) window.clearTimeout(questionEvaluationTimerRef.current);
    silenceTimerRef.current = null;
    transcriptFallbackTimerRef.current = null;
    questionEvaluationTimerRef.current = null;

    const coordinator = interviewTurnCoordinatorRef.current;
    const turn = requestedTurnId ? coordinator.get(requestedTurnId) : coordinator.current();
    if (!turn || turn.state === 'launched') return;
    if (!turn.question) {
      coordinator.markIgnored(turn.id);
      setLiveTranscript('');
      return;
    }

    const ignoreTurn = (latestTurn: AutoQuestionTurn, reason: string) => {
      coordinator.markIgnored(latestTurn.id);
      const pendingTranscript = pendingTranscriptSyncRef.current;
      if (pendingTranscript?.timer !== null && pendingTranscript?.timer !== undefined) {
        window.clearTimeout(pendingTranscript.timer);
      }
      pendingTranscriptSyncRef.current = null;
      void sendCompanionSync('transcript.final', { text: '' });
      console.info('[MiaodaQuestionGate]', JSON.stringify({
        turnId: latestTurn.id,
        decision: 'ignore',
        reason,
        length: Array.from(latestTurn.question).length,
      }));
      setLiveTranscriptHint('已忽略非提问语句，继续监听');
      window.setTimeout(() => {
        const current = coordinator.current();
        if (current?.id === latestTurn.id && current.state === 'ignored') setLiveTranscript('');
      }, 1_200);
    };

    const scheduleEvaluation = (delay: number, settled: boolean) => {
      if (!coordinator.markSettling(turn.id)) return;
      questionEvaluationTimerRef.current = window.setTimeout(() => {
        questionEvaluationTimerRef.current = null;
        const latestTurn = coordinator.get(turn.id);
        if (!latestTurn || latestTurn.state === 'launched') return;
        const gate = classifyInterviewQuestion(latestTurn.question, { settled });
        if (gate.decision === 'answer') {
          if (!coordinator.markLaunched(latestTurn.id)) return;
          console.info('[MiaodaQuestionGate]', JSON.stringify({
            turnId: latestTurn.id,
            decision: 'answer',
            reason: gate.reason,
            length: Array.from(latestTurn.question).length,
          }));
          setLiveTranscript('');
          autoAnswerRef.current(
            latestTurn.id,
            latestTurn.question,
            latestTurn.audioEndedAt ?? audioEndedAt,
            latestTurn.createdAt,
          );
          return;
        }
        if (gate.decision === 'defer' && !settled) {
          setLiveTranscriptHint('提问尚未完整，继续等待后半句');
          scheduleEvaluation(INCOMPLETE_QUESTION_SETTLE_MS, true);
          return;
        }
        ignoreTurn(latestTurn, gate.reason);
      }, delay);
    };

    const gate = classifyInterviewQuestion(turn.question);
    if (gate.decision === 'answer') {
      setLiveTranscriptHint('问题已完整，正在确认最终转写');
      scheduleEvaluation(COMPLETE_QUESTION_STABILITY_MS, false);
    } else if (gate.decision === 'defer') {
      setLiveTranscriptHint('提问尚未完整，继续等待后半句');
      scheduleEvaluation(INCOMPLETE_QUESTION_SETTLE_MS, true);
    } else {
      ignoreTurn(turn, gate.reason);
    }
  }, [sendCompanionSync]);

  useEffect(() => {
    localStorage.setItem('lite_interview_answer_view_count', String(interviewAnswerViewCount));
  }, [interviewAnswerViewCount]);

  useEffect(() => {
    if (standaloneAssistant !== 'interview' || activePage !== 'interview') return;
    // Keep the native frame stable while tokens or translations are still
    // arriving. Once the visible cards settle, fit the window to exactly the
    // latest one or two cards selected by the user.
    const hasPendingVisibleCard = visibleInterviewCards.some((card) => (
      card.loading || card.questionTranslationLoading || card.answerTranslationLoading
    ));
    if (liveTranscript || liveTranscriptTranslationLoading || hasPendingVisibleCard) return;

    const timer = window.setTimeout(() => {
      const root = assistantRootRef.current;
      const measuredHeight = root && visibleInterviewCards.length
        ? measureInterviewContentHeight(root)
        : INTERVIEW_IDLE_HEIGHT;
      const height = Math.max(INTERVIEW_IDLE_HEIGHT, measuredHeight);
      void window.electronAPI.resizeAssistantWindow?.(height).catch(() => undefined);
    }, 80);
    return () => window.clearTimeout(timer);
  }, [
    activePage,
    liveTranscript,
    liveTranscriptTranslationLoading,
    manualQuestionOpen,
    standaloneAssistant,
    visibleInterviewCards,
  ]);

  useEffect(() => {
    // The written assistant fits itself to the newest completed answer. The
    // interview assistant uses its separate visible-card measurement above.
    if (standaloneAssistant !== 'written' || activePage !== 'written') return;
    if (!writtenAnswer || writtenLoading) return;
    const timer = window.setTimeout(() => {
      const root = assistantRootRef.current;
      if (!root) return;
      const height = measureAssistantContentHeight(root);
      void window.electronAPI.resizeAssistantWindow?.(height).catch(() => undefined);
    }, 60);
    return () => window.clearTimeout(timer);
  }, [
    activePage,
    standaloneAssistant,
    writtenAnswer,
    writtenLoading,
  ]);

  useEffect(() => {
    if (!manualQuestionOpen) return;
    const timer = window.setTimeout(() => manualQuestionInputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [manualQuestionOpen]);

  useEffect(() => {
    void window.electronAPI.getUndetectable?.()
      .then((enabled) => setPrivacyMode(Boolean(enabled)))
      .catch(() => undefined);

    const unsubscribe = window.electronAPI.onUndetectableChanged?.((enabled) => {
      setPrivacyMode(Boolean(enabled));
    });
    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    void window.electronAPI.getOverlayMousePassthrough?.()
      .then((enabled) => setMousePassthrough(Boolean(enabled)))
      .catch(() => undefined);
    void window.electronAPI.getKeybinds?.()
      .then((items) => setHeaderKeybinds(items || []))
      .catch(() => undefined);

    const unsubscribePassthrough = window.electronAPI.onOverlayMousePassthroughChanged?.((enabled) => {
      setMousePassthrough(Boolean(enabled));
    });
    const unsubscribeKeybinds = window.electronAPI.onKeybindsUpdate?.((items) => {
      setHeaderKeybinds(items || []);
    });
    return () => {
      unsubscribePassthrough?.();
      unsubscribeKeybinds?.();
    };
  }, []);

  const togglePrivacyMode = useCallback(async () => {
    if (privacyModeChanging) return;
    setPrivacyModeChanging(true);
    try {
      const next = !privacyMode;
      const result = await window.electronAPI.setUndetectable?.(next);
      setPrivacyMode(result?.state ?? next);
    } finally {
      setPrivacyModeChanging(false);
    }
  }, [privacyMode, privacyModeChanging]);

  const toggleMousePassthrough = useCallback(async () => {
    const next = !mousePassthrough;
    await window.electronAPI.setOverlayMousePassthrough?.(next);
    setMousePassthrough(next);
  }, [mousePassthrough]);

  const showWrittenQuotaNotice = useCallback(() => {
    setWrittenStatus('笔试次数不足');
    setWrittenQuotaNoticeOpen(true);
  }, []);

  const showInterviewQuotaNotice = useCallback(() => {
    setStatus('面试时间不足');
    setInterviewQuotaNoticeOpen(true);
  }, []);

  const refreshQuotaState = useCallback(async (knownState?: any) => {
    let state = knownState;
    if (!state) state = await window.electronAPI.miaodaAuthGetState?.();
    if (!state?.isAuthenticated) return state;
    const quota = await window.electronAPI.miaodaAuthGetQuota?.();
    const next = quota ? { ...state, quota } : state;
    setAuthState(next || null);
    return next;
  }, []);

  const ensureInterviewQuota = useCallback(async (knownState?: any): Promise<boolean> => {
    let state: any;
    try {
      state = await refreshQuotaState(knownState);
    } catch {
      state = knownState || authState;
    }
    const remaining = Number(state?.quota?.remainingInterviewSeconds);
    if (state?.isAuthenticated && Number.isFinite(remaining) && remaining <= 0) {
      showInterviewQuotaNotice();
      return false;
    }
    return true;
  }, [authState, refreshQuotaState, showInterviewQuotaNotice]);

  const ensureWrittenQuota = useCallback(async (knownState?: any): Promise<boolean> => {
    let state: any;
    try {
      state = await refreshQuotaState(knownState);
    } catch {
      state = knownState || authState;
    }
    const remaining = Number(state?.quota?.remainingWrittenQuestions);
    if (state?.isAuthenticated && Number.isFinite(remaining) && remaining <= 0) {
      showWrittenQuotaNotice();
      return false;
    }
    return true;
  }, [authState, refreshQuotaState, showWrittenQuotaNotice]);

  const openAssistant = useCallback(async (kind: 'interview' | 'written') => {
    if (kind === 'interview' && !(await ensureInterviewQuota())) return;
    if (kind === 'written' && !(await ensureWrittenQuota())) return;
    if (standaloneAssistant === kind) {
      setActivePage(kind === 'interview' ? 'interview' : 'written');
      return;
    }
    await window.electronAPI.openAssistantWindow?.(kind);
  }, [ensureInterviewQuota, ensureWrittenQuota, standaloneAssistant]);

  const refreshAuth = useCallback(async () => {
    const state = await refreshQuotaState();
    setAuthState(state || null);
    if (state?.username) setUsername(state.username);
    setPairingError(state?.connectionError || '');
    return state;
  }, [refreshQuotaState]);

  useEffect(() => {
    let cancelled = false;
    void refreshAuth()
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setAuthReady(true);
      });
    return () => { cancelled = true; };
  }, [refreshAuth]);

  useEffect(() => window.electronAPI.onMiaodaQuotaChanged?.((quota) => {
    setAuthState((current: any) => current?.isAuthenticated ? { ...current, quota } : current);
  }), []);

  useEffect(() => { listeningRef.current = isListening; }, [isListening]);

  useEffect(() => {
    const timer = window.setInterval(() => setGreeting(timeGreeting()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const element = answersRef.current;
    // Streaming can update several times per second. Restarting a smooth
    // animation for every token makes the answer appear to bounce vertically.
    if (element) element.scrollTo({ top: element.scrollHeight, behavior: 'auto' });
  }, [cards, liveTranscript]);

  useEffect(() => {
    interviewScrollIndexRef.current = cards.length ? cards.length - 1 : null;
  }, [cards.length]);

  useEffect(() => {
    const element = writtenAnswersRef.current;
    if (!element || !writtenHistory.length) return;
    const frame = window.requestAnimationFrame(() => {
      element.scrollTo({ top: element.scrollHeight, behavior: 'auto' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [writtenHistory.length]);

  useEffect(() => {
    const removeStatus = window.electronAPI?.onSttStatusChanged?.((next) => {
      if (next.state === 'connected' || next.state === 'awaiting-audio') setStatus('监听中');
      if (next.state === 'reconnecting') setStatus('音频识别正在重连');
      if (next.state === 'failed') setStatus(`音频识别失败：${friendlyServiceError(next.error || '请检查后端 ASR 配置')}`);
    });
    const removeAudioError = window.electronAPI?.onMeetingAudioError?.((message) => {
      setStatus(`音频启动失败：${friendlyServiceError(message)}`);
    });
    return () => {
      removeStatus?.();
      removeAudioError?.();
    };
  }, []);

  useEffect(() => {
    return window.electronAPI?.onNativeAudioTranscript?.((transcript) => {
      if (!listeningRef.current) return;
      // Only system/interviewer audio is a question source. Microphone audio can
      // contain speaker echo and must not trigger a second answer.
      if (transcript.speaker && transcript.speaker !== 'interviewer') return;
      const text = normalizeText(transcript.text || '');
      if (!text) return;
      const now = performance.now();
      lastTranscriptAtRef.current = now;
      setLiveTranscriptHint('正在识别问题，停顿后自动回答');
      const final = Boolean(transcript.final || transcript.speechEnded);
      const currentTurn = interviewTurnCoordinatorRef.current.current();
      const lastCommitted = lastCommittedAutoQuestionRef.current;
      const preferredRevisionTurnId = lastCommitted
        && currentTurn
        && currentTurn.id !== lastCommitted.turnId
        && !currentTurn.question
        && Date.now() - lastCommitted.timestamp < 5_000
        && isRepeatedQuestionTail(lastCommitted.question, text)
        ? lastCommitted.turnId
        : undefined;
      const application = interviewTurnCoordinatorRef.current.applyTranscript(
        { segmentId: transcript.segmentId, text, final },
        now,
        preferredRevisionTurnId,
      );
      const { turn } = application;
      const syncedTranscript = turn.question;

      // A provider may revise an old segment after the next speech burst has
      // already started. Segment ownership routes that revision back to its
      // original card; it must never enter the current turn or start a model.
      if (application.historical || turn.state === 'launched') {
        if (turn.state === 'launched') reviseAutoTurnRef.current(turn);
        return;
      }

      if (questionEvaluationTimerRef.current) {
        window.clearTimeout(questionEvaluationTimerRef.current);
        questionEvaluationTimerRef.current = null;
      }
      setLiveTranscript(syncedTranscript);
      queueTranscriptSync(final ? 'transcript.final' : 'transcript.partial', syncedTranscript);
      if (final && classifyInterviewQuestion(syncedTranscript).decision === 'answer') {
        translateQuestionPreview(syncedTranscript);
      }
      // The native speech-ended edge can precede a slow ASR final. Re-arm the
      // same two-second boundary from its original timestamp; if that boundary
      // already elapsed, commit shortly after this late transcript arrives.
      if (transcriptFallbackTimerRef.current) window.clearTimeout(transcriptFallbackTimerRef.current);
      transcriptFallbackTimerRef.current = null;
      if (nativeSpeechStateRef.current === 'silent') {
        if (silenceTimerRef.current) window.clearTimeout(silenceTimerRef.current);
        const observedAt = nativeSpeechEndedObservedAtRef.current ?? now;
        const remainingConfirmation = Math.max(0, SPEECH_END_CONFIRM_MS - (now - observedAt));
        const delay = Math.max(LATE_TRANSCRIPT_SETTLE_MS, remainingConfirmation);
        const audioEndedAt = nativeAudioEndedAtRef.current ?? Math.max(0, now - NATIVE_VAD_HANGOVER_MS);
        turn.audioEndedAt = audioEndedAt;
        setLiveTranscriptHint('检测到停顿，正在等待最终转写');
        silenceTimerRef.current = window.setTimeout(() => {
          commitPendingQuestion(audioEndedAt, turn.id);
        }, delay);
      } else if (nativeSpeechStateRef.current === 'unknown') {
        // Safety net for platforms where native VAD callbacks are unavailable.
        transcriptFallbackTimerRef.current = window.setTimeout(() => {
          commitPendingQuestion(lastTranscriptAtRef.current || performance.now(), turn.id);
        }, TRANSCRIPT_FALLBACK_MS);
      }
    }) || (() => undefined);
  }, [commitPendingQuestion, queueTranscriptSync, translateQuestionPreview]);

  useEffect(() => {
    const removeStarted = window.electronAPI?.onNativeAudioSpeechStarted?.((event) => {
      if (event.speaker && event.speaker !== 'interviewer') return;
      const now = performance.now();
      const { continued } = interviewTurnCoordinatorRef.current.speechStarted(now);
      nativeSpeechStateRef.current = 'speaking';
      nativeSpeechEndedObservedAtRef.current = null;
      nativeAudioEndedAtRef.current = undefined;
      if (silenceTimerRef.current) window.clearTimeout(silenceTimerRef.current);
      if (transcriptFallbackTimerRef.current) window.clearTimeout(transcriptFallbackTimerRef.current);
      if (questionEvaluationTimerRef.current) window.clearTimeout(questionEvaluationTimerRef.current);
      silenceTimerRef.current = null;
      transcriptFallbackTimerRef.current = null;
      questionEvaluationTimerRef.current = null;
      if (!continued) {
        setLiveTranscript('');
        liveQuestionTranslationGenerationRef.current += 1;
        liveQuestionTranslationRef.current = { source: '', translation: '' };
        setLiveTranscriptTranslation('');
        setLiveTranscriptTranslationLoading(false);
        setLiveTranscriptTranslationError('');
      }
      setLiveTranscriptHint('正在识别问题，等待完整提问');
    });
    const removeEnded = window.electronAPI?.onNativeAudioSpeechEnded?.((event) => {
      if (event.speaker && event.speaker !== 'interviewer') return;
      nativeSpeechStateRef.current = 'silent';
      if (silenceTimerRef.current) window.clearTimeout(silenceTimerRef.current);
      if (transcriptFallbackTimerRef.current) window.clearTimeout(transcriptFallbackTimerRef.current);
      transcriptFallbackTimerRef.current = null;
      const observedAt = performance.now();
      const audioEndedAt = Math.max(0, observedAt - NATIVE_VAD_HANGOVER_MS);
      nativeSpeechEndedObservedAtRef.current = observedAt;
      nativeAudioEndedAtRef.current = audioEndedAt;
      const turn = interviewTurnCoordinatorRef.current.speechEnded(observedAt, audioEndedAt);
      setLiveTranscriptHint('检测到停顿，确认问题是否结束');
      silenceTimerRef.current = window.setTimeout(() => {
        commitPendingQuestion(audioEndedAt, turn.id);
      }, SPEECH_END_CONFIRM_MS);
    });
    return () => {
      removeStarted?.();
      removeEnded?.();
    };
  }, [commitPendingQuestion]);

  const appendCard = useCallback((
    question: string | undefined,
    answer: string,
    meta?: string,
    loading = false,
    extra: Partial<Card> = {},
  ) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setCards((current) => [...current, { id, question, answer, meta, loading, ...extra }]);
    return id;
  }, []);

  const updateCard = useCallback((id: string, patch: Partial<Card>) => {
    setCards((current) => current.map((card) => card.id === id ? { ...card, ...patch } : card));
  }, []);

  const updateCardForQuestion = useCallback((id: string, expectedQuestion: string, patch: Partial<Card>) => {
    setCards((current) => current.map((card) => (
      card.id === id && card.question === expectedQuestion ? { ...card, ...patch } : card
    )));
  }, []);

  const mergeRepeatedTailIntoLastQuestion = useCallback((question: string) => {
    const lastCommitted = lastCommittedAutoQuestionRef.current;
    if (!lastCommitted) return;
    const mergedQuestion = mergeRepeatedQuestion(lastCommitted.question, question);
    lastCommittedAutoQuestionRef.current = { ...lastCommitted, question: mergedQuestion };
    autoTurnCardsRef.current.set(lastCommitted.turnId, {
      cardId: lastCommitted.cardId,
      question: mergedQuestion,
      timestamp: lastCommitted.timestamp,
    });
    const coordinatedTurn = interviewTurnCoordinatorRef.current.get(lastCommitted.turnId);
    if (coordinatedTurn) coordinatedTurn.question = mergedQuestion;
    turnsRef.current = turnsRef.current.map((turn) => (
      turn.id === lastCommitted.turnId ? { ...turn, question: mergedQuestion } : turn
    ));
    recentAutoQuestionsRef.current = recentAutoQuestionsRef.current.map((item) =>
      item.question === lastCommitted.question ? { question: mergedQuestion, timestamp: item.timestamp } : item,
    );
    updateCard(lastCommitted.cardId, {
      question: mergedQuestion,
      ...(interviewTranslationActive ? {
        questionTranslation: '',
        questionTranslationLoading: true,
        questionTranslationError: '',
      } : {}),
    });
    if (interviewTranslationActive) {
      void requestQuestionTranslation(mergedQuestion, (translation) => {
        updateCardForQuestion(lastCommitted.cardId, mergedQuestion, { questionTranslation: translation });
      }).then((result) => {
        updateCardForQuestion(lastCommitted.cardId, mergedQuestion, {
          questionTranslation: result.translation,
          questionTranslationLoading: false,
        });
      }).catch((error) => {
        updateCardForQuestion(lastCommitted.cardId, mergedQuestion, {
          questionTranslationLoading: false,
          questionTranslationError: translationErrorMessage(error),
        });
      });
    }
    setStatus('尾句已合并到上一问题');
    console.info('[MiaodaQuestionMerge]', JSON.stringify({ previous: lastCommitted.question, fragment: question, merged: mergedQuestion }));
  }, [interviewTranslationActive, requestQuestionTranslation, updateCard, updateCardForQuestion]);

  const reviseAutoTurnQuestion = useCallback((turn: AutoQuestionTurn) => {
    const record = autoTurnCardsRef.current.get(turn.id);
    const revisedQuestion = normalizeText(turn.question);
    if (!record || !revisedQuestion || record.question === revisedQuestion) return;
    const previousQuestion = record.question;
    const cardId = turn.cardId || record.cardId;
    autoTurnCardsRef.current.set(turn.id, { ...record, question: revisedQuestion, cardId });
    const lastCommitted = lastCommittedAutoQuestionRef.current;
    if (lastCommitted?.turnId === turn.id) {
      lastCommittedAutoQuestionRef.current = { ...lastCommitted, question: revisedQuestion, cardId };
    }
    turnsRef.current = turnsRef.current.map((contextTurn) => (
      contextTurn.id === turn.id ? { ...contextTurn, question: revisedQuestion } : contextTurn
    ));
    recentAutoQuestionsRef.current = recentAutoQuestionsRef.current.map((item) => (
      item.question === previousQuestion ? { ...item, question: revisedQuestion } : item
    ));
    updateCard(cardId, {
      question: revisedQuestion,
      ...(interviewTranslationActive ? {
        questionTranslation: '',
        questionTranslationLoading: true,
        questionTranslationError: '',
      } : {}),
    });
    if (interviewTranslationActive) {
      void requestQuestionTranslation(revisedQuestion, (translation) => {
        updateCardForQuestion(cardId, revisedQuestion, { questionTranslation: translation });
      }).then((result) => {
        updateCardForQuestion(cardId, revisedQuestion, {
          questionTranslation: result.translation,
          questionTranslationLoading: false,
        });
      }).catch((error) => {
        updateCardForQuestion(cardId, revisedQuestion, {
          questionTranslationLoading: false,
          questionTranslationError: translationErrorMessage(error),
        });
      });
    }
    console.info('[MiaodaTurnRevision]', JSON.stringify({
      turnId: turn.id,
      previousLength: Array.from(previousQuestion).length,
      revisedLength: Array.from(revisedQuestion).length,
    }));
  }, [interviewTranslationActive, requestQuestionTranslation, updateCard, updateCardForQuestion]);

  reviseAutoTurnRef.current = reviseAutoTurnQuestion;

  const rememberTurn = useCallback((id: string, question: string, answer: string, ts: number) => {
    turnsRef.current = [
      ...turnsRef.current.filter((turn) => turn.id !== id),
      { id, question, answer, ts },
    ]
      .sort((left, right) => left.ts - right.ts)
      .slice(-INTERVIEW_CONTEXT_TURN_LIMIT);
  }, []);

  const answerQuestion = useCallback(async (
    rawQuestion: string,
    source: 'auto' | 'manual',
    companionRequestId?: string,
    audioEndedAt?: number,
    autoTurnId?: string,
    turnCreatedAt?: number,
  ) => {
    const question = normalizeText(rawQuestion);
    if (!question) return;
    const logicalTurnId = autoTurnId || companionRequestId || `${source}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const pipelineId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
    const syncRequestId = companionRequestId || logicalTurnId;
    const timingOrigin = audioEndedAt ?? performance.now();
    if (source === 'auto') {
      if (answeredAutoTurnIdsRef.current.has(logicalTurnId)) {
        console.warn('[MiaodaTurnGuard] duplicate local turn blocked', logicalTurnId);
        return;
      }
      const now = Date.now();
      const lastCommitted = lastCommittedAutoQuestionRef.current;
      if (
        lastCommitted &&
        now - lastCommitted.timestamp < REPEATED_QUESTION_TAIL_GUARD_MS &&
        isRepeatedQuestionTail(lastCommitted.question, question)
      ) {
        answeredAutoTurnIdsRef.current.add(logicalTurnId);
        mergeRepeatedTailIntoLastQuestion(question);
        setLiveTranscript('');
        return;
      }
      const recent = recentAutoQuestionsRef.current.filter((item) => now - item.timestamp < 6_000);
      if (recent.some((item) => isSimilarQuestion(item.question, question))) {
        answeredAutoTurnIdsRef.current.add(logicalTurnId);
        recentAutoQuestionsRef.current = recent;
        setStatus('重复识别片段已合并');
        setLiveTranscript(question);
        setLiveTranscriptHint('与上一问题重复，已合并且不会重复回答');
        window.setTimeout(() => {
          setLiveTranscript((current) => current === question ? '' : current);
        }, 2200);
        return;
      }
      answeredAutoTurnIdsRef.current.add(logicalTurnId);
      recentAutoQuestionsRef.current = [...recent, { question, timestamp: now }];
      setLiveTranscript('');
    }
    const cancellationEpoch = answerCancellationRef.current;
    const questionCommittedAt = performance.now();
    const cachedQuestionTranslation = questionTranslationCacheRef.current.get(`${responseLanguage}\n${question}`);
    const previewQuestionTranslation = liveQuestionTranslationRef.current.source === question
      ? liveQuestionTranslationRef.current.translation
      : '';
    const cardId = appendCard(
      question,
      '正在生成回答...',
      source === 'manual' ? '手动提问' : '自动识别',
      true,
      activeTranslationMode === 'off' ? {} : {
        questionTranslation: cachedQuestionTranslation?.translation || previewQuestionTranslation,
        questionTranslationLoading: !cachedQuestionTranslation,
        answerTranslationLoading: true,
      },
    );
    if (source === 'auto') {
      interviewTurnCoordinatorRef.current.attachCard(logicalTurnId, cardId);
      const committedAt = Date.now();
      lastCommittedAutoQuestionRef.current = { turnId: logicalTurnId, question, cardId, timestamp: committedAt };
      autoTurnCardsRef.current.set(logicalTurnId, { cardId, question, timestamp: committedAt });
      if (autoTurnCardsRef.current.size > 24) {
        const oldestTurnId = autoTurnCardsRef.current.keys().next().value;
        if (oldestTurnId) autoTurnCardsRef.current.delete(oldestTurnId);
      }
    }
    if (activeTranslationMode !== 'off') {
      void requestQuestionTranslation(question, (translation) => {
        if (cancellationEpoch !== answerCancellationRef.current) return;
        updateCardForQuestion(cardId, question, { questionTranslation: translation });
      }).then((translation) => {
        if (cancellationEpoch !== answerCancellationRef.current) return;
        updateCardForQuestion(cardId, question, {
          questionTranslation: translation.translation,
          questionTranslationLoading: false,
        });
      }).catch((error) => {
        if (cancellationEpoch !== answerCancellationRef.current) return;
        updateCardForQuestion(cardId, question, {
          questionTranslationLoading: false,
          questionTranslationError: translationErrorMessage(error),
        });
      });
    }
    liveQuestionTranslationGenerationRef.current += 1;
    liveQuestionTranslationRef.current = { source: '', translation: '' };
    setLiveTranscriptTranslation('');
    setLiveTranscriptTranslationLoading(false);
    setLiveTranscriptTranslationError('');
    setStatus('生成中');
    await flushTranscriptSync();
    await sendCompanionSync('answer.started', { question }, syncRequestId);

    try {
      const baseRequest = {
        question,
        job: activeJobContext,
        language: responseLanguage,
        resumeText,
        context: turnsRef.current
          .slice(-INTERVIEW_CONTEXT_TURN_LIMIT)
          .map((turn) => `Q: ${turn.question}\nA: ${turn.answer}`),
      };
      const attempts = interviewModelAttempts(interviewModelFamilyRef.current);

      let result: { answer?: string; model?: string } | null = null;
      let lastError: unknown = null;
      const requestStartedAt = performance.now();
      let acceptedAt: number | undefined;
      let firstTokenAt: number | undefined;

      for (const [attemptIndex, attempt] of attempts.entries()) {
        let streamed = '';
        let attemptAcceptedAt: number | undefined;
        let attemptFirstTokenAt: number | undefined;
        try {
          if (window.electronAPI.miaodaInterviewAnswerStream) {
            result = await window.electronAPI.miaodaInterviewAnswerStream({
              ...baseRequest,
              model: attempt.model,
              turnId: logicalTurnId,
              pipelineId,
              attemptId: attemptIndex,
            }, (token) => {
              if (cancellationEpoch !== answerCancellationRef.current) return;
              if (attemptFirstTokenAt === undefined) attemptFirstTokenAt = performance.now();
              streamed += token;
              updateCard(cardId, { answer: streamed, meta: attempt.meta, loading: true });
              queueAnswerSync(cardId, token, syncRequestId);
            }, () => {
              if (attemptAcceptedAt === undefined) attemptAcceptedAt = performance.now();
            });
          } else {
            result = await window.electronAPI.miaodaInterviewAnswer({
              ...baseRequest,
              model: attempt.model,
              turnId: logicalTurnId,
              pipelineId,
              attemptId: attemptIndex,
            });
          }
          if (!result?.answer?.trim()) {
            throw new Error('Server returned an empty answer');
          }
          interviewModelFamilyRef.current = attempt.family;
          acceptedAt = attemptAcceptedAt;
          firstTokenAt = attemptFirstTokenAt;
          break;
        } catch (error) {
          result = null;
          lastError = error;
          console.warn(`[LiteOverlay] ${attempt.meta} failed`, error);
          discardAnswerSync(cardId);
          if (/duplicate_interview_turn/i.test(error instanceof Error ? error.message : String(error))) {
            break;
          }
          if (attemptIndex < attempts.length - 1) {
            updateCard(cardId, {
              answer: INTERVIEW_MODEL_SWITCHING_MESSAGE,
              answerTranslation: '',
              answerTranslationError: '',
              meta: '正在切换备用模型',
              loading: true,
            });
            await sendCompanionSync('answer.started', { question }, syncRequestId).catch(() => undefined);
          }
        }
      }

      if (cancellationEpoch !== answerCancellationRef.current) {
        discardAnswerSync(cardId);
        return;
      }
      if (!result) throw lastError instanceof Error ? lastError : new Error('Server answer failed');
      const completedAt = performance.now();
      const accepted = acceptedAt ?? firstTokenAt ?? completedAt;
      const firstToken = firstTokenAt ?? completedAt;
      const latency: LatencyBreakdown = {
        silenceMs: Math.max(0, Math.round(questionCommittedAt - timingOrigin)),
        clientPrepMs: Math.max(0, Math.round(requestStartedAt - questionCommittedAt)),
        uploadMs: Math.max(0, Math.round(accepted - requestStartedAt)),
        apiFirstTokenMs: Math.max(0, Math.round(firstToken - accepted)),
        generationMs: Math.max(0, Math.round(completedAt - firstToken)),
        totalMs: Math.max(0, Math.round(completedAt - timingOrigin)),
      };
      const answer = result.answer || '';
      const resolvedQuestion = source === 'auto'
        ? interviewTurnCoordinatorRef.current.get(logicalTurnId)?.question || question
        : question;
      updateCard(cardId, {
        question: resolvedQuestion,
        answer,
        meta: `Server / ${result.model || 'deepseek-v4-flash'}`,
        loading: false,
        latency,
      });
      console.info('[MiaodaLatency]', JSON.stringify({ question: resolvedQuestion, model: result.model || 'deepseek-v4-flash', ...latency }));
      rememberTurn(logicalTurnId, resolvedQuestion, answer, turnCreatedAt ?? performance.now());
      setStatus(activeTranslationMode === 'off' ? '已回答' : '已回答，翻译中');
      await flushAnswerSync(cardId);
      await sendCompanionSync('answer.done', { question: resolvedQuestion, answer, model: result.model }, syncRequestId);

      if (activeTranslationMode === 'complete') {
        try {
          const translated = await streamTranslation(answer, responseLanguage, (translation) => {
            if (cancellationEpoch !== answerCancellationRef.current) return;
            updateCard(cardId, { answerTranslation: translation, answerTranslationError: '' });
          });
          if (cancellationEpoch === answerCancellationRef.current) {
            updateCard(cardId, {
              answerTranslation: translated.translation,
              answerTranslationLoading: false,
            });
          }
        } catch (error) {
          if (cancellationEpoch === answerCancellationRef.current) {
            updateCard(cardId, {
              answerTranslationLoading: false,
              answerTranslationError: translationErrorMessage(error),
            });
          }
        }
      }
      if (cancellationEpoch === answerCancellationRef.current) setStatus('已回答');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'LLM failed';
      const resolvedQuestion = source === 'auto'
        ? interviewTurnCoordinatorRef.current.get(logicalTurnId)?.question || question
        : question;
      updateCard(cardId, {
        question: resolvedQuestion,
        answer: `回答失败：${message}`,
        answerTranslationLoading: false,
        meta: `Server failed / ${message}`,
        loading: false,
      });
      setStatus('回答失败');
      await flushAnswerSync(cardId);
      await sendCompanionSync('answer.error', { message }, syncRequestId);
    }
  }, [activeJobContext, activeTranslationMode, appendCard, discardAnswerSync, flushAnswerSync, flushTranscriptSync, mergeRepeatedTailIntoLastQuestion, queueAnswerSync, rememberTurn, requestQuestionTranslation, responseLanguage, resumeText, sendCompanionSync, streamTranslation, updateCard, updateCardForQuestion]);

  autoAnswerRef.current = (turnId, question, audioEndedAt, turnCreatedAt) => {
    void answerQuestion(question, 'auto', undefined, audioEndedAt, turnId, turnCreatedAt);
  };

  const startInterview = useCallback(async () => {
    const freshAuth = await window.electronAPI.miaodaAuthGetState?.();
    if (freshAuth) setAuthState(freshAuth);
    if (!freshAuth?.isAuthenticated) {
      throw new Error(freshAuth?.connectionError || '登录已过期，请重新登录');
    }
    if (freshAuth.connectionError) {
      throw new Error(freshAuth.connectionError);
    }
    if (!(await ensureInterviewQuota(freshAuth))) {
      throw new Error('面试时间已用完，请先兑换卡密');
    }
    recentAutoQuestionsRef.current = [];
    lastCommittedAutoQuestionRef.current = null;
    autoTurnCardsRef.current.clear();
    answeredAutoTurnIdsRef.current.clear();
    interviewTurnCoordinatorRef.current.reset(performance.now());
    turnsRef.current = [];
    interviewModelFamilyRef.current = 'deepseek';
    nativeSpeechStateRef.current = 'unknown';
    nativeSpeechEndedObservedAtRef.current = null;
    nativeAudioEndedAtRef.current = undefined;
    if (questionEvaluationTimerRef.current) window.clearTimeout(questionEvaluationTimerRef.current);
    questionEvaluationTimerRef.current = null;
    localStorage.setItem('lite_job_category', selectedCategory);
    localStorage.setItem('lite_selected_job', selectedJob);
    localStorage.setItem('lite_manual_job', manualJob);
    localStorage.setItem('lite_interview_language', language);
    localStorage.setItem('lite_interview_translation_mode', translationMode);
    localStorage.setItem('lite_resume_text', resumeText);
    localStorage.removeItem('lite_use_knowledge_base');
    localStorage.removeItem('lite_asr_model');
    await window.electronAPI.setRecognitionLanguage?.(LANGUAGES[language].recognition);
    const result = await window.electronAPI.startMeeting({ liteOverlay: true, doNotPersist: true });
    if (!result?.success) throw new Error(result?.error || '启动监听失败');
    setIsListening(true);
    setStatus('监听中');
  }, [ensureInterviewQuota, language, manualJob, resumeText, selectedCategory, selectedJob, translationMode]);

  useEffect(() => {
    if (
      standaloneAssistant !== 'interview' ||
      activePage !== 'interview' ||
      !authState?.isAuthenticated ||
      authState?.connectionError ||
      standaloneInterviewStartedRef.current
    ) return;

    standaloneInterviewStartedRef.current = true;
    void startInterview().catch((error) => {
      standaloneInterviewStartedRef.current = false;
      setStatus(error instanceof Error ? error.message : '启动失败');
    });
  }, [activePage, authState?.connectionError, authState?.isAuthenticated, standaloneAssistant, startInterview]);

  const stopInterview = useCallback(async () => {
    if (silenceTimerRef.current) window.clearTimeout(silenceTimerRef.current);
    if (transcriptFallbackTimerRef.current) window.clearTimeout(transcriptFallbackTimerRef.current);
    if (questionEvaluationTimerRef.current) window.clearTimeout(questionEvaluationTimerRef.current);
    silenceTimerRef.current = null;
    transcriptFallbackTimerRef.current = null;
    questionEvaluationTimerRef.current = null;
    answerCancellationRef.current += 1;
    nativeSpeechStateRef.current = 'unknown';
    nativeSpeechEndedObservedAtRef.current = null;
    nativeAudioEndedAtRef.current = undefined;
    interviewTurnCoordinatorRef.current.reset(performance.now());
    answeredAutoTurnIdsRef.current.clear();
    autoTurnCardsRef.current.clear();
    setLiveTranscript('');
    setLiveTranscriptHint('正在识别问题，停顿后自动回答');
    liveQuestionTranslationGenerationRef.current += 1;
    liveQuestionTranslationRef.current = { source: '', translation: '' };
    setLiveTranscriptTranslation('');
    setLiveTranscriptTranslationLoading(false);
    setLiveTranscriptTranslationError('');
    await window.electronAPI.endMeeting?.();
    await refreshQuotaState().catch(() => undefined);
    setIsListening(false);
    setStatus('已停止');
  }, [refreshQuotaState]);

  useEffect(() => {
    if (!isListening) return;
    let checking = false;
    const check = async () => {
      if (checking) return;
      checking = true;
      try {
        const quota = await window.electronAPI.miaodaAuthGetQuota?.();
        if (quota) setAuthState((current: any) => current ? { ...current, quota } : current);
        if (Number(quota?.remainingInterviewSeconds) <= 0) {
          await stopInterview();
          showInterviewQuotaNotice();
        }
      } catch {
        // The ASR connection is independently metered and closed by the server.
      } finally {
        checking = false;
      }
    };
    const timer = window.setInterval(() => void check(), 5_000);
    return () => window.clearInterval(timer);
  }, [isListening, showInterviewQuotaNotice, stopInterview]);

  const logout = useCallback(async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    setLoginError('');
    try {
      if (isListening) await stopInterview();
      const state = await window.electronAPI.miaodaAuthLogout?.();
      setAuthState(state || { isAuthenticated: false });
      setUsername('');
      setPassword('');
      setRedeemCardKey('');
      setRedeemStatus('');
      setRedeemError('');
      setPairing(null);
      setPairingQr('');
      setPairingCopyStatus('idle');
      setMobileConnected(false);
      setPairingError('');
      setAuthModalOpen(false);
      setPendingAssistantLaunch(null);
      setInterviewQuotaNoticeOpen(false);
      setWrittenQuotaNoticeOpen(false);
      setActivePage('home');
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : '退出登录失败，请重试');
    } finally {
      setIsLoggingOut(false);
    }
  }, [isListening, isLoggingOut, stopInterview]);

  const clearInterviewAnswers = useCallback(() => {
    answerCancellationRef.current += 1;
    setCards([]);
    recentAutoQuestionsRef.current = [];
    lastCommittedAutoQuestionRef.current = null;
    autoTurnCardsRef.current.clear();
    answeredAutoTurnIdsRef.current.clear();
    turnsRef.current = [];
    nativeSpeechEndedObservedAtRef.current = null;
    nativeAudioEndedAtRef.current = undefined;
    interviewTurnCoordinatorRef.current.reset(performance.now());
    if (silenceTimerRef.current) window.clearTimeout(silenceTimerRef.current);
    if (transcriptFallbackTimerRef.current) window.clearTimeout(transcriptFallbackTimerRef.current);
    if (questionEvaluationTimerRef.current) window.clearTimeout(questionEvaluationTimerRef.current);
    silenceTimerRef.current = null;
    transcriptFallbackTimerRef.current = null;
    questionEvaluationTimerRef.current = null;
    setLiveTranscript('');
    liveQuestionTranslationGenerationRef.current += 1;
    liveQuestionTranslationRef.current = { source: '', translation: '' };
    setLiveTranscriptTranslation('');
    setLiveTranscriptTranslationLoading(false);
    setLiveTranscriptTranslationError('');
  }, []);

  const launchConfiguredAssistant = useCallback(async (kind: 'interview' | 'written') => {
    if (kind === 'interview') {
      localStorage.setItem('lite_job_category', selectedCategory);
      localStorage.setItem('lite_selected_job', selectedJob);
      localStorage.setItem('lite_manual_job', manualJob);
      localStorage.setItem('lite_interview_language', language);
      localStorage.setItem('lite_interview_translation_mode', translationMode);
      localStorage.setItem('lite_resume_text', resumeText);
      localStorage.removeItem('lite_use_knowledge_base');
      localStorage.removeItem('lite_asr_model');
    } else {
      localStorage.setItem('lite_written_language', writtenLanguage);
      localStorage.setItem('lite_written_type', writtenSolveMode);
      localStorage.removeItem('lite_vision_mode');
    }

    await openAssistant(kind);
    // Closing the standalone work window returns to the actual homepage, not
    // to a setup page hidden behind it.
    setActivePage('home');
  }, [language, manualJob, openAssistant, resumeText, selectedCategory, selectedJob, translationMode, writtenLanguage, writtenSolveMode]);

  const openAuthModal = useCallback((kind: 'interview' | 'written' | null = null) => {
    setLoginError('');
    setPassword('');
    setPendingAssistantLaunch(kind);
    setAuthModalOpen(true);
  }, []);

  const requestAssistantLaunch = useCallback(async (kind: 'interview' | 'written') => {
    setLoginError('');
    try {
      const state = await window.electronAPI.miaodaAuthGetState?.();
      setAuthState(state || null);
      if (state?.isAuthenticated && !state?.connectionError) {
        if (kind === 'interview' && !(await ensureInterviewQuota(state))) return;
        if (kind === 'written' && !(await ensureWrittenQuota(state))) return;
        await launchConfiguredAssistant(kind);
        return;
      }
    } catch {
      // Treat an unavailable/expired session exactly like a logged-out state.
    }
    openAuthModal(kind);
  }, [ensureInterviewQuota, ensureWrittenQuota, launchConfiguredAssistant, openAuthModal]);

  const login = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    setLoginError('');
    setIsLoggingIn(true);
    try {
      const normalizedUsername = username.trim();
      if (!normalizedUsername || !password) {
        throw new Error('请输入用户名和密码');
      }
      const state = await window.electronAPI.miaodaAccountLogin(normalizedUsername, password);
      setUsername(normalizedUsername);
      setAuthState(state);
      if (!state?.isAuthenticated || state?.connectionError) {
        throw new Error(state?.connectionError || '登录失败');
      }
      setPassword('');
      if (pendingAssistantLaunch) {
        const kind = pendingAssistantLaunch;
        setPendingAssistantLaunch(null);
        await launchConfiguredAssistant(kind);
      }
      setAuthModalOpen(false);
    } catch (error) {
      setLoginError(friendlyLoginError(error));
    } finally {
      setIsLoggingIn(false);
    }
  }, [launchConfiguredAssistant, password, pendingAssistantLaunch, username]);

  const register = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    setLoginError('');
    setIsRegistering(true);
    try {
      const normalizedUsername = username.trim();
      const usernameLength = Array.from(normalizedUsername).length;
      const passwordLength = Array.from(password).length;
      if (usernameLength < 4 || usernameLength > 32) throw new Error('用户名须为 4～32 个字符');
      if (passwordLength < 8 || passwordLength > 24) throw new Error('密码长度须为 8～24 个字符');
      if (password !== confirmPassword) throw new Error('两次输入的密码不一致');
      const state = await window.electronAPI.miaodaAccountRegister(normalizedUsername, password);
      setUsername(state?.username || normalizedUsername);
      setAuthState(state);
      if (!state?.isAuthenticated || state?.connectionError) {
        throw new Error(state?.connectionError || '注册失败');
      }
      setPassword('');
      setConfirmPassword('');
    } catch (error) {
      setLoginError(friendlyRegisterError(error));
    } finally {
      setIsRegistering(false);
    }
  }, [confirmPassword, password, username]);

  const redeemCard = useCallback(async () => {
    if (isRedeeming) return;
    const normalizedCardKey = normalizeCardKey(redeemCardKey);
    if (!normalizedCardKey) {
      setRedeemError('请输入卡密');
      setRedeemStatus('');
      return;
    }
    setIsRedeeming(true);
    setRedeemError('');
    setRedeemStatus('');
    try {
      const result = await window.electronAPI.miaodaAccountRedeem(normalizedCardKey);
      setAuthState(result?.authState || await window.electronAPI.miaodaAuthGetState?.());
      setRedeemCardKey('');
      const addedMinutes = Math.floor(Number(result?.addedInterviewSeconds || 0) / 60);
      const addedWritten = Math.floor(Number(result?.addedWrittenQuestions || 0));
      const additions = [addedMinutes > 0 ? `面试 ${addedMinutes.toLocaleString('zh-CN')} 分钟` : '', addedWritten > 0 ? `笔试 ${addedWritten.toLocaleString('zh-CN')} 题` : ''].filter(Boolean).join('、');
      setRedeemStatus(additions ? `已增加${additions}` : '卡密额度已充值到当前账户');
    } catch (error) {
      setRedeemError(friendlyRedeemError(error));
    } finally {
      setIsRedeeming(false);
    }
  }, [isRedeeming, redeemCardKey]);

  const submitManual = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    const question = normalizeText(manualQuestion);
    if (!question || manualQuestionSubmitting) {
      manualQuestionInputRef.current?.focus();
      return;
    }
    setManualQuestion('');
    setManualQuestionSubmitting(true);
    try {
      if (!(await ensureInterviewQuota())) return;
      await answerQuestion(question, 'manual');
    } finally {
      setManualQuestionSubmitting(false);
      window.setTimeout(() => manualQuestionInputRef.current?.focus(), 0);
    }
  }, [answerQuestion, ensureInterviewQuota, manualQuestion, manualQuestionSubmitting]);

  const cancelManualQuestion = useCallback(() => {
    setManualQuestion('');
    setManualQuestionOpen(false);
  }, []);

  const changeCategory = useCallback((key: JobCategoryKey) => {
    const next = JOB_CATEGORIES.find((item) => item.key === key) || JOB_CATEGORIES[0];
    setSelectedCategory(next.key);
    setSelectedJob(next.jobs[0]);
  }, []);

  const captureWrittenScreen = useCallback(async (typeOverride?: WrittenSolveMode) => {
    if (writtenStartedAtRef.current !== null) return;
    if (!(await ensureWrittenQuota())) return;
    const solveType = typeOverride ?? writtenSolveMode;
    if (solveType === 'code' || solveType === 'leetcode') changeWrittenSolveMode(solveType);
    const startedAt = performance.now();
    const historyId = `written-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const updateHistoryItem = (patch: Partial<Omit<WrittenHistoryItem, 'id'>>) => {
      setWrittenHistory((current) => current.map((item) => item.id === historyId ? { ...item, ...patch } : item));
    };
    writtenStartedAtRef.current = startedAt;
    setWrittenLoading(true);
    setWrittenElapsedMs(0);
    setWrittenQuestion('正在识别屏幕中的题目…');
    setWrittenAnswer('题目识别完成后，将继续生成完整答案和代码。');
    setWrittenHistory((current) => [...current, {
      id: historyId,
      question: '正在识别屏幕中的题目…',
      answer: '题目识别完成后，将继续生成完整答案和代码。',
      loading: true,
    }]);
    setWrittenStatus('正在截图');
    void window.electronAPI.miaodaCompanionSend?.('written.progress', { stage: '正在截图' }).catch(() => undefined);
    setActivePage('written');
    let captureMs = 0;
    try {
      // Always exclude Miaoda's own windows from the image. Privacy mode is
      // optional, so leaving the assistant visible can feed a stale problem
      // and answer back into the vision model instead of the current screen.
      const screenshot = await window.electronAPI.takeScreenshot?.({ hideWindows: true });
      if (!screenshot?.path) throw new Error('截图失败');
      const screenshotCompletedAt = performance.now();
      captureMs = Math.max(0, Math.round(screenshotCompletedAt - startedAt));
      setWrittenQuestion('思考中…');
      setWrittenAnswer('思考中…');
      updateHistoryItem({ question: '思考中…', answer: '思考中…', loading: true });
      setWrittenStatus('思考中 · 正在识图＋解题');
      void window.electronAPI.miaodaCompanionSend?.('written.progress', { stage: '思考中 · 正在识图＋解题' }).catch(() => undefined);
      const result = await window.electronAPI.miaodaWrittenSolveScreen?.({
        filePath: screenshot.path,
        type: solveType,
        language: writtenLanguage,
        visionMode: AUTOMATIC_VISION_MODE,
      });
      if (!result) throw new Error('识图解题服务没有返回结果');
      const normalized = normalizeWrittenResult(result, writtenLanguage, true);
      if (!normalized.question) throw new Error('没有识别到题目，请确认题目位于当前截图屏幕');
      if (!normalized.answer) throw new Error('模型没有返回答案，请重新识别');
      const completedAt = performance.now();
      const totalMs = Math.max(0, Math.round(completedAt - startedAt));
      const serviceMs = Math.max(0, totalMs - captureMs);
      const latency: WrittenLatencyBreakdown = {
        captureMs,
        serviceMs,
        uploadMs: Number.isFinite(Number(result.uploadMs)) ? Math.max(0, Math.round(Number(result.uploadMs))) : undefined,
        visionMs: Number.isFinite(Number(result.visionMs)) ? Math.max(0, Math.round(Number(result.visionMs))) : undefined,
        answerMs: Number.isFinite(Number(result.answerMs)) ? Math.max(0, Math.round(Number(result.answerMs))) : undefined,
        solverMs: Number.isFinite(Number(result.solverMs)) ? Math.max(0, Math.round(Number(result.solverMs))) : undefined,
        serverMs: Number.isFinite(Number(result.serverMs)) ? Math.max(0, Math.round(Number(result.serverMs))) : undefined,
        totalMs,
        completed: true,
      };
      setWrittenQuestion(normalized.question);
      setWrittenAnswer(normalized.answer);
      updateHistoryItem({ question: normalized.question, answer: normalized.answer, loading: false });
      const recognitionModel = normalized.recognitionModel || AUTOMATIC_VISION_MODE;
      const answerModel = normalized.answerModel || recognitionModel;
      setWrittenStatus('已生成');
      setActivePage('written');
      void refreshAuth().catch(() => undefined);
      void window.electronAPI.miaodaCompanionSend?.('written.done', {
        questionText: normalized.question,
        answer: normalized.answer,
        solveMode: solveType,
        recognitionModel,
        answerModel,
      }).catch(() => undefined);
      console.info('[MiaodaWrittenLatency]', JSON.stringify({
        recognitionModel: normalized.recognitionModel || AUTOMATIC_VISION_MODE,
        answerModel: normalized.answerModel || 'unknown',
        ...latency,
      }));
    } catch (error) {
      const rawError = error instanceof Error ? error.message : String(error || '');
      if (/written question quota is exhausted|written[_ -]?quota[_ -]?(?:is[_ -]?)?exhausted|笔试(?:题目)?(?:次数|额度).*(?:不足|用完|耗尽)/i.test(rawError)) {
        setWrittenHistory((current) => current.filter((item) => item.id !== historyId));
        setWrittenQuestion('');
        setWrittenAnswer('');
        showWrittenQuotaNotice();
        void refreshAuth().catch(() => undefined);
        return;
      }
      const message = friendlyServiceError(error);
      setWrittenQuestion('本次识别未完成');
      setWrittenAnswer(`生成失败：${message}`);
      updateHistoryItem({ question: '本次识别未完成', answer: `生成失败：${message}`, loading: false });
      setWrittenStatus(`识别失败：${message}`);
      void window.electronAPI.miaodaCompanionSend?.('written.error', { message }).catch(() => undefined);
    } finally {
      writtenStartedAtRef.current = null;
      setWrittenLoading(false);
      setWrittenElapsedMs(0);
    }
  }, [changeWrittenSolveMode, ensureWrittenQuota, refreshAuth, showWrittenQuotaNotice, writtenLanguage, writtenSolveMode]);

  useEffect(() => {
    if (!writtenLoading) return undefined;
    const update = () => {
      if (writtenStartedAtRef.current !== null) {
        setWrittenElapsedMs(Math.max(0, Math.round(performance.now() - writtenStartedAtRef.current)));
      }
    };
    update();
    const timer = window.setInterval(update, 100);
    return () => window.clearInterval(timer);
  }, [writtenLoading]);

  useEffect(() => {
    return window.electronAPI.onGlobalShortcut?.(({ action }) => {
      if (standaloneAssistant === 'written' && action === 'captureWrittenScreen') void captureWrittenScreen('code');
      if (standaloneAssistant === 'written' && action === 'captureWrittenLeetCode') void captureWrittenScreen('leetcode');
      if (action === 'writtenQuotaExhausted') showWrittenQuotaNotice();
      if (action === 'scrollMobileWrittenDown' || action === 'scrollMobileWrittenUp') {
        const direction = action === 'scrollMobileWrittenUp' ? 'up' : 'down';
        const mode: AssistantScrollMode = standaloneAssistant
          ?? (activePage === 'interview' || activePage === 'written' ? activePage : 'written');
        scrollDesktopAssistant(mode, direction);
        void window.electronAPI.miaodaCompanionSend?.('assistant.scroll', { direction, assistant: mode }).catch((error) => {
          console.warn(`[LiteOverlay] Failed to scroll the phone ${mode} assistant ${direction}:`, error);
          if (mode === 'written') setWrittenStatus('手机端未连接，仅滚动电脑端');
          else setStatus('手机端未连接，仅滚动电脑端');
        });
      }
    });
  }, [activePage, captureWrittenScreen, scrollDesktopAssistant, showWrittenQuotaNotice, standaloneAssistant]);

  useEffect(() => {
    if (standaloneAssistant !== 'written' || initialWrittenActionHandledRef.current) return;
    const initialAction = new URLSearchParams(window.location.search).get('initialAction');
    if (initialAction !== 'captureWrittenScreen' && initialAction !== 'captureWrittenLeetCode') return;
    initialWrittenActionHandledRef.current = true;
    void captureWrittenScreen(initialAction === 'captureWrittenLeetCode' ? 'leetcode' : 'code');
  }, [captureWrittenScreen, standaloneAssistant]);

  const createMobilePairing = useCallback(async () => {
    setPairingError('');
    setPairingCopyStatus('idle');
    try {
      const next = await window.electronAPI.miaodaCompanionCreate?.();
      if (!next?.qrUrl) throw new Error('后端没有返回配对地址');
      setPairing(next);
      setPairingQr(await QRCode.toDataURL(next.qrUrl, { width: 220, margin: 1, color: { dark: '#172033', light: '#ffffff' } }));
    } catch (error) {
      setPairingError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const copyPairingUrl = useCallback(async () => {
    if (!pairing?.qrUrl) return;
    try {
      const result = await window.electronAPI.writeClipboardText?.(pairing.qrUrl);
      if (!result?.success) throw new Error('Clipboard unavailable');
      setPairingCopyStatus('copied');
      window.setTimeout(() => setPairingCopyStatus('idle'), 1600);
    } catch {
      setPairingCopyStatus('error');
    }
  }, [pairing?.qrUrl]);

  useEffect(() => {
    if (!authState?.isAuthenticated || authState?.connectionError) return;
    void window.electronAPI.miaodaCompanionResume?.().then((result) => {
      if (!result?.resumed) return;
      setPairing({ pairId: result.pairId, qrUrl: '', code: '已配对', expiresAt: result.expiresAt || '' });
      setPairingError('');
    }).catch((error) => {
      setPairingError(`手机联动暂时不可用：${friendlyServiceError(error)}`);
    });
  }, [authState?.connectionError, authState?.isAuthenticated]);

  useEffect(() => window.electronAPI?.onMiaodaCompanionEvent?.((event: any) => {
    const payload = event?.payload || {};
    if (event?.type === 'connection.state' && 'mobileConnected' in payload) setMobileConnected(Boolean(payload.mobileConnected));
    if (event?.type === 'socket.state' && !payload.connected) {
      setMobileConnected(false);
      if (payload.reconnecting) setPairingError('电脑联动正在自动重连…');
    }
    if (event?.type === 'socket.state' && payload.connected) setPairingError('');
    if (event?.type === 'socket.error') setPairingError(`电脑联动连接失败：${String(payload.message || '未知错误')}`);
    if (event?.type === 'interview.start') {
      if (standaloneAssistant === 'interview') {
        void startInterview().then(() => setActivePage('interview')).catch((error) => setStatus(error instanceof Error ? error.message : '启动失败'));
      } else if (!standaloneAssistant) {
        void ensureInterviewQuota().then((available) => {
          if (available) void openAssistant('interview');
          else void window.electronAPI.miaodaCompanionSend?.('interview.error', { message: '面试时间已用完，请先兑换卡密' }).catch(() => undefined);
        });
      }
    }
    if (event?.type === 'interview.stop') void stopInterview();
    if (event?.type === 'answer.cancel') answerCancellationRef.current += 1;
    if (event?.type === 'question.manual' && payload.question) {
      void ensureInterviewQuota().then((available) => {
        if (available) void answerQuestion(String(payload.question), 'manual', event.requestId);
        else void window.electronAPI.miaodaCompanionSend?.('answer.error', { message: '面试时间已用完，请先兑换卡密' }, event.requestId).catch(() => undefined);
      });
    }
    if ((event?.type === 'written.language.set' || event?.type === 'written.language.changed') && payload.language) {
      changeWrittenLanguage(payload.language, false);
    }
    if ((event?.type === 'written.mode.set' || event?.type === 'written.mode.changed') && payload.mode) {
      changeWrittenSolveMode(payload.mode, false);
    }
    if (event?.type === 'capture.request' && event.requestId) {
      void (async () => {
        try {
          if (!(await ensureWrittenQuota())) {
            const message = '笔试次数已用完，请先兑换卡密';
            void window.electronAPI.miaodaCompanionSend?.('written.error', { message }).catch(() => undefined);
            return;
          }
          const requestedLanguage = normalizeWrittenLanguage(payload.language || writtenLanguage);
          const requestedMode = normalizeWrittenSolveMode(payload.mode || writtenSolveMode);
          changeWrittenLanguage(requestedLanguage, false);
          changeWrittenSolveMode(requestedMode, false);
          setWrittenStatus('手机已请求截图');
          const screenshot = await window.electronAPI.takeScreenshot?.({ hideWindows: true });
          if (!screenshot?.path) throw new Error('截图失败');
          await window.electronAPI.miaodaCompanionUploadCapture?.({ captureId: event.requestId, filePath: screenshot.path, type: requestedMode, language: requestedLanguage, visionMode: AUTOMATIC_VISION_MODE });
          setWrittenStatus('结果已发送到手机');
        } catch (error) {
          setWrittenStatus(`手机截图失败：${error instanceof Error ? error.message : String(error)}`);
        }
      })();
    }
  }) || (() => undefined), [answerQuestion, changeWrittenLanguage, changeWrittenSolveMode, ensureInterviewQuota, ensureWrittenQuota, openAssistant, standaloneAssistant, startInterview, stopInterview, writtenLanguage, writtenSolveMode]);

  const quotaText = useMemo(() => {
    const quota = authState?.quota;
    if (!quota) return '面试 -- 分钟 笔试 -- 次';
    const seconds = Number(quota.remainingInterviewSeconds);
    const minutes = Number.isFinite(seconds)
      ? Math.max(0, Math.ceil(seconds / 60)).toLocaleString('zh-CN')
      : '--';
    const written = Number(quota.remainingWrittenQuestions);
    const writtenText = Number.isFinite(written) ? Math.floor(written).toLocaleString('zh-CN') : '--';
    return `面试 ${minutes} 分钟  笔试 ${writtenText} 次`;
  }, [authState]);

  const shortcutFor = useCallback((id: string) => displayShortcut(
    headerKeybinds.find((item) => item.id === id)?.accelerator,
  ), [headerKeybinds]);

  const pageMeta = useMemo(() => {
    if (activePage.startsWith('interview')) return { kicker: '实时语音问答', title: '面试助手' };
    if (activePage.startsWith('written')) return { kicker: '屏幕识题解答', title: '笔试助手' };
    return { kicker: 'AI 面试与笔试工作台', title: '秒答' };
  }, [activePage]);

  const writtenLoadingSeconds = (writtenElapsedMs / 1000).toFixed(1);
  const writtenLoadingText = writtenStatus.startsWith('正在截图')
    ? `截图中 ${writtenLoadingSeconds} 秒`
    : `思考中 ${writtenLoadingSeconds} 秒`;

  const writtenQuotaNotice = writtenQuotaNoticeOpen && (
    <div className="lite-written-quota-backdrop" role="dialog" aria-modal="true" aria-labelledby="lite-written-quota-title">
      <section className="lite-written-quota-modal">
        <span>笔试额度</span>
        <h2 id="lite-written-quota-title">笔试次数已用完</h2>
        <p>当前账号没有可用的笔试次数，请先兑换卡密，到账后再开始笔试。</p>
        <div className="lite-written-quota-actions">
          <button type="button" onClick={() => setWrittenQuotaNoticeOpen(false)}>知道了</button>
          <button type="button" className="primary" onClick={() => {
            setWrittenQuotaNoticeOpen(false);
            if (standaloneAssistant) void window.electronAPI.closeAssistantWindow?.();
            else setActivePage('home');
          }}>去兑换卡密</button>
        </div>
      </section>
    </div>
  );

  const interviewQuotaNotice = interviewQuotaNoticeOpen && (
    <div className="lite-written-quota-backdrop" role="dialog" aria-modal="true" aria-labelledby="lite-interview-quota-title">
      <section className="lite-written-quota-modal">
        <span>面试额度</span>
        <h2 id="lite-interview-quota-title">面试时间已用完</h2>
        <p>当前账号没有可用的面试时间，无法启动语音识别或生成面试回答，请先兑换卡密。</p>
        <div className="lite-written-quota-actions">
          <button type="button" onClick={() => setInterviewQuotaNoticeOpen(false)}>知道了</button>
          <button type="button" className="primary" onClick={() => {
            setInterviewQuotaNoticeOpen(false);
            if (standaloneAssistant) void window.electronAPI.closeAssistantWindow?.();
            else setActivePage('home');
          }}>去兑换卡密</button>
        </div>
      </section>
    </div>
  );

  const redemptionSuccessNotice = redeemStatus && (
    <div className="lite-written-quota-backdrop" role="dialog" aria-modal="true" aria-labelledby="lite-redemption-success-title" aria-describedby="lite-redemption-success-message">
      <section className="lite-written-quota-modal lite-redemption-success-modal">
        <span>卡密兑换</span>
        <h2 id="lite-redemption-success-title">兑换成功</h2>
        <p id="lite-redemption-success-message" role="status">{redeemStatus}</p>
        <div className="lite-written-quota-actions single">
          <button type="button" className="primary" autoFocus onClick={() => setRedeemStatus('')}>知道了</button>
        </div>
      </section>
    </div>
  );

  if (!authReady) {
    return <div className={standaloneAssistant ? 'lite-root lite-root-standalone lite-auth-loading' : 'lite-root lite-auth-loading'} aria-busy="true" />;
  }

  if (!authState?.isAuthenticated) {
    return (
      <div className={standaloneAssistant ? 'lite-root lite-auth-root lite-root-standalone' : 'lite-root lite-auth-root'}>
        <header className="lite-auth-titlebar lite-drag">
          <div className="lite-auth-brand"><span>秒</span><strong>秒答</strong></div>
          <div className="lite-auth-window-actions">
            <button type="button" className="close" aria-label="退出秒答" title={`退出秒答 · ${shortcutFor('general:quit-app')}`} onClick={() => window.electronAPI.quitApp?.()}><X className="lite-action-icon" aria-hidden="true" /></button>
          </div>
        </header>

        <main className="lite-auth-screen">
          <section className="lite-auth-intro">
            <div className="lite-auth-orbit"><span>AI</span><i /><i /><i /></div>
            <div className="lite-auth-copy">
              <span className="lite-auth-kicker">秒答客户端</span>
              <h1>让每一次回答<br />都更有底气</h1>
              <p>实时听题、快速生成回答，面试与笔试能力集中在一个轻量桌面助手中。</p>
              <div className="lite-auth-points"><span>实时语音识别</span><span>面试笔试联动</span><span>数据本地保护</span></div>
            </div>
          </section>

          <form className="lite-auth-panel" onSubmit={authMode === 'login' ? login : register}>
            <div className="lite-auth-panel-head">
              <span>欢迎使用</span>
              <h2>{authMode === 'login' ? '登录秒答' : '注册秒答'}</h2>
              <p>{authMode === 'login' ? '使用秒答账户登录，进入客户端后可直接兑换卡密。' : '在客户端创建账户，注册成功后即可直接登录使用。'}</p>
            </div>
            <div className="lite-auth-mode" role="tablist" aria-label="账户操作">
              <button type="button" role="tab" aria-selected={authMode === 'login'} className={authMode === 'login' ? 'active' : ''} onClick={() => { setAuthMode('login'); setLoginError(''); setConfirmPassword(''); }}>登录</button>
              <button type="button" role="tab" aria-selected={authMode === 'register'} className={authMode === 'register' ? 'active' : ''} onClick={() => { setAuthMode('register'); setLoginError(''); }}>注册</button>
            </div>
            <label className="lite-auth-field">
              <span>用户名</span>
              <div><b>@</b><input autoFocus autoComplete="username" spellCheck={false} value={username} onChange={(event) => setUsername(event.target.value)} placeholder="4～32 个字符" /></div>
            </label>
            <label className="lite-auth-field">
              <span>密码</span>
              <div><b>●</b><input type="password" autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="8～24 位密码" /></div>
            </label>
            {authMode === 'register' && <label className="lite-auth-field">
              <span>确认密码</span>
              <div><b>●</b><input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="再次输入密码" /></div>
            </label>}
            {loginError && <div className="lite-auth-error" role="alert">{loginError}</div>}
            <button className="lite-auth-submit" type="submit" disabled={isLoggingIn || isRegistering}>{authMode === 'login' ? (isLoggingIn ? '正在登录...' : '登录账户') : (isRegistering ? '正在注册...' : '创建账户')}<span>→</span></button>
            <button className="lite-auth-account-link" type="button" onClick={() => void window.electronAPI.openExternal?.('https://example.invalid/account.html')}>联系客服</button>
            <div className="lite-auth-safe"><i />密码仅用于登录验证，不会保存在客户端</div>
          </form>
        </main>
      </div>
    );
  }

  if (standaloneAssistant) {
    const isInterview = standaloneAssistant === 'interview';
    const isLivePage = activePage === 'interview' || activePage === 'written';

    return (
      <div ref={assistantRootRef} className={`assistant-compact-root ${isInterview ? 'interview' : 'written'}`}>
        <header className="assistant-compact-header">
          <div className="assistant-compact-title lite-drag">
            <strong>{isInterview ? '面试助手' : '笔试助手'}</strong>
            {isInterview && <em className="assistant-compact-header-context">{activeJob} · {LANGUAGES[language].label}</em>}
          </div>
          <div className="assistant-compact-tools">
            <button type="button" className="assistant-compact-home-button" onClick={() => void window.electronAPI.closeAssistantWindow?.()}>主页</button>
            <button type="button" className="assistant-compact-mode-switch" onClick={() => void openAssistant(isInterview ? 'written' : 'interview')}>{isInterview ? '切换笔试' : '切换面试'}</button>
            {isInterview && (
              <label className="assistant-compact-answer-count" title="显示最近一道或两道题的答案">
                <select
                  aria-label="答案显示数量"
                  value={interviewAnswerViewCount}
                  onChange={(event) => setInterviewAnswerViewCount(normalizeInterviewAnswerViewCount(event.target.value))}
                >
                  <option value={1}>1题</option>
                  <option value={2}>2题</option>
                </select>
              </label>
            )}
            <button
              type="button"
              className={mousePassthrough ? 'lite-instant-tooltip active' : 'lite-instant-tooltip'}
              aria-label="鼠标穿透"
              aria-pressed={mousePassthrough}
              data-tooltip={`鼠标穿透 · ${shortcutFor('general:toggle-mouse-passthrough')}`}
              onClick={() => void toggleMousePassthrough()}
            ><MousePointer2 className="lite-action-icon" aria-hidden="true" /></button>
            <button
              type="button"
              className={privacyMode ? 'lite-instant-tooltip active stealth' : 'lite-instant-tooltip'}
              aria-label={privacyMode ? '已隐身' : '开启隐身保护'}
              aria-pressed={privacyMode}
              data-tooltip={privacyMode ? '已隐身：常见会议软件无法捕获' : '开启隐身保护'}
              disabled={privacyModeChanging}
              onClick={() => void togglePrivacyMode()}
            ><EyeOff className="lite-action-icon" aria-hidden="true" /></button>
            <button
              type="button"
              className="lite-instant-tooltip"
              aria-label="隐藏客户端窗口"
              data-tooltip={`隐藏 · ${shortcutFor('general:toggle-visibility')}`}
              onClick={() => void window.electronAPI.toggleWindow?.()}
            ><MonitorOff className="lite-action-icon" aria-hidden="true" /></button>
            <button type="button" className="lite-instant-tooltip" aria-label="快捷键设置" data-tooltip="设置快捷键" onClick={() => window.electronAPI.toggleSettingsWindow?.()}><Settings className="lite-action-icon" aria-hidden="true" /></button>
            <button type="button" className="lite-instant-tooltip close" aria-label="退出秒答" data-tooltip={`退出秒答 · ${shortcutFor('general:quit-app')}`} onClick={() => window.electronAPI.quitApp?.()}><X className="lite-action-icon" aria-hidden="true" /></button>
          </div>
        </header>

        <main className="assistant-compact-main">
          {isInterview && !isLivePage && (
            <section className="assistant-compact-setup">
              <div className="assistant-compact-intro">
                <div><strong>开始前确认</strong><span>岗位、简历与回答语言</span></div>
                <em>{activeJob}</em>
              </div>
              <div className="assistant-compact-scroll">
                <label className="assistant-compact-card">
                  <span>个人简历</span>
                  <textarea value={resumeText} onChange={(event) => setResumeText(event.target.value)} placeholder="填写专业技能和项目经历" />
                </label>

                <section className="assistant-compact-card">
                  <span>面试岗位</span>
                  <div className="assistant-compact-two-columns">
                    <label>领域<select value={selectedCategory} onChange={(event) => changeCategory(event.target.value as JobCategoryKey)}>{JOB_CATEGORIES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
                    <label>岗位<select value={selectedJob} onChange={(event) => setSelectedJob(event.target.value)}>{category.jobs.map((job) => <option key={job} value={job}>{job}</option>)}</select></label>
                  </div>
                  <input value={manualJob} onChange={(event) => setManualJob(event.target.value)} placeholder="或手动输入岗位" />
                </section>

                <section className="assistant-compact-card assistant-compact-options">
                  <label>面试语言<select value={language} onChange={(event) => setLanguage(normalizeInterviewLanguage(event.target.value))}><InterviewLanguageOptions /></select></label>
                  <label>中文翻译<select aria-label="选择面试翻译模式" value={interviewTranslationActive ? translationMode : 'off'} disabled={responseLanguage === 'Chinese'} onChange={(event) => changeInterviewTranslationMode(event.target.value)}><InterviewTranslationModeOptions /></select></label>
                  <small>{responseLanguage === 'Chinese' ? '中文面试无需翻译' : '题目实时翻译；答案完成后整段翻译'}</small>
                </section>
              </div>
              <button className="assistant-compact-primary" onClick={() => { void startInterview().then(() => setActivePage('interview')).catch((error) => setStatus(error instanceof Error ? error.message : '启动失败')); }}>开始面试</button>
            </section>
          )}

          {!isInterview && !isLivePage && (
            <section className="assistant-compact-setup">
              <div className="assistant-compact-intro">
                <div><strong>识别屏幕题目</strong><span>自动判断题型并生成答案</span></div>
                <em>{writtenStatus}</em>
              </div>
              <div className="assistant-compact-scroll">
                <section className="assistant-compact-card assistant-compact-options">
                  <label>代码语言<select value={writtenLanguage} onChange={(event) => changeWrittenLanguage(event.target.value)}><WrittenLanguageOptions /></select></label>
                  <small>仅在识别为代码题时使用</small>
                </section>
              </div>
              <button className="assistant-compact-primary" disabled={writtenLoading} onClick={() => void captureWrittenScreen()}>{writtenLoading ? writtenLoadingText : '识别整屏'}</button>
            </section>
          )}

          {isInterview && activePage === 'interview' && (
            <section className={`assistant-compact-live interview${manualQuestionOpen ? ' manual-open' : ''}`}>
              <div ref={answersRef} className="assistant-compact-answers">
                {visibleInterviewCards.length === 0 && !liveTranscript ? <div className="assistant-compact-empty">正在等待面试官提问，识别到完整问题后自动生成回答。</div> : visibleInterviewCards.map((card) => <article key={card.id} className="assistant-compact-answer-card"><InterviewCardContent card={card} compact /></article>)}
                {liveTranscript && <article className="assistant-compact-answer-card live"><div className="assistant-compact-question">{liveTranscript}</div>{(liveTranscriptTranslation || liveTranscriptTranslationLoading || liveTranscriptTranslationError) && <div className="interview-translation compact question">{liveTranscriptTranslation && <div>{liveTranscriptTranslation}</div>}{!liveTranscriptTranslation && liveTranscriptTranslationLoading && <small>正在翻译稳定片段…</small>}{liveTranscriptTranslationError && <small className="error">{liveTranscriptTranslationError}</small>}</div>}<small>{liveTranscriptHint}</small></article>}
              </div>
              {manualQuestionOpen && (
                <form className="assistant-compact-manual" onSubmit={submitManual}>
                  <textarea
                    ref={manualQuestionInputRef}
                    aria-label="手动输入面试问题"
                    value={manualQuestion}
                    placeholder="输入面试问题，按 Enter 发送"
                    disabled={manualQuestionSubmitting}
                    onChange={(event) => setManualQuestion(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        cancelManualQuestion();
                      } else if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                        event.preventDefault();
                        event.currentTarget.form?.requestSubmit();
                      }
                    }}
                  />
                  <button type="submit" className="primary" disabled={manualQuestionSubmitting || !manualQuestion.trim()}>{manualQuestionSubmitting ? '生成中…' : '发送'}</button>
                  <button type="button" onClick={cancelManualQuestion}>取消</button>
                  <span className={manualQuestionSubmitting ? 'assistant-compact-manual-status generating' : 'assistant-compact-manual-status'} role="status">{manualQuestionSubmitting ? '正在生成回答，请稍候…' : 'Enter 发送 · Shift + Enter 换行 · Esc 取消'}</span>
                </form>
              )}
              <footer className="assistant-compact-controls"><button className="primary" onClick={() => void startInterview()} disabled={isListening}>开始</button><button onClick={() => void stopInterview()} disabled={!isListening}>停止</button><button onClick={clearInterviewAnswers}>清空</button><button aria-expanded={manualQuestionOpen} onClick={() => setManualQuestionOpen(true)}>手动提问</button></footer>
            </section>
          )}

          {!isInterview && activePage === 'written' && (
            <section className="assistant-compact-live">
              <div className="assistant-compact-status"><span>{writtenStatus}</span><button type="button" className="assistant-compact-solve-mode" aria-label="切换笔试解题模式" title={`点击切换为${writtenSolveMode === 'code' ? '力扣模式' : 'ACM 完整程序'}`} onClick={() => changeWrittenSolveMode(writtenSolveMode === 'code' ? 'leetcode' : 'code')}>{writtenSolveModeLabel(writtenSolveMode)}</button><label className="assistant-compact-language-switch">语言<select aria-label="切换笔试代码语言" value={writtenLanguage} onChange={(event) => changeWrittenLanguage(event.target.value)}><WrittenLanguageOptions /></select></label></div>
              <div ref={writtenAnswersRef} className="assistant-compact-answers">{writtenHistory.length ? writtenHistory.map((item) => <article key={item.id} className={`assistant-compact-answer-card written${item.answer.length > 1800 ? ' dense' : ''}`}><div className="assistant-compact-question">{item.question}</div><div className={item.loading ? 'assistant-compact-answer loading' : 'assistant-compact-answer'}>{formatCardText(item.answer)}</div>{item.loading && <small>生成中</small>}</article>) : <div className="assistant-compact-empty">笔试配置已载入，点击下方按钮识别当前屏幕题目。</div>}</div>
              <footer className="assistant-compact-controls"><button className="primary" onClick={() => void captureWrittenScreen()} disabled={writtenLoading}>{writtenLoading ? writtenLoadingText : writtenQuestion ? '重新识别' : '识别整屏'}</button></footer>
            </section>
          )}
        </main>
        {interviewQuotaNotice}
        {writtenQuotaNotice}
      </div>
    );
  }

  return (
    <div className={standaloneAssistant ? 'lite-root lite-root-standalone' : 'lite-root'}>
      <header className="lite-titlebar">
        <div className="lite-title lite-drag">
          <span className="lite-title-brand" aria-hidden="true">秒</span>
          <div className="lite-title-copy"><span className="lite-title-kicker">{pageMeta.kicker}</span><strong>{pageMeta.title}</strong></div>
        </div>
        {appUpdateVisible && (
          <button
            type="button"
            className={`lite-update-button ${appUpdate?.status || 'available'}`}
            disabled={appUpdateActionPending || appUpdate?.status === 'downloading'}
            title={appUpdate?.status === 'downloaded' ? '更新已下载，点击重启并安装' : `点击下载秒答 v${appUpdate?.version}`}
            aria-label={appUpdateLabel}
            onClick={() => void handleAppUpdate()}
          >
            {appUpdate?.status === 'downloaded'
              ? <RefreshCw className="lite-update-icon" aria-hidden="true" />
              : <Download className="lite-update-icon" aria-hidden="true" />}
            <span>{appUpdateLabel}</span>
          </button>
        )}
        {hasValidAuth ? (
          <div className="lite-quota-pill">{quotaText}</div>
        ) : (
          <button type="button" className="lite-quota-pill unauthenticated" onClick={() => openAuthModal(null)}>
            未登录 · 登录账户
          </button>
        )}
        <div className="lite-quick-actions">
          <button
            type="button"
            className={mousePassthrough ? 'lite-quick-action lite-instant-tooltip active' : 'lite-quick-action lite-instant-tooltip'}
            aria-label="鼠标穿透"
            aria-pressed={mousePassthrough}
            data-tooltip={`鼠标穿透 · ${shortcutFor('general:toggle-mouse-passthrough')}`}
            onClick={() => void toggleMousePassthrough()}
          ><span><MousePointer2 className="lite-action-icon" aria-hidden="true" /></span>{mousePassthrough ? '穿透中' : '鼠标穿透'}</button>
          <button
            type="button"
            className={privacyMode ? 'lite-quick-action lite-instant-tooltip stealth active' : 'lite-quick-action lite-instant-tooltip stealth'}
            aria-label={privacyMode ? '已隐身，点击关闭隐身保护' : '开启隐身保护'}
            aria-pressed={privacyMode}
            data-tooltip={privacyMode ? '已隐身：无法被腾讯会议等常见共享截图捕获' : '隐身保护：点击后禁止常见会议软件捕获'}
            disabled={privacyModeChanging}
            onClick={() => void togglePrivacyMode()}
          ><span><EyeOff className="lite-action-icon" aria-hidden="true" /></span>{privacyMode ? '已隐身' : '隐身'}</button>
          <button
            type="button"
            className="lite-quick-action lite-instant-tooltip"
            aria-label="隐藏客户端窗口"
            data-tooltip={`隐藏 · ${shortcutFor('general:toggle-visibility')}`}
            onClick={() => void window.electronAPI.toggleWindow?.()}
          ><span><MonitorOff className="lite-action-icon" aria-hidden="true" /></span>隐藏</button>
          <button className="lite-icon-action lite-instant-tooltip" aria-label="快捷键设置" data-tooltip="设置快捷键" onClick={() => window.electronAPI.toggleSettingsWindow?.()}><Settings className="lite-action-icon" aria-hidden="true" /></button>
          <button className="lite-icon-action lite-instant-tooltip close" aria-label="退出秒答" data-tooltip={`退出秒答 · ${shortcutFor('general:quit-app')}`} onClick={() => window.electronAPI.quitApp?.()}><X className="lite-action-icon" aria-hidden="true" /></button>
        </div>
      </header>

      <div className={standaloneAssistant ? 'lite-shell lite-shell-standalone' : 'lite-shell'}>
        {!standaloneAssistant && <nav className="lite-nav">
          <div className="lite-nav-label">工作台</div>
          <button className={activePage === 'home' ? 'active' : ''} onClick={() => setActivePage('home')}><span>⌂</span><b>主页</b></button>
          <button className={activePage === 'interview-setup' ? 'active' : ''} onClick={() => setActivePage('interview-setup')}><span>◌</span><b>面试助手</b></button>
          <button className={activePage === 'written-setup' ? 'active' : ''} onClick={() => setActivePage('written-setup')}><span>⌘</span><b>笔试助手</b></button>
          <div className="lite-nav-foot"><i className={mobileConnected ? 'online' : ''} />{mobileConnected ? '手机已连接' : '电脑端在线'}</div>
        </nav>}

        <main className="lite-page-wrap">
          {activePage === 'home' && (
            <section className="lite-home">
              <div className="lite-hero">
                <div className="lite-hero-content">
                  <div className="lite-hero-account">
                    <h1>{hasValidAuth ? `${greeting}，${authState?.username || username}` : '欢迎使用秒答'}</h1>
                    {hasValidAuth && <button type="button" className="lite-logout-button" disabled={isLoggingOut} onClick={() => void logout()}>{isLoggingOut ? '正在退出…' : '退出登录'}</button>}
                  </div>
                </div>
              </div>
              <div className="lite-home-grid">
                <button className="lite-home-card interview" onClick={() => setActivePage('interview-setup')}>
                  <span className="lite-home-card-icon">01</span><div><b>面试助手</b><small>实时听题，生成可直接口述的回答。</small></div><i>进入配置 <span>→</span></i>
                </button>
                <button className="lite-home-card written" onClick={() => setActivePage('written-setup')}>
                  <span className="lite-home-card-icon">02</span><div><b>笔试助手</b><small>识别屏幕题目，生成完整解法与思路。</small></div><i>进入配置 <span>→</span></i>
                </button>
              </div>
              <section className="lite-home-status">
                <div className="lite-home-status-head"><i aria-hidden="true" /><div><span>当前配置</span><small>岗位与偏好</small></div></div>
                <div className="lite-home-context">
                  <div className="job"><span><i aria-hidden="true">岗</i>目标岗位</span><b>{activeJob}</b><small>{category.label}</small></div>
                  <div className="language"><span><i aria-hidden="true">文</i>回答语言</span><b>{LANGUAGES[language].label}</b><small>{interviewTranslationActive ? interviewTranslationModeLabel(translationMode) : '不翻译'}</small></div>
                  <div className="privacy"><span><i aria-hidden="true">隐</i>隐身保护</span><b className={privacyMode ? 'safe' : ''}>{privacyMode ? '已开启' : '未开启'}</b></div>
                </div>
              </section>
              {hasValidAuth && authState?.authMode === 'account' && <section className="lite-card-redemption">
                <div className="lite-redemption-icon" aria-hidden="true">券</div>
                <div className="lite-redemption-copy"><b>兑换卡密</b><small>输入购买的卡密，面试与笔试额度会立即充值到当前账号。</small></div>
                <form onSubmit={(event) => { event.preventDefault(); void redeemCard(); }}>
                  <input aria-label="兑换卡密" autoComplete="off" spellCheck={false} value={redeemCardKey} onChange={(event) => setRedeemCardKey(event.target.value)} placeholder="MD-XXXX-XXXX-XXXX" disabled={isRedeeming} />
                  <button type="submit" disabled={isRedeeming || !redeemCardKey.trim()}>{isRedeeming ? '兑换中…' : '立即兑换'}</button>
                  <button type="button" className="lite-buy-card-button" onClick={() => void window.electronAPI.openExternal?.(CARD_SHOP_URL)}>购买卡密</button>
                </form>
                {redeemError && <p className="error" role="alert">{redeemError}</p>}
              </section>}
              <section className="lite-mobile-pairing">
                <div className="lite-mobile-icon" aria-hidden="true">↗</div>
                <div className="lite-mobile-copy"><b>手机端同步</b><small>{mobileConnected ? '已连接，可同步查看答案。' : pairing ? '等待手机扫码连接。' : '扫码后可在手机查看答案。'}</small></div>
                {!pairing && <button onClick={() => void createMobilePairing()}>{mobileConnected ? '管理连接' : '连接手机'}<span>→</span></button>}
                {pairing && <div className="lite-pairing-body">{pairingQr && <img src={pairingQr} alt="手机配对二维码" />}<div className="lite-pairing-details"><strong>{pairing.code}</strong><small>二维码、网址和配对码 120 秒内有效</small>{pairing.qrUrl && <div className="lite-pairing-url"><label><span>手机访问网址</span><input aria-label="手机端配对网址" readOnly value={pairing.qrUrl} title={pairing.qrUrl} onFocus={(event) => event.currentTarget.select()} /></label><button type="button" onClick={() => void copyPairingUrl()}>{pairingCopyStatus === 'copied' ? '已复制' : pairingCopyStatus === 'error' ? '复制失败' : '复制网址'}</button></div>}<button type="button" className="lite-pairing-regenerate" onClick={() => void createMobilePairing()}>重新生成</button>{pairingCopyStatus === 'error' && <small className="lite-pairing-copy-error">复制失败，请选中网址后手动复制</small>}</div></div>}
                {pairingError && <p>{pairingError}</p>}
              </section>
            </section>
          )}

          {activePage === 'interview-setup' && (
            <section className="lite-interview-setup">
              <div className="lite-page-heading"><div><h1>面试助手配置</h1></div><button onClick={() => setActivePage('home')}>返回主页</button></div>
              <div className="lite-setup-scroll">
                <section className="lite-setup-panel"><div className="lite-section-head"><div><h2>个人简历</h2></div></div><textarea className="lite-resume-input" value={resumeText} onChange={(event) => setResumeText(event.target.value)} placeholder="填写专业技能、项目经历" /></section>
                <section className="lite-setup-panel"><div className="lite-section-head"><div><h2>选择岗位</h2></div><span>{activeJob}</span></div><div className="lite-job-picker"><label className="lite-job-domain">选择领域<select value={selectedCategory} onChange={(event) => changeCategory(event.target.value as JobCategoryKey)}>{JOB_CATEGORIES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label><label className="lite-job-role">具体岗位<select value={selectedJob} onChange={(event) => setSelectedJob(event.target.value)}>{category.jobs.map((job) => <option key={job} value={job}>{job}</option>)}</select></label></div><input className="lite-manual-job" value={manualJob} onChange={(event) => setManualJob(event.target.value)} placeholder="也可以手动输入岗位，例如：AI应用产品经理" /></section>
                <section className="lite-setup-panel lite-setup-language"><h2>语言与翻译</h2><div className="lite-interview-language-options"><label>面试语言<select value={language} onChange={(event) => setLanguage(normalizeInterviewLanguage(event.target.value))}><InterviewLanguageOptions /></select></label><label>翻译为中文<select aria-label="选择面试翻译模式" value={interviewTranslationActive ? translationMode : 'off'} disabled={responseLanguage === 'Chinese'} onChange={(event) => changeInterviewTranslationMode(event.target.value)}><InterviewTranslationModeOptions /></select></label></div><p>{responseLanguage === 'Chinese' ? '中文面试无需翻译。' : '开启后，英文题目实时翻译；答案生成完成后整段翻译。'}</p></section>
              </div>
              <footer className="lite-setup-actions"><button className="primary" onClick={() => void requestAssistantLaunch('interview')}>开始面试</button></footer>
            </section>
          )}

          {activePage === 'written-setup' && (
            <section className="lite-written-setup"><div className="lite-page-heading"><div><h1>笔试助手配置</h1></div><button onClick={() => setActivePage('home')}>返回主页</button></div><div className="lite-setup-scroll"><section className="lite-setup-panel lite-setup-language"><div className="lite-section-head"><div><h2>代码语言</h2><p>仅在识别为代码题时使用，其他题型会自动选择合适的回答方式。</p></div><span>{writtenStatus}</span></div><select value={writtenLanguage} onChange={(event) => changeWrittenLanguage(event.target.value)}><WrittenLanguageOptions /></select></section></div><footer className="lite-setup-actions"><button className="primary" onClick={() => void requestAssistantLaunch('written')}>开始笔试</button></footer></section>
          )}

              {activePage === 'interview' && (
                <section className="lite-assistant-page"><div className="lite-status-row"><span className="lite-pill">{status}</span><span className="lite-pill context">{activeJob} / {LANGUAGES[language].label}{interviewTranslationActive ? ` / ${interviewTranslationModeLabel(translationMode)}` : ''}</span></div><div ref={answersRef} className="lite-answers">{cards.length === 0 && !liveTranscript ? <div className="lite-empty">开始后会监听电脑声音，识别到完整问题后自动生成回答。</div> : cards.map((card) => <article key={card.id} className="lite-card"><InterviewCardContent card={card} compact={false} /></article>)}{liveTranscript && <article className="lite-card lite-question-stream" aria-live="polite"><div className="lite-question">{liveTranscript}</div>{(liveTranscriptTranslation || liveTranscriptTranslationLoading || liveTranscriptTranslationError) && <div className="interview-translation question">{liveTranscriptTranslation && <div>{liveTranscriptTranslation}</div>}{!liveTranscriptTranslation && liveTranscriptTranslationLoading && <small>正在翻译稳定片段…</small>}{liveTranscriptTranslationError && <small className="error">{liveTranscriptTranslationError}</small>}</div>}<div className="lite-meta">{liveTranscriptHint}</div></article>}</div>{manualQuestionOpen && <form className="lite-manual-question" onSubmit={submitManual}><textarea ref={manualQuestionInputRef} aria-label="手动输入面试问题" value={manualQuestion} placeholder="输入面试问题，按 Enter 发送" disabled={manualQuestionSubmitting} onChange={(event) => setManualQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); cancelManualQuestion(); } else if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} /><button type="submit" className="primary" disabled={manualQuestionSubmitting || !manualQuestion.trim()}>{manualQuestionSubmitting ? '生成中…' : '发送'}</button><button type="button" onClick={cancelManualQuestion}>取消</button><span role="status">{manualQuestionSubmitting ? '正在生成回答，请稍候…' : 'Enter 发送 · Shift + Enter 换行 · Esc 取消'}</span></form>}<footer className="lite-controls"><button className="primary" onClick={() => void startInterview()} disabled={isListening}>开始</button><button onClick={() => void stopInterview()} disabled={!isListening}>停止</button><button onClick={clearInterviewAnswers}>清空</button><button aria-expanded={manualQuestionOpen} onClick={() => setManualQuestionOpen(true)}>手动提问</button></footer></section>
              )}

          {activePage === 'written' && (
            <section className="lite-assistant-page"><div className="lite-status-row"><span className="lite-pill">{writtenStatus}</span><button type="button" className="lite-written-solve-mode" aria-label="切换笔试解题模式" onClick={() => changeWrittenSolveMode(writtenSolveMode === 'code' ? 'leetcode' : 'code')}>{writtenSolveModeLabel(writtenSolveMode)}</button><label className="lite-written-language-switch">语言<select aria-label="切换笔试代码语言" value={writtenLanguage} onChange={(event) => changeWrittenLanguage(event.target.value)}><WrittenLanguageOptions /></select></label></div><div ref={writtenAnswersRef} className="lite-answers">{writtenHistory.length ? writtenHistory.map((item) => <article key={item.id} className="lite-card"><div className="lite-question">{item.question}</div><div className={item.loading ? 'lite-answer loading' : 'lite-answer'}>{formatCardText(item.answer)}</div>{item.loading && <div className="lite-meta">生成中</div>}</article>) : <div className="lite-empty">识别新题目后，历史题目会保留在这里。</div>}</div><footer className="lite-controls"><button className="primary" onClick={() => void captureWrittenScreen()} disabled={writtenLoading}>{writtenLoading ? writtenLoadingText : '识别整屏'}</button><button onClick={() => setActivePage('written-setup')}>返回设置</button></footer></section>
          )}
        </main>
      </div>

      {interviewQuotaNotice}
      {writtenQuotaNotice}
      {redemptionSuccessNotice}
      {authModalOpen && (
        <div className="lite-start-auth-backdrop" role="dialog" aria-modal="true" aria-labelledby="lite-start-auth-title">
          <form className="lite-start-auth-modal" onSubmit={login}>
            <button type="button" className="lite-start-auth-close" aria-label="关闭登录窗口" onClick={() => { setAuthModalOpen(false); setPendingAssistantLaunch(null); setLoginError(''); setPassword(''); }}>×</button>
            <span>身份验证</span>
            <h2 id="lite-start-auth-title">{pendingAssistantLaunch ? `登录后开始${pendingAssistantLaunch === 'interview' ? '面试' : '笔试'}` : '登录账户并查看额度'}</h2>
            <p>{pendingAssistantLaunch ? '当前配置已经保存，登录成功后将打开顶部独立工作窗口。' : '使用官网注册的用户名和密码登录，卡密可在客户端主页兑换。'}</p>
            <label><span>用户名</span><input autoFocus autoComplete="username" spellCheck={false} value={username} onChange={(event) => setUsername(event.target.value)} placeholder="请输入用户名" /></label>
            <label><span>密码</span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="8～24 位密码" /></label>
            {loginError && <div className="lite-start-auth-error" role="alert">{loginError}</div>}
            <button className="lite-start-auth-submit" type="submit" disabled={isLoggingIn}>{isLoggingIn ? '正在登录...' : pendingAssistantLaunch ? `登录并开始${pendingAssistantLaunch === 'interview' ? '面试' : '笔试'}` : '登录账户'}</button>
            <button className="lite-auth-account-link" type="button" onClick={() => { setAuthModalOpen(false); setPendingAssistantLaunch(null); setAuthMode('register'); setAuthState({ isAuthenticated: false }); setLoginError(''); setPassword(''); setConfirmPassword(''); }}>在客户端注册账户</button>
          </form>
        </div>
      )}
    </div>
  );
}
