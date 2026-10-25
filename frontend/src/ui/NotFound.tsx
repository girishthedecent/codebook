import { Link } from '@tanstack/react-router';

export function NotFound() {
  return (
    <main className="mx-auto max-w-[560px] px-4 py-24">
      <p className="font-mono text-xs text-ink-3">404</p>
      <h1 className="mt-2 text-lg font-semibold">There's nothing at this address.</h1>
      <p className="mt-3 text-ink-2">
        The link may be old, or the page was removed.{' '}
        <Link to="/" className="text-accent underline underline-offset-2">
          Go to the start
        </Link>
        .
      </p>
    </main>
  );
}
