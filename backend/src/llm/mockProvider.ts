import { createHash } from 'node:crypto';
import { convertArrayToReadableStream, MockEmbeddingModelV4, MockLanguageModelV4 } from 'ai/test';
import { embeddingRoute, type ModelRef } from './models.js';

// Stand-in providers for LLM_MOCK=1: the whole app runs with no model calls, so the web
// app's browser tests (and a laptop without keys) get real chat, study and memory flows.
// Deterministic: the same prompt always gets the same reply.
//
// Language model: with tools and no result yet, it searches the sources for the user's
// question; given a result, it answers in two sentences citing [1]. A structured call
// (responseFormat json) gets the smallest object its schema accepts, except study sets,
// whose checks need real counts, so those get a small valid set.

// The provider-level call shape, taken from what the mock model's doGenerate receives.
type MockOptions = NonNullable<ConstructorParameters<typeof MockLanguageModelV4>[0]>;
type CallOptions = Parameters<
  Extract<NonNullable<MockOptions['doGenerate']>, (...args: never[]) => unknown>
>[0];
type Prompt = CallOptions['prompt'];

const usage = (input: number, output: number) => ({
  inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: undefined },
  outputTokens: { total: output, text: output, reasoning: undefined },
});

type Reply =
  { kind: 'text'; text: string } | { kind: 'tool'; name: string; input: Record<string, unknown> };

function lastUserText(prompt: Prompt) {
  for (let i = prompt.length - 1; i >= 0; i--) {
    const message = prompt[i]!;
    if (message.role !== 'user') continue;
    return message.content
      .flatMap((part) => (part.type === 'text' ? [part.text] : []))
      .join('\n')
      .trim();
  }
  return '';
}

function toolResults(prompt: Prompt) {
  return prompt
    .filter((message) => message.role === 'tool')
    .flatMap((message) => message.content)
    .map((part) => JSON.stringify(part));
}

function decide(options: CallOptions): Reply {
  const { prompt, tools = [], responseFormat } = options;
  if (responseFormat?.type === 'json' && responseFormat.schema) {
    const value = studySet(responseFormat.schema) ?? sampleFor(responseFormat.schema);
    return { kind: 'text', text: JSON.stringify(value) };
  }
  const results = toolResults(prompt);
  const search = tools.find((tool) => tool.name === 'search_sources');
  if (search && results.length === 0) {
    const question = lastUserText(prompt).split('\n').at(-1)?.slice(0, 200) || 'overview';
    return { kind: 'tool', name: search.name, input: { query: question } };
  }
  const found = results.some((result) => !result.includes('Nothing found'));
  return {
    kind: 'text',
    text: found
      ? 'The sources cover this directly: the passage explains it in plain terms [1]. In short, the answer follows from what that passage describes [1].'
      : 'The sources do not cover this, so there is nothing to cite. Try asking about what they contain.',
  };
}

/** A valid study set when the schema is one of the four study outputs, else undefined. */
function studySet(schema: unknown) {
  const keys = Object.keys((schema as JsonSchema).properties ?? {});
  const has = (...names: string[]) => names.every((name) => keys.includes(name));
  const cite = [1];

  if (has('questions')) {
    const topics = ['storage', 'replication', 'partitioning', 'transactions', 'consistency'];
    return {
      title: 'Sample quiz',
      questions: topics.map((topic, i) => ({
        question: `Which statement about ${topic} does the material support?`,
        options: [
          `A claim about ${topic}`,
          'An unrelated claim',
          'A reversed claim',
          'A claim the material never makes',
        ],
        answerIndex: i % 4,
        explanation: `The passage on ${topic} states this directly.`,
        difficulty: (['easy', 'medium', 'hard'] as const)[i % 3],
        citations: cite,
      })),
    };
  }
  if (has('cards')) {
    return {
      title: 'Sample flashcards',
      cards: ['Leader', 'Follower', 'Replication lag', 'Quorum', 'Partition'].map((term) => ({
        front: term,
        back: `${term}: a short definition taken from the material.`,
        citations: cite,
      })),
    };
  }
  if (has('nodes')) {
    return {
      title: 'Sample map',
      nodes: [
        { id: 'root', parentId: null, label: 'Main idea', citations: cite },
        { id: 'a', parentId: 'root', label: 'First branch', citations: cite },
        { id: 'b', parentId: 'root', label: 'Second branch', citations: cite },
        { id: 'a1', parentId: 'a', label: 'Detail of the first branch', citations: cite },
        { id: 'b1', parentId: 'b', label: 'Detail of the second branch', citations: cite },
      ],
    };
  }
  if (has('sections', 'keyTerms')) {
    return {
      title: 'Sample summary',
      sections: [
        {
          heading: 'Overview',
          bullets: [
            { text: 'The material introduces the main ideas first.', citations: cite },
            { text: 'Later sections build on them with detail.', citations: cite },
          ],
        },
      ],
      keyTerms: [
        { term: 'Term', definition: 'A short definition from the material.', citations: cite },
      ],
    };
  }
  return undefined;
}

type JsonSchema = {
  type?: string | string[];
  enum?: unknown[];
  const?: unknown;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  minItems?: number;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  $ref?: string;
  $defs?: Record<string, JsonSchema>;
  definitions?: Record<string, JsonSchema>;
};

/** The smallest value a JSON schema accepts, so structured calls validate. */
export function sampleFor(root: unknown): unknown {
  const defs = {
    ...((root as JsonSchema).definitions ?? {}),
    ...((root as JsonSchema).$defs ?? {}),
  };
  const build = (schema: JsonSchema, depth: number): unknown => {
    if (schema.$ref) {
      const name = schema.$ref.split('/').at(-1)!;
      return depth > 6 ? null : build(defs[name] ?? {}, depth + 1);
    }
    if (schema.const !== undefined) return schema.const;
    if (schema.enum?.length) return schema.enum[0];
    const union = schema.anyOf ?? schema.oneOf;
    if (union?.length) return build(union[0]!, depth);
    const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
    switch (type) {
      case 'object': {
        const keys = schema.required ?? Object.keys(schema.properties ?? {});
        return Object.fromEntries(
          keys.map((key) => [key, build(schema.properties?.[key] ?? {}, depth + 1)]),
        );
      }
      case 'array': {
        const count = Math.max(schema.minItems ?? 1, 1);
        return Array.from({ length: count }, () => build(schema.items ?? {}, depth + 1));
      }
      case 'string': {
        let text = 'Sample text from the mock model.';
        if (schema.minLength && text.length < schema.minLength) {
          text = text.padEnd(schema.minLength, ' sample');
        }
        if (schema.maxLength !== undefined && text.length > schema.maxLength) {
          text = text.slice(0, schema.maxLength);
        }
        return text;
      }
      case 'integer':
      case 'number':
        return schema.minimum ?? 1;
      case 'boolean':
        return true;
      case 'null':
        return null;
      default:
        return schema.properties ? build({ ...schema, type: 'object' }, depth) : null;
    }
  };
  return build(root as JsonSchema, 0);
}

function streamParts(reply: Reply) {
  const parts: unknown[] = [{ type: 'stream-start', warnings: [] }];
  if (reply.kind === 'text') {
    parts.push({ type: 'text-start', id: 't' });
    for (const word of reply.text.split(/(?<= )/)) {
      parts.push({ type: 'text-delta', id: 't', delta: word });
    }
    parts.push({ type: 'text-end', id: 't' });
  } else {
    parts.push({
      type: 'tool-call',
      toolCallId: `mock-${createHash('sha1').update(JSON.stringify(reply.input)).digest('hex').slice(0, 8)}`,
      toolName: reply.name,
      input: JSON.stringify(reply.input),
    });
  }
  parts.push({
    type: 'finish',
    finishReason: { unified: reply.kind === 'tool' ? 'tool-calls' : 'stop', raw: undefined },
    usage: usage(100, 20),
  });
  return parts as never[];
}

const mockModels = new Map<string, MockLanguageModelV4>();

export function mockLanguageModel(ref: ModelRef) {
  let model = mockModels.get(ref.model);
  if (!model) {
    model = new MockLanguageModelV4({
      modelId: ref.model,
      doGenerate: async (options) => {
        const reply = decide(options);
        return {
          content:
            reply.kind === 'text'
              ? [{ type: 'text', text: reply.text }]
              : [
                  {
                    type: 'tool-call',
                    toolCallId: 'mock-call',
                    toolName: reply.name,
                    input: JSON.stringify(reply.input),
                  },
                ],
          finishReason: { unified: reply.kind === 'tool' ? 'tool-calls' : 'stop', raw: undefined },
          usage: usage(100, 20),
          warnings: [],
        };
      },
      doStream: async (options) => ({
        stream: convertArrayToReadableStream(streamParts(decide(options))),
      }),
    });
    mockModels.set(ref.model, model);
  }
  return model;
}

/**
 * Deterministic vector for a text: same text, same vector, across runs. Not unit length,
 * so the caller's normalization gets exercised.
 */
export function fakeVector(text: string, dimensions = embeddingRoute.dimensions) {
  let seed = createHash('sha256').update(text).digest().readUInt32LE(0);
  return Array.from({ length: dimensions }, () => {
    // mulberry32
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 4 - 2;
  });
}

export const fakeEmbed = async ({ values }: { values: string[] }) => ({
  embeddings: values.map((value) => fakeVector(value)),
  warnings: [],
});

export const mockEmbeddingModel = new MockEmbeddingModelV4({
  maxEmbeddingsPerCall: 100,
  doEmbed: fakeEmbed,
});
