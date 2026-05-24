// searchStopwords.ts
//
// PikTag's search box invites natural-language queries ("找在扶輪社的
// 朋友", "想找會講日文的人", "looking for designers in SF") — that IS
// the product promise. But the backend does substring ilike on tag
// names and profile fields, so a literal phrase like "找在扶輪社的朋友"
// matches nothing. This module reduces a natural-language query to its
// content nouns by stripping the scaffolding around them.
//
// Conservative on purpose. Two principles:
//   1. Strip multi-character phrases anywhere; strip single-character
//      Chinese particles only with restrictions (mid-string single-char
//      removal would mangle 人脈→脈, 認識→識, etc).
//   2. If stripping leaves an empty string, fall back to the literal
//      query — never make the search worse than the original.

const ZH_PREFIX = [
  // Try longest first; the iterator strips repeatedly until nothing matches.
  '我想找一個', '我想找個', '我想找',
  '想找一個', '想找個', '想找',
  '我想認識', '想認識', '認識一下',
  '幫我找一個', '幫我找個', '幫我找',
  '請幫我找', '請介紹一下', '請介紹',
  '介紹一個', '介紹給我', '介紹一下', '介紹',
  '尋找一位', '尋找一個', '尋找',
  '找一位', '找一個', '找個',
  '我想要找', '我想要', '想要找', '想要',
  '我想', '我要',
  '誰知道', '誰認識', '誰是', '誰會', '誰',
  '有沒有', '有誰',
  '會說', '會講', '會',
  '在哪裡', '在哪', '在',
  '想', '找',
];

const ZH_SUFFIX = [
  '介紹給我', '給我認識', '給我',
  '的朋友', '的人', '的會員', '的同學', '的同事',
  '的同好', '的夥伴', '的伙伴',
  '的客戶', '的老師', '的學生',
  '在哪裡', '在哪',
  '嗎', '呢', '吧', '啊',
  // Bare nouns at the END of a phrase are usually filler ("台北的設計師
  // 朋友"); we only strip these after the longer "的朋友" form has been
  // tried, so we keep iter order — longer first.
  '朋友', '同學', '同事',
  '?', '？', '。',
];

const EN_PREFIX = [
  "i'm looking for", 'im looking for', 'i am looking for',
  'looking for',
  'i want to find', 'i want to meet', 'i want to know',
  'i want', 'i need',
  "i'd like to find", 'id like to find', "i'd like", 'id like',
  'help me find', 'find me', 'introduce me to',
  'who knows', 'who is', "who's",
  'anyone who knows', 'anyone who is', "anyone who's",
  'anyone with', 'anyone',
  'find', 'meet', 'know',
];

const EN_SUFFIX = [
  'please', 'pls', 'thanks', 'thx',
];

const EN_FUNCTION_WORDS = /\b(a|an|the|of|in|on|at|to|for|with|by|from|that|this|who|whose|whom|my|your|his|her|their|me|am|is|are|was|were|do|does|did|can|could|would|should|will|shall)\b/gi;

// Tokens that are NEVER content on their own. Applied AFTER splitting
// the stripped query into keywords. Anything in here, dropped.
const LONE_STOPWORD_TOKENS = new Set<string>([
  '朋友', '人', '我', '找', '想', '會', '的', '了', '誰',
  '吧', '啊', '嗎', '呢',
  'a', 'an', 'the', 'i', 'me', 'my', 'you', 'who',
  'someone', 'anyone',
  'friend', 'friends', 'people', 'person',
  '@', '&', '|',
]);

function stripPrefixIterative(input: string, patterns: string[], caseInsensitive = false): string {
  let s = input;
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of patterns) {
      const test = caseInsensitive ? s.toLowerCase() : s;
      const pat = caseInsensitive ? p.toLowerCase() : p;
      if (test.startsWith(pat)) {
        s = s.slice(p.length).trimStart();
        changed = true;
        break;
      }
    }
  }
  return s;
}

function stripSuffixIterative(input: string, patterns: string[], caseInsensitive = false): string {
  let s = input;
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of patterns) {
      const test = caseInsensitive ? s.toLowerCase() : s;
      const pat = caseInsensitive ? p.toLowerCase() : p;
      if (test.endsWith(pat)) {
        s = s.slice(0, s.length - p.length).trimEnd();
        changed = true;
        break;
      }
    }
  }
  return s;
}

/**
 * Reduce a natural-language query to its content nouns. Idempotent and
 * pure — safe to call multiple times. Falls back to the original on
 * any over-strip.
 */
export function stripSearchStopwords(raw: string): string {
  const original = raw.trim();
  if (!original) return original;
  let s = original;
  s = stripPrefixIterative(s, ZH_PREFIX);
  s = stripSuffixIterative(s, ZH_SUFFIX);
  s = stripPrefixIterative(s, EN_PREFIX, true);
  s = stripSuffixIterative(s, EN_SUFFIX, true);
  // EN function words anywhere (with word boundaries — so "in" doesn't
  // touch "find" or "Mainland").
  s = s.replace(EN_FUNCTION_WORDS, ' ');
  // ZH soft separators — turn 的/了 into a SPACE, not nothing, so
  // adjacent content nouns split into separate tokens ("台北的設計師"
  // → "台北 設計師", not the useless "台北設計師" concatenation).
  s = s.split('的').join(' ').split('了').join(' ');
  // Collapse whitespace runs.
  s = s.trim().replace(/\s+/g, ' ');
  return s || original;
}

/**
 * Drop tokens that are common stopwords on their own (after splitting
 * the stripped query). e.g. ["找", "PM", "朋友"] → ["PM"].
 */
export function filterLoneStopwordTokens(tokens: string[]): string[] {
  return tokens.filter((t) => !LONE_STOPWORD_TOKENS.has(t.toLowerCase()));
}
