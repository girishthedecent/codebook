import { describe, expect, it } from 'vitest';
import { sensitiveReason } from './memory.filter.js';

describe('sensitiveReason', () => {
  it('lets ordinary facts about the user through', () => {
    for (const fact of [
      'The user is preparing for backend interviews.',
      'The user prefers TypeScript examples.',
      'The user is building a URL shortener on Express 5.',
      'The user reads chapter 7 of DDIA this week.',
    ]) {
      expect(sensitiveReason(fact), fact).toBeNull();
    }
  });

  it('catches secrets with the repo scanner rules', () => {
    // Built at runtime so no scanner flags this file.
    const token = 'gh' + 'p_' + 'A1b2C3d4'.repeat(4) + 'E5f6';
    expect(sensitiveReason(`The user's GitHub token is ${token}`)).toBe('github-token');
  });

  it('catches card numbers, ids, contact details and credential talk', () => {
    expect(sensitiveReason('The user pays with card 4111 1111 1111 1111.')).toBe('card-number');
    expect(sensitiveReason('Their SSN is 123-45-6789.')).toBe('national-id');
    expect(sensitiveReason('Their id is 1234 5678 9012.')).toBe('national-id');
    expect(sensitiveReason('Call them on +1 (555) 010-9999.')).toBe('phone');
    expect(sensitiveReason('Their email is dev@example.org.')).toBe('email');
    expect(sensitiveReason('The user reuses one password everywhere.')).toBe('credential-words');
  });
});
