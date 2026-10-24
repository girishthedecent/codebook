import { Tiktoken } from 'js-tiktoken/lite';
import o200kBase from 'js-tiktoken/ranks/o200k_base';

// o200k is the tokenizer of the gpt-oss models, so counts are exact for Groq and close
// (within ~10%) for Gemini, whose tokenizer isn't public. Good enough for chunk sizes and
// context budgets, not for billing.
let encoder: Tiktoken | undefined;

// js-tiktoken merges each pre-split piece in quadratic time, and a piece can be a whole run
// of letters, symbols or whitespace: 5,000 letters take 4s, 20,000 a minute, and even 100
// take over a millisecond. Such runs (base64 blobs, separators, padding) are estimated from
// a short sample instead; chunk sizes don't need them exact. The classes are the
// tokenizer's own (letters with combining marks, symbols, whitespace); digits are already
// split into threes.
const LONG_RUN = /[\p{L}\p{M}]{32,}|[^\s\p{L}\p{N}]{32,}|\s{32,}/gu;
const SAMPLE = 32;

export function countTokens(text: string) {
  encoder ??= new Tiktoken(o200kBase);
  let estimated = 0;
  let rest = '';
  let last = 0;
  for (const match of text.matchAll(LONG_RUN)) {
    rest += `${text.slice(last, match.index)} `;
    const run = match[0];
    const sampled = encoder.encode(run.slice(0, SAMPLE)).length;
    estimated += Math.ceil((sampled * run.length) / SAMPLE);
    last = match.index + run.length;
  }
  if (last === 0) return encoder.encode(text).length;
  return estimated + encoder.encode(rest + text.slice(last)).length;
}
