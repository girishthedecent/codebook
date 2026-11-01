import { describe, expect, it } from 'vitest';
import { modelLabel, startingAtKey, withEveryKey, type ModelRef } from './models.js';

const groq: ModelRef = { provider: 'groq', model: 'openai/gpt-oss-120b' };
const gemini: ModelRef = { provider: 'google', model: 'gemini-3.6-flash' };

describe('withEveryKey', () => {
  it('leaves the route alone with one key per provider', () => {
    expect(withEveryKey([gemini, groq], { google: 1, groq: 1 })).toEqual([gemini, groq]);
    expect(withEveryKey([gemini, groq], { google: 0, groq: 0 })).toEqual([gemini, groq]);
  });

  it('tries each model again on the other keys before moving on', () => {
    expect(withEveryKey([gemini, groq], { google: 2, groq: 1 })).toEqual([
      gemini,
      { ...gemini, key: 1 },
      groq,
    ]);
    expect(withEveryKey([groq, gemini], { google: 3, groq: 2 })).toEqual([
      groq,
      { ...groq, key: 1 },
      gemini,
      { ...gemini, key: 1 },
      { ...gemini, key: 2 },
    ]);
  });
});

describe('startingAtKey', () => {
  const route = withEveryKey([gemini, groq], { google: 3, groq: 2 });
  const [g1, g2, g3, q1, q2] = route;

  it('leaves the route alone at the first key', () => {
    expect(startingAtKey(route, 0)).toEqual(route);
  });

  it('starts each model on the given key and keeps the models in order', () => {
    expect(startingAtKey(route, 1)).toEqual([g2, g3, g1, q2, q1]);
    expect(startingAtKey(route, 2)).toEqual([g3, g1, g2, q1, q2]);
  });

  it('wraps round when a provider has fewer keys', () => {
    expect(startingAtKey(route, 3)).toEqual([g1, g2, g3, q2, q1]);
    expect(startingAtKey([gemini, groq], 2)).toEqual([gemini, groq]);
  });
});

describe('modelLabel', () => {
  it('numbers the keys after the first from 2', () => {
    expect(modelLabel(gemini)).toBe('google/gemini-3.6-flash');
    expect(modelLabel({ ...gemini, key: 1 })).toBe('google/gemini-3.6-flash#2');
    expect(modelLabel({ ...groq, key: 2 })).toBe('groq/openai/gpt-oss-120b#3');
  });
});
