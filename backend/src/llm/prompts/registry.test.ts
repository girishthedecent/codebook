import { describe, expect, it } from 'vitest';
import lock from './prompt-hashes.json' with { type: 'json' };
import { prompts } from './index.js';
import { checkPromptHashes, definePrompt } from './registry.js';

describe('definePrompt', () => {
  it('versions, hashes and renders a prompt', () => {
    const prompt = definePrompt({
      name: 'greet',
      version: 2,
      text: 'Hello {{name}}, from {{place}}.',
    });

    expect(prompt.id).toBe('greet@v2');
    expect(prompt.hash).toMatch(/^[0-9a-f]{16}$/);
    expect(prompt.render({ name: 'Ada', place: 'London' })).toBe('Hello Ada, from London.');
  });

  it('gives different text a different hash', () => {
    const a = definePrompt({ name: 'hash-a', version: 1, text: 'one' });
    const b = definePrompt({ name: 'hash-b', version: 1, text: 'two' });
    expect(a.hash).not.toBe(b.hash);
  });

  it('refuses a missing variable at runtime too', () => {
    const prompt = definePrompt({ name: 'missing', version: 1, text: 'Hi {{name}}' });
    expect(() => prompt.render({} as { name: string })).toThrow(/missing "name"/);
  });

  it('refuses placeholders that render would leave unfilled', () => {
    expect(() => definePrompt({ name: 'spaced', version: 1, text: 'Hi {{ name }}' })).toThrow(
      /bad placeholder \{\{ name \}\}/,
    );
  });

  it('refuses the same id twice', () => {
    definePrompt({ name: 'twice', version: 1, text: 'a' });
    expect(() => definePrompt({ name: 'twice', version: 1, text: 'b' })).toThrow(/defined twice/);
  });
});

describe('checkPromptHashes', () => {
  const prompt = { id: 'answer@v1', hash: 'abc' };

  it('accepts prompts that match the lock', () => {
    expect(checkPromptHashes([prompt], { 'answer@v1': 'abc' })).toEqual([]);
  });

  it('flags text edited without a version bump', () => {
    expect(checkPromptHashes([prompt], { 'answer@v1': 'old' })).toEqual([
      'answer@v1 changed without a version bump',
    ]);
  });

  it('asks for new versions to be added', () => {
    expect(checkPromptHashes([prompt], {})[0]).toMatch(/answer@v1 is new: add "answer@v1": "abc"/);
  });
});

describe('app prompts', () => {
  it('match prompt-hashes.json', () => {
    expect(checkPromptHashes(prompts, lock as Record<string, string>)).toEqual([]);
  });
});
