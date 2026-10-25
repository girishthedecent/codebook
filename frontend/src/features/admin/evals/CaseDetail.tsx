import type { EvalResult } from '@/api/types';
import { ms, usd } from '../format';
import { strings } from '../strings';
import { isRecord, num } from './metrics';

/** Everything recorded about one case, opened from the results table. */
export function CaseDetail({ result }: { result: EvalResult }) {
  const scores = isRecord(result.scores) ? result.scores : {};
  const judge = isRecord(scores.judge) ? scores.judge : null;
  const claims = Array.isArray(scores.claims) ? scores.claims.filter(isRecord) : [];
  const verdicts = Array.isArray(scores.citationVerdicts)
    ? scores.citationVerdicts.filter(isRecord)
    : [];
  const numbers = Object.entries(scores).filter(
    ([, v]) => typeof v === 'number' || typeof v === 'boolean',
  );

  return (
    <div className="grid gap-5 py-4 text-sm lg:grid-cols-2">
      <div className="flex flex-col gap-4">
        <Block label="Question">
          <p className="font-serif text-base text-ink">{result.question}</p>
        </Block>
        <Block label={strings.evals.expected}>
          <p className="font-serif text-ink-2">{result.expectedAnswer || '—'}</p>
          <Refs refs={result.expectedRefs} />
        </Block>
        {result.answer !== null && (
          <Block label={strings.evals.answer}>
            <p className="whitespace-pre-wrap font-serif text-ink">{result.answer || '(empty)'}</p>
          </Block>
        )}
        {result.error && (
          <Block label={strings.evals.error}>
            <p className="font-mono text-xs text-error">{result.error}</p>
          </Block>
        )}
      </div>

      <div className="flex flex-col gap-4">
        <Retrieved retrieved={result.retrieved} />

        {(typeof scores.correctnessReason === 'string' || claims.length > 0 || judge) && (
          <Block label={strings.evals.judge}>
            {typeof scores.correctnessReason === 'string' && (
              <p className="text-ink-2">{scores.correctnessReason}</p>
            )}
            {claims.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1.5">
                {claims.map((c, i) => (
                  <li key={i} className="flex gap-2">
                    <span
                      className={
                        'w-20 shrink-0 font-mono text-xs ' +
                        (c.supported ? 'text-ok' : 'text-error')
                      }
                    >
                      {c.supported ? 'supported' : 'unsupported'}
                    </span>
                    <span className="text-ink-2">
                      {String(c.claim)}
                      {typeof c.reason === 'string' && c.reason && (
                        <span className="block text-xs text-ink-3">{c.reason}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {verdicts.length > 0 && (
              <p className="mt-2 font-mono text-xs text-ink-3">
                citations:{' '}
                {verdicts
                  .map((v) => `[${String(v.n)}] ${v.supports ? 'supports' : 'does not support'}`)
                  .join(' · ')}
              </p>
            )}
            {judge && (
              <p className="mt-2 font-mono text-xs text-ink-3">
                {String(judge.model ?? '')}
                {num(judge.cached) ? ` · ${String(judge.cached)} cached` : ''}
                {typeof judge.skipped === 'string' && judge.skipped
                  ? ` · skipped: ${judge.skipped}`
                  : ''}
              </p>
            )}
          </Block>
        )}

        <Block label="Scores">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 font-mono text-xs">
            {numbers.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-ink-3">{k}</dt>
                <dd className="m-0 text-ink tabular-nums">
                  {typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(3)) : String(v)}
                </dd>
              </div>
            ))}
            <dt className="text-ink-3">latency</dt>
            <dd className="m-0 text-ink">{ms(result.latencyMs)}</dd>
            <dt className="text-ink-3">tokens</dt>
            <dd className="m-0 text-ink tabular-nums">
              {result.tokensIn} in / {result.tokensOut} out
            </dd>
            <dt className="text-ink-3">cost</dt>
            <dd className="m-0 text-ink">{usd(result.costUsd)}</dd>
          </dl>
        </Block>
      </div>
    </div>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="mb-1 text-xs font-medium text-ink-3">{label}</h4>
      {children}
    </section>
  );
}

function location(r: Record<string, unknown>) {
  const parts: string[] = [];
  if (typeof r.sourceKey === 'string') parts.push(r.sourceKey);
  if (typeof r.documentPath === 'string' && r.documentPath) parts.push(r.documentPath);
  if (typeof r.path === 'string' && r.path) parts.push(r.path);
  const ps = num(r.pageStart);
  const pe = num(r.pageEnd);
  if (ps !== null) parts.push(pe !== null && pe !== ps ? `pp. ${ps}–${pe}` : `p. ${ps}`);
  const ls = num(r.lineStart);
  const le = num(r.lineEnd);
  if (ls !== null) parts.push(le !== null && le !== ls ? `lines ${ls}–${le}` : `line ${ls}`);
  if (Array.isArray(r.headingPath) && r.headingPath.length) parts.push(r.headingPath.join(' › '));
  return parts.join(' · ');
}

function Refs({ refs }: { refs: unknown }) {
  if (!Array.isArray(refs) || refs.length === 0) return null;
  return (
    <ul className="mt-1.5 font-mono text-xs text-ink-3">
      {refs.filter(isRecord).map((r, i) => (
        <li key={i}>{location(r)}</li>
      ))}
    </ul>
  );
}

function Retrieved({ retrieved }: { retrieved: unknown }) {
  const ranked =
    isRecord(retrieved) && Array.isArray(retrieved.ranked) ? retrieved.ranked.filter(isRecord) : [];
  if (ranked.length === 0) return null;
  return (
    <Block label={strings.evals.retrieved}>
      <ol className="flex flex-col font-mono text-xs">
        {ranked.slice(0, 10).map((r, i) => {
          const hit = Array.isArray(r.hits) && r.hits.length > 0;
          return (
            <li key={i} className="flex gap-2 border-b border-rule py-1 last:border-b-0">
              <span className="w-5 shrink-0 text-right text-ink-3">{i + 1}</span>
              <span className={'w-7 shrink-0 ' + (hit ? 'text-ok' : 'text-ink-3')}>
                {hit ? 'hit' : ''}
              </span>
              <span className="min-w-0 break-words text-ink-2">
                {location(r) || String(r.chunkId ?? '')}
              </span>
            </li>
          );
        })}
      </ol>
    </Block>
  );
}
