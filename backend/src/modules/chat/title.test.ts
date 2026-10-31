import { describe, expect, it } from 'vitest';
import type { Message } from '../../generated/prisma/client.js';
import { provisionalTitle } from './conversation.service.js';
import { retriedMessages } from './turn.service.js';

describe('provisionalTitle', () => {
  it('is a short question as it was asked, spaces tidied', () => {
    expect(provisionalTitle('  What is a salt?  ')).toBe('What is a salt?');
    expect(provisionalTitle('How does\n  attention\twork?')).toBe('How does attention work?');
  });

  it('cuts a long question at a word within 60 characters and marks the cut', () => {
    const title = provisionalTitle(
      'How does causal self-attention work in nanoGPT, and how does the book explain it?',
    );

    expect(title).toBe('How does causal self-attention work in nanoGPT, and how does…');
    expect(Array.from(title!.slice(0, -1)).length).toBeLessThanOrEqual(60);
    // Cut mid-word, the word before it is where it stops.
    expect(provisionalTitle('How does causal self-attention work in nanoGPT, and howdoesit?')).toBe(
      'How does causal self-attention work in nanoGPT, and…',
    );
  });

  it('keeps a last word that ends exactly at the limit', () => {
    const sixty = 'abcdefghi '.repeat(5) + 'abcdefghi';
    expect(sixty).toHaveLength(59);
    const exact = `${sixty}x`;

    expect(provisionalTitle(`${exact} and more`)).toBe(`${exact}…`);
  });

  it('drops punctuation left dangling by the cut', () => {
    const question = `${'word '.repeat(11)}end, because (and then so on`;

    expect(provisionalTitle(question)).toBe(`${'word '.repeat(11)}end…`);
    expect(provisionalTitle(`${'a'.repeat(50)} - ${'b'.repeat(30)}`)).toBe(`${'a'.repeat(50)}…`);
  });

  it('cuts a single long word where it is, never inside an emoji', () => {
    expect(provisionalTitle('x'.repeat(100))).toBe(`${'x'.repeat(60)}…`);
    expect(provisionalTitle('📚'.repeat(80))).toBe(`${'📚'.repeat(60)}…`);
  });

  it('has nothing to say about an empty question or one of punctuation', () => {
    expect(provisionalTitle('   ')).toBeNull();
    expect(provisionalTitle(`${'?'.repeat(70)}`)).toBeNull();
  });
});

describe('retriedMessages', () => {
  const NOW = Date.parse('2026-10-31T12:00:00Z');
  const at = (secondsAgo: number) => new Date(NOW - secondsAgo * 1000);
  const message = (
    id: string,
    role: 'USER' | 'ASSISTANT',
    content: string,
    fields: Partial<Message> = {},
  ) => ({ id, role, content, status: 'COMPLETE', createdAt: at(10), ...fields }) as Message;

  const failedPair = [
    message('a1', 'ASSISTANT', 'Salts are', { status: 'ERROR' }),
    message('q1', 'USER', 'What is a salt?'),
  ];

  it('replaces a question and the failed answer to it', () => {
    expect(retriedMessages(failedPair, 'What is a salt?', NOW)).toEqual(['a1', 'q1']);
    expect(retriedMessages(failedPair, '  What is a salt?\n', NOW)).toEqual(['a1', 'q1']);
  });

  it('replaces a cut-off answer too', () => {
    const aborted = [message('a1', 'ASSISTANT', '', { status: 'ABORTED' }), failedPair[1]!];
    expect(retriedMessages(aborted, 'What is a salt?', NOW)).toEqual(['a1', 'q1']);
  });

  it('replaces nothing when the question is another one', () => {
    expect(retriedMessages(failedPair, 'And a pepper?', NOW)).toEqual([]);
  });

  it('replaces nothing after an answer that worked', () => {
    const answered = [message('a1', 'ASSISTANT', 'A salt is...'), failedPair[1]!];
    expect(retriedMessages(answered, 'What is a salt?', NOW)).toEqual([]);
    expect(retriedMessages([], 'What is a salt?', NOW)).toEqual([]);
  });

  it('replaces a question with no answer only once it is too old to be still answering', () => {
    const lone = (secondsAgo: number) => [
      message('q1', 'USER', 'What is a salt?', { createdAt: at(secondsAgo) }),
    ];

    expect(retriedMessages(lone(30), 'What is a salt?', NOW)).toEqual([]);
    expect(retriedMessages(lone(6 * 60), 'What is a salt?', NOW)).toEqual([]);
    expect(retriedMessages(lone(16 * 60), 'What is a salt?', NOW)).toEqual(['q1']);
    expect(retriedMessages(lone(16 * 60), 'Something else', NOW)).toEqual([]);
  });
});
