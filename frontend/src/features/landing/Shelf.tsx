import { useMemo } from 'react';
import type { SourceType } from '@/api/types';
import { displayTitle } from '@/lib/displayTitle';
import { Card } from '@/ui/Card';
import { SourceBadge } from '@/ui/SourceBadge';
import { Stat, Stats } from '@/ui/Stat';
import { textLinkClass } from '@/ui/textLinkClass';
import { parseAnswer } from './answer';
import { CodeListing } from './CodeListing';
import type { DemoSource } from './fixtureTypes';
import { fixtures } from './fixtures';
import { landing } from './strings';

const t = landing.shelf;

type Props = { onHighlight: (type: SourceType | null) => void };

export function Shelf({ onHighlight }: Props) {
  const sources = fixtures.demo?.sources;
  const turn = fixtures.turn;

  // How many of the answer's sentences lean on each kind of source.
  const cited = useMemo(() => {
    if (!turn) return undefined;
    const sentences = parseAnswer(turn.answer).flatMap((b) => b.sentences);
    const types = new Map(turn.citations.map((c) => [c.n, c.sourceType]));
    const count = (type: SourceType) =>
      sentences.filter((s) => s.cites.some((n) => types.get(n) === type)).length;
    return { total: sentences.length, count };
  }, [turn]);

  if (!sources || sources.length === 0) return null;

  return (
    <section
      aria-labelledby="shelf-title"
      className="mx-auto w-full max-w-wide px-4 py-14 sm:px-8 sm:py-20"
    >
      <div className="max-w-[40rem]">
        <h2 id="shelf-title" className="heading-page">
          {t.title}
        </h2>
        <p className="prose mt-3 text-ink-2">{t.lede}</p>
      </div>
      <ul className="mt-8 grid list-none gap-4 p-0 lg:grid-cols-3">
        {sources.map((source) => (
          <SourceCard
            key={source.title}
            source={source}
            cited={cited && { n: cited.count(source.type), total: cited.total }}
            onHighlight={onHighlight}
          />
        ))}
      </ul>
    </section>
  );
}

function SourceCard({
  source,
  cited,
  onHighlight,
}: {
  source: DemoSource;
  cited: { n: number; total: number } | undefined;
  onHighlight: (type: SourceType | null) => void;
}) {
  const { name, ref } = displayTitle({ title: source.title, type: source.type });
  return (
    <Card
      as="li"
      className="flex min-w-0 flex-col gap-4"
      onPointerEnter={cited ? () => onHighlight(source.type) : undefined}
      onPointerLeave={cited ? () => onHighlight(null) : undefined}
    >
      <div className="flex items-center gap-3">
        <SourceBadge type={source.type} showLabel />
      </div>
      <h3 className="heading-minor">
        {source.href ? (
          <a href={source.href} className={textLinkClass} rel="noreferrer">
            {name}
          </a>
        ) : (
          name
        )}
        {ref && <span className="ml-2 font-mono text-xs font-normal text-ink-3">{ref}</span>}
      </h3>

      <Stats className="gap-x-8">
        {Object.entries(source.counts)
          .filter(([key]) => key !== 'chunks')
          .map(([key, value]) => (
            <Stat key={key} label={value === 1 ? key.replace(/s$/, '') : key} value={value} />
          ))}
      </Stats>

      <Specimen type={source.type} />

      {cited && (
        <p className="mt-auto text-xs text-ink-3">
          {t.citedBy(cited.n, cited.total)}
          {cited.n > 0 && (
            <>
              {' · '}
              <a
                href="#watch"
                className={textLinkClass}
                onFocus={() => onHighlight(source.type)}
                onBlur={() => onHighlight(null)}
              >
                {t.show}
              </a>
            </>
          )}
        </p>
      )}
    </Card>
  );
}

function Specimen({ type }: { type: SourceType }) {
  if (type === 'PDF') {
    const page = fixtures.book?.pages[0];
    if (!page) return null;
    return (
      <div className="relative h-44 overflow-hidden rounded-sm border border-rule bg-paper-3">
        <img
          src={page.image}
          width={page.width}
          height={page.height}
          alt={`Page ${page.page} of the book`}
          loading="lazy"
          decoding="async"
          className="block w-full"
        />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-paper-2 to-transparent" />
      </div>
    );
  }
  if (type === 'GITHUB_REPO') {
    const slice = fixtures.code?.slices[0];
    if (!slice) return null;
    return (
      <div className="relative h-44 overflow-hidden rounded-sm border border-rule bg-paper">
        <div className="py-2">
          <CodeListing slice={slice} to={slice.lineStart + 9} className="overflow-hidden" />
        </div>
        <p className="absolute right-2 bottom-2 rounded-xs bg-paper px-1.5 text-xs text-ink-3">
          {slice.path}
        </p>
      </div>
    );
  }
  return null;
}
