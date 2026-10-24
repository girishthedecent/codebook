import { describe, expect, it } from 'vitest';
import { identifierWords } from './identifiers.js';

describe('identifierWords', () => {
  it('spells out camelCase, snake_case and acronyms', () => {
    expect(identifierWords('getUserById snake_case_name HTTPServer')).toEqual([
      'get user by id',
      'snake case name',
      'http server',
    ]);
  });

  it('leaves out single words', () => {
    expect(identifierWords('const user = load(id);')).toEqual([]);
  });

  it('lists duplicates once, in first-seen order', () => {
    expect(identifierWords('b_c aB b_c aB c_d')).toEqual(['b c', 'a b', 'c d']);
  });
});
