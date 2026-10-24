import { contextualizePrompt } from './contextualize.js';
import { contextualizeCodePrompt } from './contextualizeCode.js';
import { decomposePrompt } from './decompose.js';
import { hydePrompt } from './hyde.js';
import type { PromptTemplate } from './registry.js';
import { rewritePrompt } from './rewrite.js';

// Every prompt the app uses, so the hash check in registry.test.ts covers them all.
// Each phase adds its prompts here as it writes them.
export const prompts: readonly PromptTemplate[] = [
  contextualizePrompt,
  contextualizeCodePrompt,
  rewritePrompt,
  hydePrompt,
  decomposePrompt,
];
