import type { ReactNode } from 'react';

/** Title row of an account page, with optional actions on the right and an intro paragraph. */
export function PageHeader({
  title,
  intro,
  actions,
}: {
  title: string;
  intro?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-8 max-w-[640px]">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-xl font-semibold text-ink">{title}</h1>
        {actions}
      </div>
      {intro && <p className="mt-3 font-serif text-base text-ink-2">{intro}</p>}
    </header>
  );
}

/** A section heading inside an account page: small, with a hairline under it. */
export function SectionHeading({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-1 border-b border-rule-2 pb-2">
      <h2 className="text-sm font-semibold text-ink">{children}</h2>
      {hint && <p className="mt-0.5 text-xs text-ink-3">{hint}</p>}
    </div>
  );
}
