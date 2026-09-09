/**
 * Filters common Whisper hallucinations.
 * Returns an empty string if the text is a known hallucination,
 * otherwise returns the trimmed text.
 */

const EXACT_BLOCKS = new Set([
  '[music]',
  '[applause]',
  '[inaudible]',
  '(music)',
  'thank you for watching',
  'thanks for watching',
  'you',
  'bye',
  '...',
  '.',
]);

// Matches any token that is entirely wrapped in square brackets e.g. [Noise], [BLANK_AUDIO]
const BRACKET_TOKEN_RE = /^\[.*\]$/;
const CJK_RE = /[\u3400-\u9fff\uf900-\ufaff]/;
const LATIN_WORD_RE = /[A-Za-z]{2,}/g;
const ENGLISH_FUNCTION_WORD_RE = /\b(the|and|or|was|were|is|are|am|a|an|to|of|in|on|for|with|that|this|you|your|i|we|they|he|she|it|first|time|room|woman|man)\b/i;

function isChineseMode(language?: string): boolean {
  const value = (language ?? '').toLowerCase();
  return value === 'chinese' || value === 'zh' || value === 'zh-cn' || value === 'zh-tw';
}

function isLikelyEnglishHallucinationInChineseMode(text: string): boolean {
  if (CJK_RE.test(text)) return false;
  const words = text.match(LATIN_WORD_RE) ?? [];
  if (words.length < 4) return false;

  // Keep short technical fragments like "OpenAI API key" or "REST API".
  if (words.length <= 5 && /(?:api|openai|gpt|llm|http|https|json|sql|cpu|gpu|url|key|token|react|node|python)/i.test(text)) {
    return false;
  }

  return words.length >= 8 || ENGLISH_FUNCTION_WORD_RE.test(text);
}

export function filterHallucination(text: string, options?: { expectedLanguage?: string }): string {
  const trimmed = text.trim();

  // Too short
  if (trimmed.length < 2) return '';

  const lower = trimmed.toLowerCase();

  // Exact match against known hallucinations
  if (EXACT_BLOCKS.has(lower)) return '';

  // Any token that is purely a bracketed tag
  if (BRACKET_TOKEN_RE.test(trimmed)) return '';

  if (isChineseMode(options?.expectedLanguage) && isLikelyEnglishHallucinationInChineseMode(trimmed)) {
    return '';
  }

  return trimmed;
}
