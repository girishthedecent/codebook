import { useUsage } from '@/api/queries/usage';
import type { Usage, UsageDay } from '@/api/types';
import { useMe } from '@/auth';
import { Callout, PageHeader, ProgressRule, SectionHeading, Stat, Stats, TextLink } from '@/ui';
import { ListLoading } from '@/features/account/ListLoading';
import { formatBytes, formatCost, formatCount, formatReset } from '@/features/account/format';
import { strings } from '@/features/account/strings';
import { DayBars } from './DayBars';

const s = strings.usage;
const LIMITS = ['messagesThisHour', 'messagesToday', 'tokensToday'] as const;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export function UsagePage() {
  const { isGuest } = useMe();
  const usage = useUsage();
  const data = usage.data;

  return (
    <>
      <PageHeader title={s.title} intro={isGuest ? s.guestIntro : s.intro} />
      <div className="flex max-w-narrow flex-col gap-12">
        {usage.isPending ? (
          <ListLoading label={s.loading} />
        ) : usage.isError || !data ? (
          <Callout error={usage.error ?? undefined} onRetry={() => void usage.refetch()} />
        ) : data.guest ? (
          <GuestAllowance guest={data.guest} />
        ) : (
          <>
            <Week usage={data} />
            <Limits usage={data} />
            <Storage usage={data} />
          </>
        )}
      </div>
    </>
  );
}

function sum(days: UsageDay[]) {
  return days.reduce(
    (acc, d) => ({
      questions: acc.questions + d.questions,
      tokens: acc.tokens + d.tokensIn + d.tokensOut,
      cost: acc.cost + d.costUsd,
    }),
    { questions: 0, tokens: 0, cost: 0 },
  );
}

/** The last seven days in figures, the fourteen behind them as columns, and the month in a line. */
function Week({ usage }: { usage: Usage }) {
  const { days } = usage;
  const week = sum(days.slice(-7));
  const before = days.length >= 14 ? sum(days.slice(-14, -7)) : null;
  const month = usage.last30Days;
  return (
    <section aria-labelledby="week">
      <SectionHeading id="week" hint={s.weekHint}>
        {s.week}
      </SectionHeading>
      <Stats className="mb-7">
        <Stat
          label={s.questions}
          value={formatCount(week.questions)}
          note={before && `· ${s.weekBefore(formatCount(before.questions))}`}
        />
        <Stat label={s.tokens} value={formatCount(week.tokens)} />
        <Stat label={s.cost} value={formatCost(String(week.cost))} />
      </Stats>
      <DayBars days={days} />
      <p className="mt-5 border-t border-rule pt-3 text-xs text-ink-3">
        {s.month(
          formatCount(month.messages),
          formatCount(month.tokensIn + month.tokensOut),
          formatCost(month.costUsd),
        )}
      </p>
    </section>
  );
}

/**
 * When each limit starts over. The server counts in fixed windows from the epoch (an hour, a
 * day), and the token budget counts the UTC day, so the next boundary is the reset.
 */
function resetOf(key: (typeof LIMITS)[number], now = Date.now()) {
  const window = key === 'messagesThisHour' ? HOUR_MS : DAY_MS;
  return new Date((Math.floor(now / window) + 1) * window).toISOString();
}

function Limits({ usage }: { usage: Usage }) {
  return (
    <section aria-labelledby="limits">
      <SectionHeading id="limits">{s.limits}</SectionHeading>
      <ul className="flex flex-col gap-6">
        {LIMITS.map((key) => {
          const { limit, remaining } = usage.limits[key];
          const used = limit > 0 ? (limit - remaining) / limit : 0;
          return (
            <li key={key}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 text-sm">
                <span className="text-ink">{s.limitRows[key]}</span>
                <span className="text-ink-2 tabular-nums">
                  {s.remaining(formatCount(remaining), formatCount(limit))}
                </span>
              </div>
              <ProgressRule value={used} label={s.limitRows[key]} className="mt-2" />
              <p className="mt-1.5 text-xs text-ink-3">{s.resets(formatReset(resetOf(key)))}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function GuestAllowance({ guest }: { guest: NonNullable<Usage['guest']> }) {
  const left = Math.max(0, guest.limit - guest.used);
  return (
    <section aria-labelledby="allowance">
      <SectionHeading id="allowance">{s.limits}</SectionHeading>
      <div className="flex items-baseline justify-between gap-4 text-sm">
        <span className="text-ink">{s.guestLabel}</span>
        <span className="text-ink tabular-nums">{s.guestLeft(left, guest.limit)}</span>
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

function Storage({ usage }: { usage: Usage }) {
  const { pdfBytes, limitBytes } = usage.storage;
  return (
    <section aria-labelledby="storage">
      <SectionHeading id="storage">{s.storage}</SectionHeading>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 text-sm">
        <span className="text-ink">
          {s.storageRow(formatBytes(pdfBytes), formatBytes(limitBytes))}
        </span>
        <span className="text-ink-2 tabular-nums">{s.sources(usage.sources)}</span>
      </div>
      <ProgressRule
        value={limitBytes > 0 ? pdfBytes / limitBytes : 0}
        label={s.storage}
        className="mt-2"
      />
    </section>
  );
}
