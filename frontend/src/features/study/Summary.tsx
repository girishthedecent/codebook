import type { Citation } from '@/api/types';
import { Cites } from './Cites';
import { citationsOf, type SummaryData } from './data';
import { s } from './strings';

/**
 * Sections of key points in the reading serif, the first point of the first section set larger
 * as the lede, then the key terms.
 */
export function Summary({
  summary,
  index,
}: {
  summary: SummaryData;
  index: Map<number, Citation>;
}) {
  const lede = summary.sections[0]?.bullets[0];
  return (
    <article className="prose max-w-[680px]">
      {lede && (
        <p className="mb-8 text-md leading-snug text-ink text-pretty">
          {lede.text} <Cites citations={citationsOf(lede, index)} uncited={lede.uncited} />
        </p>
      )}
      {summary.sections.map((section, i) => {
        const bullets = i === 0 ? section.bullets.slice(1) : section.bullets;
        return (
          <section key={i}>
            <h2>{section.heading}</h2>
            {bullets.length > 0 && (
              <ul>
                {bullets.map((bullet, j) => (
                  <li key={j}>
                    {bullet.text}{' '}
                    <Cites citations={citationsOf(bullet, index)} uncited={bullet.uncited} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
      {summary.keyTerms.length > 0 && (
        <section>
          <h2>{s.summary.keyTerms}</h2>
          <dl className="not-prose font-sans">
            {summary.keyTerms.map((t, i) => (
              <div key={i} className="grid gap-x-6 gap-y-0.5 py-2.5 sm:grid-cols-[12rem_1fr]">
                <dt className="font-serif text-base font-semibold text-ink">{t.term}</dt>
                <dd className="m-0 font-serif text-base text-ink-2">
                  {t.definition} <Cites citations={citationsOf(t, index)} uncited={t.uncited} />
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </article>
  );
}
