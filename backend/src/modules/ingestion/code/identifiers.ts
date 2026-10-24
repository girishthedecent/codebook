const IDENTIFIER = /[A-Za-z_$][A-Za-z0-9_$]*/g;
// Words inside an identifier: "HTTPServer" → HTTP, Server; "getUserById" → get, User, By, Id.
const WORD = /[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|[A-Z]+|[0-9]+/g;

/**
 * Identifiers in `text` that are made of several words, spelled out ("getUserById" →
 * "get user by id"), so keyword search finds code by the words a question uses.
 */
export function identifierWords(text: string): string[] {
  const seen = new Set<string>();
  for (const [identifier] of text.matchAll(IDENTIFIER)) {
    const words = identifier.match(WORD) ?? [];
    if (words.length >= 2) seen.add(words.join(' ').toLowerCase());
  }
  return [...seen];
}
