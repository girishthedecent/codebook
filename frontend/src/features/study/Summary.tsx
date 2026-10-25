import type { Citation } from '@/api/types';
import { Cites } from './Cites';
import { citationsOf, type SummaryData } from './data';
import { s } from './strings';

/** Sections of key points in the reading serif, then the key terms as a ruled list. */
export function Summary({
  summary,
  index,
}: {
  summary: SummaryData;
  index: Map<number, Citation>;
}) {
  return (
    <article className="prose max-w-[680px]">
      {summary.sections.map((section, i) => (
        <section key={i}>
          <h2>{section.heading}</h2>
          <ul>
            {section.bullets.map((bullet, j) => (
              <li key={j}>
                {bullet.text} <Cites citations={citationsOf(bullet, index)} />
              </li>
            ))}
          </ul>
        </section>
      ))}
      {summary.keyTerms.length > 0 && (
        <section>
          <h2>{s.summary.keyTerms}</h2>
          <dl className="not-prose border-t border-rule font-sans">
            {summary.keyTerms.map((t, i) => (
              <div
                key={i}
                className="grid gap-x-6 gap-y-0.5 border-b border-rule py-2.5 sm:grid-cols-[12rem_1fr]"
              >
                <dt className="text-sm font-medium text-ink">{t.term}</dt>
                <dd className="m-0 font-serif text-base text-ink-2">
                  {t.definition} <Cites citations={citationsOf(t, index)} />
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </article>
  );
}
