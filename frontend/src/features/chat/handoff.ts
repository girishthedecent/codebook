// The first question of a new conversation is typed on the workspace home, but streams on the
// conversation's own page. It waits here between the two so the page can show it at once.

export type PendingQuestion = { content: string; useMemory: boolean };

const pending = new Map<string, PendingQuestion>();

export function handOff(conversationId: string, question: PendingQuestion) {
  pending.set(conversationId, question);
}

export function peekHandOff(conversationId: string) {
  return pending.get(conversationId);
}

export function takeHandOff(conversationId: string) {
  const q = pending.get(conversationId);
  pending.delete(conversationId);
  return q;
}
