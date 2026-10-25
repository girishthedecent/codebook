import { appConfig } from '../../config/app.config.js';

/**
 * The start of a passage, cut at a word boundary. Visitors of the demo (everyone but its
 * owner) read books this way: the demo's book is copyrighted, so nothing hands out whole
 * pages of it.
 */
export function excerptOf(text: string, maxChars: number = appConfig.demo.excerptChars) {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return { text: trimmed, cut: false };
  const head = trimmed.slice(0, maxChars);
  const space = head.search(/\s\S*$/);
  // A single word longer than the limit is cut where it is.
  const end = space > maxChars / 2 ? space : maxChars;
  return { text: `${head.slice(0, end).trimEnd()}…`, cut: true };
}
