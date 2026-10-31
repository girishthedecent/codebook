import { appConfig } from '../../config/app.config.js';
import { serverConfig } from '../../config/index.js';

/** Whether the demo's visitors read its books as its owner does (DEMO_FULL_BOOKS). */
export function demoBooksInFull() {
  return serverConfig.DEMO_FULL_BOOKS;
}

/**
 * The start of a passage, cut at a word boundary. Unless the demo shows its books in full,
 * its visitors (everyone but its owner) read them this way: a copyrighted book must not be
 * handed out in whole pages.
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
