import { createGoogle } from '@ai-sdk/google';
import { createGroq } from '@ai-sdk/groq';
import type { EmbeddingModel, LanguageModel } from 'ai';
import { serverConfig } from '../config/index.js';
import { mockEmbeddingModel, mockLanguageModel } from './mockProvider.js';
import type { ModelRef } from './models.js';

// The only place that talks to provider SDKs; tests replace this module with mocks, and
// LLM_MOCK=1 (never in production) swaps in the scripted models for browser tests.
// There is one client per key, in the order the keys are listed, and a ModelRef's `key`
// picks one. With no key configured there is still one client, whose calls fail for want
// of a key.
function clientsFor<T>(keys: string[], create: (apiKey: string | undefined) => T) {
  return (keys.length > 0 ? keys : [undefined]).map(create);
}

const groq = clientsFor(serverConfig.GROQ_API_KEYS, (apiKey) => createGroq({ apiKey }));
const google = clientsFor(serverConfig.GEMINI_API_KEYS, (apiKey) => createGoogle({ apiKey }));

function clientFor<T>(clients: T[], ref: ModelRef) {
  const client = clients[ref.key ?? 0];
  if (!client) throw new Error(`No key #${(ref.key ?? 0) + 1} for ${ref.provider}`);
  return client;
}

export function languageModel(ref: ModelRef): LanguageModel {
  if (serverConfig.LLM_MOCK) return mockLanguageModel(ref);
  return ref.provider === 'groq'
    ? clientFor(groq, ref)(ref.model)
    : clientFor(google, ref)(ref.model);
}

export function embeddingModel(ref: ModelRef): EmbeddingModel {
  if (ref.provider !== 'google') throw new Error(`No embedding models on ${ref.provider}`);
  if (serverConfig.LLM_MOCK) return mockEmbeddingModel;
  return clientFor(google, ref).embedding(ref.model);
}
