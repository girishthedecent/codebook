/**
 * Where to go after signing in. Only same-site paths are followed, so a crafted `?next=` can't
 * send someone to another site. `/w` picks the last-used workspace.
 */
export function safeNext(next: string | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return '/w';
  // Browsers read `\` as `/` and drop tabs and newlines, so `/\host` or `/<tab>/host` would leave the site.
  for (const ch of next) {
    const code = ch.charCodeAt(0);
    if (ch === '\\' || code < 0x20 || code === 0x7f) return '/w';
  }
  if (next === '/sign-in' || next.startsWith('/sign-in?') || next.startsWith('/sign-in/')) {
    return '/w';
  }
  return next;
}
