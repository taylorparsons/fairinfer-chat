const MAX_SOURCES = 300;
const MAX_TEXT = 6000;
const stop = new Set('a an and are at be by can could do does for from has have how i in is it many much of on or should that the this to what when where which who will with would you your'.split(' '));
const factTypes = [
  { question: /\b(?:how much|prices?|costs?|fees?|rates?)\b/i,
    terms: /^(?:price|cost|fee|rate)$/, evidence: /[$€£]\s?\d|\b\d+(?:\.\d+)?\s(?:dollars?|euros?|pounds?)\b|\bfree\b/i },
  { question: /\bhow long\b|\bduration\b/i,
    terms: /^(?:long|duration)$/, evidence: /\b\d+(?:\.\d+)?\s*(?:minutes?|hours?|days?|weeks?|months?|years?)\b/i },
  { question: /\bhow many\b/i,
    terms: /^number$/, evidence: /\b(?:\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?!(?:minutes?|hours?|days?|weeks?|months?|years?|dollars?)\b)[\p{L}]+/iu },
  { question: /\bhow often\b/i,
    terms: /^often$/, evidence: /\b(?:daily|weekly|monthly|annually|every|once|twice|per)\b/i },
  { question: /^\s*where\b/i,
    terms: /^location$/, evidence: /\b(?:located|address|room|lobby|courtyard|floor|entrance|street|avenue|building|gate)\b/i },
  { question: /\bwhat time\b|\b(?:opening|closing|open|close) hours\b/i,
    terms: /^(?:time|hour)$/, evidence: /\b(?:\d{1,2}:\d{2}|\d{1,2}\s*[ap]\.?m\.?|noon|midnight|closed)\b/i },
  { question: /\b(?:what date|when (?:is|does|will))\b/i,
    terms: /^date$/, evidence: /\b(?:\d{1,2}:\d{2}|\d{4}|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december)\b/i },
];

function words(value) {
  return new Set((value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter(token => token.length > 1 && !stop.has(token))
    .map(token => token.length > 4 ? token.replace(/(?:sses|[cs]hes)$/, match => match.slice(0, -2)).replace(/(?<!s)s$/, '') : token));
}

function queryRewriter(aliases) {
  if (!aliases || typeof aliases !== 'object' || Array.isArray(aliases)) return question => question;
  const phrase = /^[\p{L}\p{M}\p{N}]+(?: [\p{L}\p{M}\p{N}]+)*$/u;
  const normalize = value => value.toLowerCase().trim().replace(/\s+/gu, ' ');
  const replacements = new Map();
  for (const [from, to] of Object.entries(aliases).slice(0, 64)) {
    if (from.length > 80 || typeof to !== 'string' || to.length > 80) continue;
    const alias = normalize(from);
    const replacement = normalize(to);
    if (phrase.test(alias) && phrase.test(replacement)) replacements.set(alias, replacement);
  }
  if (!replacements.size) return question => question;
  const alternatives = [...replacements.keys()].sort((a, b) => b.length - a.length).join('|');
  const pattern = new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])(?:${alternatives})(?![\\p{L}\\p{M}\\p{N}])`, 'gu');
  return question => normalize(question).replace(pattern, match => replacements.get(match));
}

export function publicLink(value, base) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value, base);
    if (url.username || url.password) return null;
    if (url.protocol === 'https:' || (url.protocol === 'http:' && url.origin === new URL(base).origin)) return url;
  } catch {
    // Malformed links cannot become citations.
  }
  return null;
}

export function normalizeKnowledge(data, base) {
  if (!Array.isArray(data?.sources) || data.sources.length > MAX_SOURCES) {
    throw new Error('Expected a sources array of up to 300 entries.');
  }
  const sources = data.sources.flatMap(row => {
    if (!row || typeof row !== 'object') return [];
    const { id, title, path, text } = row;
    const url = publicLink(path, base);
    if (!url || typeof title !== 'string' || typeof text !== 'string' || !title.trim() || !text.trim()) return [];
    return [{ id, title: title.trim().slice(0, 180), path: url.href, text: text.trim().slice(0, MAX_TEXT) }];
  });
  const starters = Array.isArray(data.starters)
    ? data.starters.filter(text => typeof text === 'string' && text.trim()).slice(0, 4).map(text => text.slice(0, 160))
    : [];
  const index = indexExcerpts(sources);
  const rewrite = queryRewriter(data.aliases);
  const search = question => rankIndexedExcerpts(rewrite(question), index, question);
  return { sources, starters, search };
}

function indexExcerpts(sources) {
  return sources.flatMap(source => {
    const title = words(source.title);
    return source.text.split(/(?<=[.!?])\s+|\n+/u).map(excerpt => excerpt.trim())
      .filter(text => text && text.length <= 550)
      .map(text => ({ source, text, title, body: words(text) }));
  });
}

function rankIndexedExcerpts(question, index, original = question) {
  const kind = factTypes.find(rule => rule.question.test(original))
    ?? factTypes.find(rule => rule.question.test(question));
  const terms = [...words(question)].filter(term => !kind?.terms.test(term));
  if (!terms.length) return [];
  const candidates = [];
  const required = kind ? terms.length : Math.ceil(terms.length * 0.75);
  for (const { source, text, title, body } of index) {
    if (kind && !kind.evidence.test(text)) continue;
    const direct = terms.filter(term => body.has(term)).length;
    const matched = terms.filter(term => body.has(term) || title.has(term)).length;
    if (matched >= required && direct) candidates.push({ source, text, score: matched + direct * 2 });
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates.filter(item => item.score >= candidates[0].score - 1).slice(0, 3);
}

export function rankExcerpts(question, sources) {
  return rankIndexedExcerpts(question, indexExcerpts(sources));
}

export function modelExcerpt(output, candidates) {
  const text = String(output).trim();
  if (text === 'NONE') return null;
  const match = /^S([1-3])\.?$/.exec(text);
  return match ? candidates[Number(match[1]) - 1] : undefined;
}
