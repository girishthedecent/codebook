import { cn } from '@/lib/cn';
import { textLinkClass } from '@/ui/textLinkClass';
import { landing } from './strings';

const t = landing.proof;

/** The retrieval numbers from the README's eval results, as bars of recall@5. */
export function Proof() {
  return (
    <section
      aria-labelledby="proof-title"
      className="mx-auto w-full max-w-wide px-4 py-14 sm:px-8 sm:py-20"
    >
      <div className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-14">
        <div>
          <h2 id="proof-title" className="heading-page">
            {t.title}
          </h2>
          <p className="prose mt-3 text-ink-2">{t.lede}</p>
          <p className="mt-4 text-xs text-ink-3">{t.measured}</p>
        </div>

        <div className="min-w-0">
          <figure className="m-0">
            <figcaption className="text-sm text-ink-2">Recall@5, higher is better</figcaption>
            <ul className="mt-4 flex list-none flex-col gap-3 p-0">
              {t.rows.map(([label, value]) => {
                const chosen = label === 'Hybrid, the default';
                return (
                  <li
                    key={label}
                    className="grid grid-cols-[minmax(0,9.5rem)_1fr_3rem] items-center gap-3 text-sm sm:grid-cols-[11rem_1fr_3rem]"
                  >
                    <span className={cn('min-w-0', chosen ? 'font-medium text-ink' : 'text-ink-2')}>
                      {label}
                    </span>
                    <span className="h-2 rounded-full bg-paper-3" aria-hidden>
                      <span
                        className={cn(
                          'block h-full rounded-full',
                          chosen ? 'bg-series-1' : 'bg-series-2',
                        )}
                        style={{ width: `${value * 100}%` }}
                      />
                    </span>
                    <span className="text-right font-mono text-xs text-ink tabular-nums">
                      {value.toFixed(3)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </figure>

          <p className="prose mt-6 text-ink-2">{t.why}</p>

          <dl className="mt-8 grid gap-6 sm:grid-cols-2">
            {t.facts.map((fact) => (
              <div key={fact.figure}>
                <dt className="font-serif text-xl leading-none font-medium tabular-nums lining-nums">
                  {fact.figure}
                </dt>
                <dd className="m-0 mt-2 text-sm text-ink-2">{fact.text}</dd>
              </div>
            ))}
          </dl>

          <p className="mt-8 text-sm">
            <a href={`${landing.github}#eval-results`} className={textLinkClass}>
              {t.readme}
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}
