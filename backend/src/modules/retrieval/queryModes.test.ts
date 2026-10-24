import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appConfig } from '../../config/app.config.js';
import { textRoutes } from '../../llm/models.js';
import {
  apiError,
  failingModel,
  hangingModel,
  promptModel,
  textModel,
  useModels,
} from '../../../tests/helpers/llm-mock.js';
import { clearQueryModeMemo, expandQuery } from './queryModes.js';

vi.mock('../../llm/providers.js', () => import('../../../tests/helpers/llm-mock.js'));

const { primary, fallback } = textRoutes.rewrite;
const json = (value: unknown) => JSON.stringify(value);

/** A primary model that answers every call with `reply`, counting the calls. */
function answering(reply: unknown) {
  const prompts: string[] = [];
  useModels({
    [primary.model]: promptModel((prompt) => {
      prompts.push(prompt);
      return json(reply);
    }),
  });
  return prompts;
}

beforeEach(() => {
  clearQueryModeMemo();
});

describe('expandQuery', () => {
  it('searches the question as asked in mode none, without a model call', async () => {
    const prompts = answering({});

    const expanded = await expandQuery('What is a B-tree?', 'none');

    expect(expanded).toEqual({
      vectorQueries: [{ text: 'What is a B-tree?', kind: 'query' }],
      keywordQueries: ['What is a B-tree?'],
      rerankQuery: 'What is a B-tree?',
      generated: [],
      fallbackUsed: false,
    });
    expect(prompts).toHaveLength(0);
  });

  it('rewrites a follow-up with the conversation and adds the key terms to keyword search', async () => {
    const prompts = answering({
      question: 'How does res.redirect set the status code?',
      keyTerms: ['res.redirect', 'status', ' ', 'status'],
    });

    const expanded = await expandQuery('and how does it set the status?', 'rewrite', {
      history: [
        { role: 'user', content: 'What does res.redirect do?' },
        { role: 'assistant', content: 'It sends a redirect response.' },
      ],
    });

    expect(prompts[0]).toContain('user: What does res.redirect do?');
    expect(prompts[0]).toContain('assistant: It sends a redirect response.');
    expect(prompts[0]).toContain('and how does it set the status?');
    expect(expanded).toEqual({
      vectorQueries: [{ text: 'How does res.redirect set the status code?', kind: 'query' }],
      keywordQueries: ['How does res.redirect set the status code? res.redirect status'],
      rerankQuery: 'and how does it set the status?',
      generated: ['How does res.redirect set the status code?', 'res.redirect', 'status'],
      fallbackUsed: false,
    });
  });

  it('embeds the HyDE passage as a document and keeps the question for keyword search', async () => {
    answering({ passage: '  A B-tree keeps keys sorted in pages.  ' });

    const expanded = await expandQuery('What is a B-tree?', 'hyde');

    expect(expanded.vectorQueries).toEqual([
      { text: 'A B-tree keeps keys sorted in pages.', kind: 'document' },
      { text: 'What is a B-tree?', kind: 'query' },
    ]);
    expect(expanded.keywordQueries).toEqual(['What is a B-tree?']);
    expect(expanded.rerankQuery).toBe('What is a B-tree?');
    expect(expanded.generated).toEqual(['A B-tree keeps keys sorted in pages.']);
  });

  it('searches every sub-query and the original question in decompose', async () => {
    const question = 'Compare B-trees and LSM-trees for writes';
    answering({
      queries: [
        'B-tree write path',
        'LSM-tree write path',
        question,
        'B-tree write path',
        'extra',
        'more',
      ],
    });

    const expanded = await expandQuery(question, 'decompose');

    const max = appConfig.retrieval.queryModes.maxSubQueries;
    expect(expanded.generated).toEqual(
      ['B-tree write path', 'LSM-tree write path', 'extra'].slice(0, max),
    );
    expect(expanded.keywordQueries).toEqual([...expanded.generated, question]);
    expect(expanded.vectorQueries).toEqual(
      [...expanded.generated, question].map((text) => ({ text, kind: 'query' })),
    );
    expect(expanded.rerankQuery).toBe(question);
  });

  it('reports when the fallback model answered', async () => {
    useModels({
      [primary.model]: failingModel(apiError(400)),
      [fallback!.model]: textModel(json({ passage: 'A passage.' })),
    });

    const expanded = await expandQuery('What is a B-tree?', 'hyde');

    expect(expanded.fallbackUsed).toBe(true);
    expect(expanded.generated).toEqual(['A passage.']);
  });

  it('only calls the pinned model when there is an override', async () => {
    useModels({
      [primary.model]: failingModel(apiError(400)),
      [fallback!.model]: textModel(json({ passage: 'A passage.' })),
    });

    const expanded = await expandQuery('What is a B-tree?', 'hyde', { modelOverride: primary });

    expect(expanded.error).toMatch(/hyde failed/);
    expect(expanded.generated).toEqual([]);
  });

  it('searches the question as asked when every model fails', async () => {
    useModels({
      [primary.model]: failingModel(apiError(400)),
      [fallback!.model]: failingModel(apiError(400)),
    });

    const expanded = await expandQuery('What is a B-tree?', 'decompose');

    expect(expanded).toEqual({
      vectorQueries: [{ text: 'What is a B-tree?', kind: 'query' }],
      keywordQueries: ['What is a B-tree?'],
      rerankQuery: 'What is a B-tree?',
      generated: [],
      fallbackUsed: false,
      error: 'decompose failed; searched with the question as asked',
    });
  });

  it('throws when the caller aborts instead of falling back', async () => {
    useModels({ [primary.model]: hangingModel(), [fallback!.model]: hangingModel() });
    const controller = new AbortController();

    const expanding = expandQuery('What is a B-tree?', 'hyde', { signal: controller.signal });
    controller.abort(new Error('client left'));

    await expect(expanding).rejects.toThrow('client left');
  });

  describe('memo', () => {
    const memoSize = appConfig.retrieval.queryModes.memoSize;

    afterEach(() => {
      (appConfig.retrieval.queryModes as { memoSize: number }).memoSize = memoSize;
    });

    it('calls the model once for the same question and mode', async () => {
      const prompts = answering({ passage: 'A passage.' });

      const first = await expandQuery('What is a B-tree?', 'hyde');
      const second = await expandQuery('What is a B-tree?', 'hyde');

      expect(second).toEqual(first);
      expect(prompts).toHaveLength(1);
    });

    it('keeps rewrites with different history apart', async () => {
      const prompts = answering({ question: 'A standalone question', keyTerms: [] });

      await expandQuery('and then?', 'rewrite', { history: [{ role: 'user', content: 'one' }] });
      await expandQuery('and then?', 'rewrite', { history: [{ role: 'user', content: 'two' }] });

      expect(prompts).toHaveLength(2);
    });

    it('does not keep failures', async () => {
      useModels({
        [primary.model]: failingModel(apiError(400)),
        [fallback!.model]: failingModel(apiError(400)),
      });
      await expandQuery('What is a B-tree?', 'hyde');

      const prompts = answering({ passage: 'A passage.' });
      const expanded = await expandQuery('What is a B-tree?', 'hyde');

      expect(prompts).toHaveLength(1);
      expect(expanded.error).toBeUndefined();
    });

    it('drops the least recently used entry past the cap', async () => {
      (appConfig.retrieval.queryModes as { memoSize: number }).memoSize = 2;
      const prompts = answering({ passage: 'A passage.' });

      await expandQuery('one', 'hyde');
      await expandQuery('two', 'hyde');
      await expandQuery('one', 'hyde');
      await expandQuery('three', 'hyde');
      expect(prompts).toHaveLength(3);

      await expandQuery('one', 'hyde');
      expect(prompts).toHaveLength(3);
      await expandQuery('two', 'hyde');
      expect(prompts).toHaveLength(4);
    });
  });
});
