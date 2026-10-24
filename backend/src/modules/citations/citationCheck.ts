import type { CitationRegistry } from './citationRegistry.js';
import type { CheckedCitation, CitationRef } from './citations.types.js';

const MARKER = /\[(\d+(?:\s*,\s*\d+)*)\]/g;
const FENCE = /```[\s\S]*?(```|$)/g;
// `arr[0]` in inline code isn't a citation.
const INLINE_CODE = /`[^`\n]*`/g;
const WORD = /[a-z0-9_$.]+/g;
// Words too common to show that a sentence and a passage say the same thing.
const STOP = new Set(
  'the a an and or but of to in on for with by from as at is are was were be been it its this that these those which who what when where how why can could should would will may might not no yes into than then there their they them we you your our has have had do does did so such also more most other some any each all only one two'.split(
    ' ',
  ),
);

const SNIPPET_CHARS = 300;

// gpt-oss sometimes cites in its own format, 【2†L10-L12】, whatever the prompt says.
const FOREIGN_MARKER = /【(\d+)†[^】]*】/g;

/** Rewrites other citation formats to [n], so they are checked and shown like the rest. */
export function normalizeCitations(answer: string) {
  return answer.replace(FOREIGN_MARKER, '[$1]');
}

export type CitationReport = {
  citations: CheckedCitation[];
  // Markers that point at no passage the model was shown.
  invalid: number;
  // Sentences of prose that make a claim without any marker.
  uncitedSentences: number;
};

function words(text: string) {
  return (text.toLowerCase().match(WORD) ?? [])
    .map((word) => word.replace(/^[.$]+|[.$]+$/g, ''))
    .filter((word) => word.length > 2 && !STOP.has(word));
}

/**
 * Whether a sentence is backed by the passage it cites, without asking a model: enough of
 * its words appear in the passage, or it names an identifier the passage contains (code).
 */
function supports(sentence: string, ref: CitationRef, minOverlap: number) {
  const claim = words(sentence);
  if (claim.length === 0) return true;
  const source = new Set(words(ref.text));
  const shared = claim.filter((word) => source.has(word));
  // A shared code identifier (res.send, max_retries) is enough on its own.
  const identifier = shared.some((word) => /[._$]/.test(word));
  return identifier || shared.length / claim.length >= minOverlap;
}

function sentencesOf(answer: string) {
  const parts = answer
    .replace(FENCE, '\n')
    .replace(INLINE_CODE, 'code')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  // "Salts are random. [1]": a marker standing alone belongs to the sentence before it.
  const sentences: string[] = [];
  for (const part of parts) {
    const markerOnly = part.replace(MARKER, '').trim() === '';
    if (markerOnly && sentences.length > 0) sentences[sentences.length - 1] += ` ${part}`;
    else sentences.push(part);
  }
  return sentences;
}

function snippetOf(ref: CitationRef) {
  const text = ref.text.replace(/\s+/g, ' ').trim();
  return text.length > SNIPPET_CHARS ? `${text.slice(0, SNIPPET_CHARS)}…` : text;
}

/**
 * Checks every [n] in an answer against the passages of this turn: numbers that point
 * nowhere are invalid, and each cited passage is marked supported when at least one
 * sentence citing it shares enough with it.
 */
export function checkCitations(
  answer: string,
  registry: CitationRegistry,
  minOverlap: number,
): CitationReport {
  const support = new Map<number, boolean>();
  const invalidNumbers = new Set<number>();
  let uncitedSentences = 0;

  for (const sentence of sentencesOf(answer)) {
    const numbers = [...sentence.matchAll(MARKER)].flatMap((match) =>
      match[1]!.split(',').map((n) => Number(n.trim())),
    );
    if (numbers.length === 0) {
      // Headings, list stubs and questions back to the user aren't claims.
      const prose = sentence.replace(/^[-*#>\d.\s]+/, '');
      if (prose.split(/\s+/).length >= 6 && !prose.endsWith('?') && !prose.endsWith(':')) {
        uncitedSentences += 1;
      }
      continue;
    }
    const claim = sentence.replace(MARKER, ' ');
    for (const n of numbers) {
      const ref = registry.has(n) ? registry.get(n) : undefined;
      if (!ref) {
        invalidNumbers.add(n);
        continue;
      }
      support.set(n, (support.get(n) ?? false) || supports(claim, ref, minOverlap));
    }
  }

  const citations: CheckedCitation[] = [...support]
    .sort(([a], [b]) => a - b)
    .map(([n, supported]) => {
      const { text: _text, ...ref } = registry.get(n)!;
      return { ...ref, valid: true, supported, snippet: snippetOf(registry.get(n)!) };
    });
  for (const n of [...invalidNumbers].sort((a, b) => a - b)) {
    citations.push({
      n,
      kind: 'CHUNK',
      sourceTitle: '',
      valid: false,
      supported: null,
      snippet: '',
    });
  }
  return { citations, invalid: invalidNumbers.size, uncitedSentences };
}
