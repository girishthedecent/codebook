import { createGoogle } from '@ai-sdk/google';
import { createGroq } from '@ai-sdk/groq';
import type { EmbeddingModel, LanguageModel } from 'ai';
import { serverConfig } from '../config/index.js';
import { mockEmbeddingModel, mockLanguageModel } from './mockProvider.js';
import type { ModelRef } from './models.js';

// The only place that talks to provider SDKs; tests replace this module with mocks, and
// LLM_MOCK=1 (never in production) swaps in the scripted models for browser tests.
const groq = createGroq({ apiKey: serverConfig.GROQ_API_KEY });
const google = createGoogle({ apiKey: serverConfig.GEMINI_API_KEY });

export function languageModel(ref: ModelRef): LanguageModel {
  if (serverConfig.LLM_MOCK) return mockLanguageModel(ref);
  return ref.provider === 'groq' ? groq(ref.model) : google(ref.model);
}

export function embeddingModel(ref: ModelRef): EmbeddingModel {
  if (ref.provider !== 'google') throw new Error(`No embedding models on ${ref.provider}`);
  if (serverConfig.LLM_MOCK) return mockEmbeddingModel;
  return google.embedding(ref.model);
}
