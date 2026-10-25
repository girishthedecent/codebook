/** Joins class names, dropping falsy parts. Small enough that no library is needed. */
export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}
