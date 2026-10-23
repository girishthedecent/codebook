import { Tiktoken } from 'js-tiktoken/lite';
import o200kBase from 'js-tiktoken/ranks/o200k_base';

// o200k is the tokenizer of the gpt-oss models, so counts are exact for Groq and close
// (within ~10%) for Gemini, whose tokenizer isn't public. Good enough for chunk sizes and
// context budgets, not for billing.
let encoder: Tiktoken | undefined;

export function countTokens(text: string) {
  encoder ??= new Tiktoken(o200kBase);
  return encoder.encode(text).length;
}
