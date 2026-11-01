import { useUsage } from '@/api/queries/usage';
import type { Usage } from '@/api/types';
import { useMe } from '@/auth';
import {
  Callout,
  DataTable,
  PageHeader,
  ProgressRule,
  SectionHeading,
  TBody,
  TD,
  TH,
  THead,
  TR,
  TextLink,
} from '@/ui';
import { ListLoading } from '@/features/account/ListLoading';
import { formatBytes, formatCost, formatCount, formatReset } from '@/features/account/format';
import { strings } from '@/features/account/strings';

const s = strings.usage;
const PERIODS = ['today', 'last7Days', 'last30Days'] as const;
const LIMITS = ['messagesThisHour', 'messagesToday', 'tokensToday'] as const;

export function UsagePage() {
  const { isGuest } = useMe();
  const usage = useUsage();

  return (
    <>
      <PageHeader title={s.title} intro={isGuest ? s.guestIntro : s.intro} />
      <div className="flex max-w-narrow flex-col gap-10">
        {usage.isPending ? (
          <ListLoading label="Loading usage" />
        ) : usage.isError ? (
          <Callout error={usage.error} onRetry={() => void usage.refetch()} />
        ) : (
          <>
            {usage.data.guest ? (
              <GuestAllowance guest={usage.data.guest} />
            ) : (
              <Limits usage={usage.data} />
            )}
            {!isGuest && <Totals usage={usage.data} />}
            {!isGuest && <Storage usage={usage.data} />}
          </>
        )}
      </div>
    </>
  );
}

function GuestAllowance({ guest }: { guest: NonNullable<Usage['guest']> }) {
  const left = Math.max(0, guest.limit - guest.used);
  return (
    <section aria-labelledby="allowance">
      <SectionHeading id="allowance">{s.limits}</SectionHeading>
      <div className="flex items-baseline justify-between gap-4 text-sm">
        <span className="text-ink">{s.guestLabel}</span>
        <span className="tabular-nums text-ink">{s.guestLeft(left, guest.limit)}</span>
      </div>
      <ProgressRule
        value={guest.limit > 0 ? guest.used / guest.limit : 1}
        label={s.guestLabel}
        className="mt-2"
      />
      <p className="mt-2 text-xs text-ink-3">
        {left === 0 && `${s.guestEmpty} `}
        {s.guestResets(formatReset(guest.resetsAt))}
      </p>
      <p className="mt-5 text-sm text-ink-2">
        {s.guestMore} <TextLink to="/sign-in">{s.guestSignIn}</TextLink>
      </p>
    </section>
  );
}

function Limits({ usage }: { usage: Usage }) {
  return (
    <section aria-labelledby="limits">
      <SectionHeading id="limits">{s.limits}</SectionHeading>
      <ul className="flex flex-col gap-5">
        {LIMITS.map((key) => {
          const { limit, remaining } = usage.limits[key];
          const used = limit > 0 ? (limit - remaining) / limit : 0;
          return (
            <li key={key}>
              <div className="flex items-baseline justify-between gap-4 text-sm">
                <span className="text-ink">{s.limitRows[key]}</span>
                <span className="tabular-nums text-ink-2">
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

function Totals({ usage }: { usage: Usage }) {
  return (
    <section aria-labelledby="totals">
      <SectionHeading id="totals">{s.totals}</SectionHeading>
      <DataTable label={s.totals}>
        <THead>
          <TR>
            <TH>{s.cols.period}</TH>
            <TH className="text-right">{s.cols.messages}</TH>
            <TH className="text-right max-sm:hidden">{s.cols.tokensIn}</TH>
            <TH className="text-right max-sm:hidden">{s.cols.tokensOut}</TH>
            <TH className="text-right">{s.cols.cost}</TH>
          </TR>
        </THead>
        <TBody>
          {PERIODS.map((p) => (
            <TR key={p}>
              <TD>{s.periods[p]}</TD>
              <TD numeric>{formatCount(usage[p].messages)}</TD>
              <TD numeric className="max-sm:hidden">
                {formatCount(usage[p].tokensIn)}
              </TD>
              <TD numeric className="max-sm:hidden">
                {formatCount(usage[p].tokensOut)}
              </TD>
              <TD numeric>{formatCost(usage[p].costUsd)}</TD>
            </TR>
          ))}
        </TBody>
      </DataTable>
    </section>
  );
}

function Storage({ usage }: { usage: Usage }) {
  const { pdfBytes, limitBytes } = usage.storage;
  return (
    <section aria-labelledby="storage">
      <SectionHeading id="storage">{s.storage}</SectionHeading>
      <div className="flex items-baseline justify-between gap-4 text-sm">
        <span className="text-ink">
          {s.storageRow(formatBytes(pdfBytes), formatBytes(limitBytes))}
        </span>
        <span className="tabular-nums text-ink-2">{s.sources(usage.sources)}</span>
      </div>
      <ProgressRule
        value={limitBytes > 0 ? pdfBytes / limitBytes : 0}
        label={s.storage}
        className="mt-2"
      />
    </section>
  );
}
