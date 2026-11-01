// The landing page. Prerendered to static HTML at build time and hydrated by its own small
// entry, so it uses plain anchors and nothing from the router: it has to read without any
// JavaScript, and the app is not loaded for it.
import { useState } from 'react';
import { CircleHalf, GithubLogo } from '@phosphor-icons/react';
import type { SourceType } from '@/api/types';
import { Button } from '@/ui/Button';
import { textLinkClass } from '@/ui/textLinkClass';
import { Wordmark } from '@/ui/Wordmark';
import { Hero } from './Hero';
import { useDarkTheme, useVisitor, type Visitor } from './hooks';
import { Proof } from './Proof';
import { Shelf } from './Shelf';
import { landing } from './strings';
import { Workbench } from './Workbench';

export function Landing({ standalone = false }: { standalone?: boolean }) {
  const visitor = useVisitor();
  const [highlight, setHighlight] = useState<SourceType | null>(null);
  return (
    <div className="min-h-dvh bg-paper text-ink">
      {standalone && (
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-sm focus:bg-paper focus:px-3 focus:py-2 focus:text-sm"
        >
          Skip to content
        </a>
      )}
      <Header visitor={visitor} />
      <main id="main" tabIndex={-1}>
        <Hero visitor={visitor} />
        <Workbench highlight={highlight} />
        <Shelf onHighlight={setHighlight} />
        <Proof />
      </main>
      <Footer />
    </div>
  );
}

function Header({ visitor }: { visitor: Visitor }) {
  const t = landing.header;
  const [dark, toggle] = useDarkTheme();
  const member = visitor === 'member';
  return (
    <header className="mx-auto flex w-full max-w-wide items-center justify-between gap-3 px-4 py-3 sm:px-8 sm:py-5">
      <a href="/" aria-label="CodeBook" className="rounded-xs">
        <Wordmark size="md" />
      </a>
      <nav aria-label="Site" className="flex items-center gap-1 sm:gap-3">
        <a
          href={landing.github}
          className="inline-flex h-9 items-center gap-1.5 rounded-sm px-2 text-sm text-ink-2 hover:text-ink max-sm:hidden"
        >
          <GithubLogo size={18} aria-hidden />
          {t.github}
        </a>
        <button
          type="button"
          onClick={toggle}
          aria-pressed={dark}
          aria-label={t.theme}
          className="inline-flex size-9 items-center justify-center rounded-sm text-ink-2 transition-colors hover:bg-paper-2 hover:text-ink max-sm:size-11"
        >
          <CircleHalf size={20} aria-hidden />
        </button>
        {!member && (
          <a
            href="/sign-in"
            className="inline-flex h-9 items-center px-2 text-sm text-ink-2 hover:text-ink max-sm:h-11"
          >
            {t.signIn}
          </a>
        )}
        <Button asChild variant="primary">
          <a href={member ? '/w' : '/demo'}>{member ? t.workspace : t.demo}</a>
        </Button>
      </nav>
    </header>
  );
}

function Footer() {
  const t = landing.footer;
  return (
    <footer className="mx-auto w-full max-w-wide border-t border-rule px-4 py-10 sm:px-8">
      <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-3">
        <Wordmark size="sm" />
        <p className="text-sm text-ink-2">
          {t.line}{' '}
          <a href={landing.github} className={textLinkClass}>
            {t.source}
          </a>
        </p>
      </div>
      <p className="mt-4 max-w-[48rem] text-xs text-ink-3">{t.credits}</p>
    </footer>
  );
}
