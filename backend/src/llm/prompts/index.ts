import { agentSystemPrompt } from './agentSystem.js';
import { contextualizePrompt } from './contextualize.js';
import { contextualizeCodePrompt } from './contextualizeCode.js';
import { decomposePrompt } from './decompose.js';
import { hydePrompt } from './hyde.js';
import type { PromptTemplate } from './registry.js';
import { rewritePrompt } from './rewrite.js';
import { studyCondensePrompt } from './studyCondense.js';
import { studyFlashcardsPrompt } from './studyFlashcards.js';
import { studyMindmapPrompt } from './studyMindmap.js';
import { studyQuizPrompt } from './studyQuiz.js';
import { studySummaryPrompt } from './studySummary.js';
import { summarizeConversationPrompt } from './summarizeConversation.js';
import { titlePrompt } from './title.js';

// Every prompt the app uses, so the hash check in registry.test.ts covers them all.
// Each phase adds its prompts here as it writes them.
export const prompts: readonly PromptTemplate[] = [
  contextualizePrompt,
  contextualizeCodePrompt,
  rewritePrompt,
  hydePrompt,
  decomposePrompt,
  agentSystemPrompt,
  titlePrompt,
  summarizeConversationPrompt,
  studyQuizPrompt,
  studyFlashcardsPrompt,
  studyMindmapPrompt,
  studySummaryPrompt,
  studyCondensePrompt,
];
