/**
 * Where to go after signing in. Only same-site paths are followed, so a crafted `?next=` can't
 * send someone to another site. `/w` picks the last-used workspace.
 */
export function safeNext(next: string | undefined): string {
  if (next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/sign-in')) {
    return next;
  }
  return '/w';
}
