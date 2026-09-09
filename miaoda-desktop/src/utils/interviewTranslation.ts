export type InterviewTranslationMode = 'off' | 'complete';

export function normalizeInterviewTranslationMode(value: unknown): InterviewTranslationMode {
  // Existing installations may still have the removed sentence mode saved.
  // Preserve their opt-in choice by migrating it to complete-answer translation.
  return value === 'sentence' || value === 'complete' ? 'complete' : 'off';
}

export function interviewTranslationModeLabel(mode: InterviewTranslationMode): string {
  if (mode === 'complete') return '完整答案翻译';
  return '不翻译';
}

export function shouldTranslateInterview(responseLanguage: string, mode: InterviewTranslationMode): boolean {
  return mode !== 'off' && String(responseLanguage || '').trim().toLowerCase() !== 'chinese';
}
