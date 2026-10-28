import { describe, expect, it } from 'vitest';
import { backupFirst, modelLabel, withBackupKey, type ModelRef } from './models.js';

const groq: ModelRef = { provider: 'groq', model: 'openai/gpt-oss-120b' };
const gemini: ModelRef = { provider: 'google', model: 'gemini-3.6-flash' };

describe('withBackupKey', () => {
  it('leaves the route alone without a backup key', () => {
    expect(withBackupKey([gemini, groq], false)).toEqual([gemini, groq]);
  });

  it('tries each Google model again on the backup key before moving on', () => {
    expect(withBackupKey([gemini, groq], true)).toEqual([
      gemini,
      { ...gemini, key: 'backup' },
      groq,
    ]);
    expect(withBackupKey([groq, gemini], true)).toEqual([
      groq,
      gemini,
      { ...gemini, key: 'backup' },
    ]);
  });
});

describe('backupFirst', () => {
  it('moves each backup copy ahead of its model and leaves the rest in order', () => {
    const backup = { ...gemini, key: 'backup' as const };
    expect(backupFirst([gemini, backup, groq])).toEqual([backup, gemini, groq]);
    expect(backupFirst([groq, gemini, backup])).toEqual([groq, backup, gemini]);
    expect(backupFirst([gemini, groq])).toEqual([gemini, groq]);
  });
});

describe('modelLabel', () => {
  it('marks the backup key', () => {
    expect(modelLabel(gemini)).toBe('google/gemini-3.6-flash');
    expect(modelLabel({ ...gemini, key: 'backup' })).toBe('google/gemini-3.6-flash#backup');
  });
});
