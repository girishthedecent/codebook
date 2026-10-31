import { useEffect, useRef, type ReactNode } from 'react';
import { useMatch } from '@tanstack/react-router';

export type ErrorPageProps = {
  /** A code or number in mono above the title: 404, an error code. */
  kicker: string;
  title: ReactNode;
  hint?: ReactNode;
  /** Mono detail under the hint, such as a reference to quote to support. */
  detail?: ReactNode;
  actions?: ReactNode;
  /** Move focus to the title on arrival so the failure is announced. */
  focusTitle?: boolean;
};

const frame = 'mx-auto w-full max-w-[560px] px-4 py-16 sm:py-24';

/** The page for a missing address or a failed route, in the page's own main landmark. */
export function ErrorPage({ kicker, title, hint, detail, actions, focusTitle }: ErrorPageProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  // Every layout route (the shell, the account pages) brings the main landmark, so a page
  // failing under one is already inside it. Only a top-level failure needs its own.
  const nested = useMatch({ strict: false, select: (m) => m.index > 1 });
  useEffect(() => {
    if (focusTitle) heading.current?.focus();
  }, [focusTitle]);

  const content = (
    <>
      <p className="font-mono text-xs text-ink-3">{kicker}</p>
      <h1
        ref={heading}
        tabIndex={-1}
        className="heading-page mt-2 outline-none [overflow-wrap:anywhere]"
      >
        {title}
      </h1>
      {hint && <p className="mt-3 font-serif text-base text-pretty text-ink-2">{hint}</p>}
      {detail && (
        <p className="mt-3 font-mono text-xs text-ink-3 [overflow-wrap:anywhere]">{detail}</p>
      )}
      {actions && <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">{actions}</div>}
    </>
  );
  return nested ? (
    <div className={frame}>{content}</div>
  ) : (
    <main id="main" className={frame}>
      {content}
    </main>
  );
}
