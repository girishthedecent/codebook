import { useUsage } from '@/api/queries/usage';
import type { Usage } from '@/api/types';
import { useMe } from '@/auth';
import { ProgressRule, Table, TBody, TD, TH, THead, TR } from '@/ui';
import { InlineError } from '@/features/account/InlineError';
import { PageHeader, SectionHeading } from '@/features/account/PageHeader';
import { formatBytes, formatCost, formatCount } from '@/features/account/format';
import { strings } from '@/features/account/strings';

const s = strings.usage;
const PERIODS = ['today', 'last7Days', 'last30Days'] as const;
const LIMITS = ['messagesThisHour', 'messagesToday', 'tokensToday'] as const;

export function UsagePage() {
  const { isGuest } = useMe();
  const usage = useUsage();

  return (
    <>
      <PageHeader title={s.title} intro={isGuest ? s.guest : s.intro} />
      <div className="max-w-[720px] space-y-10">
        {usage.isPending ? (
          <ProgressRule label="Loading usage" />
        ) : usage.isError ? (
          <InlineError error={usage.error} retry={() => void usage.refetch()} />
        ) : (
          <>
            <Limits usage={usage.data} />
            {!isGuest && <Totals usage={usage.data} />}
            {!isGuest && <Storage usage={usage.data} />}
          </>
        )}
      </div>
    </>
  );
}

function Totals({ usage }: { usage: Usage }) {
  return (
    <section>
      <Table>
        <THead>
          <TR>
            <TH>{s.cols.period}</TH>
            <TH className="text-right">{s.cols.messages}</TH>
            <TH className="text-right max-[719px]:hidden">{s.cols.tokensIn}</TH>
            <TH className="text-right max-[719px]:hidden">{s.cols.tokensOut}</TH>
            <TH className="text-right">{s.cols.cost}</TH>
          </TR>
        </THead>
        <TBody>
          {PERIODS.map((p) => (
            <TR key={p}>
              <TD>{s.periods[p]}</TD>
              <TD numeric>{formatCount(usage[p].messages)}</TD>
              <TD numeric className="max-[719px]:hidden">
                {formatCount(usage[p].tokensIn)}
              </TD>
              <TD numeric className="max-[719px]:hidden">
                {formatCount(usage[p].tokensOut)}
              </TD>
              <TD numeric>{formatCost(usage[p].costUsd)}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </section>
  );
}

function Limits({ usage }: { usage: Usage }) {
  return (
    <section>
      <SectionHeading>{s.limits}</SectionHeading>
      <ul>
        {LIMITS.map((key) => {
          const { limit, remaining } = usage.limits[key];
          const used = limit > 0 ? (limit - remaining) / limit : 0;
          return (
            <li key={key} className="border-b border-rule py-3 last:border-b-0">
              <div className="flex items-baseline justify-between gap-4 text-sm">
                <span className="text-ink">{s.limitRows[key]}</span>
                <span className="font-mono text-xs tabular-nums text-ink-2">
                  {s.remaining(formatCount(remaining), formatCount(limit))}
                </span>
              </div>
              <ProgressRule value={used} label={s.limitRows[key]} className="mt-2" />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Storage({ usage }: { usage: Usage }) {
  const { pdfBytes, limitBytes } = usage.storage;
  return (
    <section>
      <SectionHeading>{s.storage}</SectionHeading>
      <div className="py-3">
        <div className="flex items-baseline justify-between gap-4 text-sm">
          <span className="text-ink">
            {s.storageRow(formatBytes(pdfBytes), formatBytes(limitBytes))}
          </span>
          <span className="font-mono text-xs tabular-nums text-ink-2">
            {s.sources(usage.sources)}
          </span>
        </div>
        <ProgressRule
          value={limitBytes > 0 ? pdfBytes / limitBytes : 0}
          label={s.storage}
          className="mt-2"
        />
      </div>
    </section>
  );
}
