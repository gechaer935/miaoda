export function isChineseLanguageKey(value?: string | null): boolean {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === 'chinese'
    || normalized === 'zh'
    || normalized === 'zh-cn'
    || normalized === 'zh-tw'
    || normalized === '中文'
    || normalized === '简体中文'
    || normalized === '繁体中文';
}

export function preferChineseResponse(aiResponseLanguage?: string | null, sttLanguage?: string | null): boolean {
  const ai = String(aiResponseLanguage ?? '').trim();
  if (ai && ai.toLowerCase() !== 'auto') return isChineseLanguageKey(ai);
  return isChineseLanguageKey(sttLanguage);
}

export function autoLanguageFallbackName(sttLanguage?: string | null): string {
  if (isChineseLanguageKey(sttLanguage)) return 'Simplified Chinese';
  return 'English';
}

export function localizedNoContextFromConversation(aiResponseLanguage?: string | null, sttLanguage?: string | null): string {
  return preferChineseResponse(aiResponseLanguage, sttLanguage)
    ? '我现在还没有足够的对话上下文来回答这个问题。'
    : "I don't have enough context from the conversation to answer that yet.";
}

export function localizedComeBack(aiResponseLanguage?: string | null, sttLanguage?: string | null): string {
  return preferChineseResponse(aiResponseLanguage, sttLanguage)
    ? '我稍后再回答这个问题。'
    : 'Let me come back to that in just a moment.';
}

export function localizedNeedMore(aiResponseLanguage?: string | null, sttLanguage?: string | null): string {
  return preferChineseResponse(aiResponseLanguage, sttLanguage)
    ? '你能再补充一点上下文吗？'
    : 'Could you give me a bit more to go on?';
}

export function localizedSalesNeedMore(aiResponseLanguage?: string | null, sttLanguage?: string | null): string {
  return preferChineseResponse(aiResponseLanguage, sttLanguage)
    ? '我现在对这一点的上下文还不够，你能再补充一点吗？'
    : "I don't have enough context on that yet — could you share a bit more?";
}
