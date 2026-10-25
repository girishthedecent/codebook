import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { authClient, signOut, useMe } from '@/auth';
import { Button, Kbd } from '@/ui';
import { useTheme, type Theme } from '@/lib/theme';
import { shortcutLabel } from '@/lib/keyboard';
import { PageHeader, SectionHeading } from '@/features/account/PageHeader';
import { strings } from '@/features/account/strings';

const s = strings.settings;
const THEMES: Theme[] = ['system', 'light', 'dark'];

export function SettingsPage() {
  const { isGuest } = useMe();
  return (
    <>
      <PageHeader title={s.title} />
      <div className="max-w-[640px] space-y-10">
        <ThemePicker />
        <Shortcuts />
        {isGuest ? <GuestAccount /> : <Account />}
      </div>
    </>
  );
}

function ThemePicker() {
  const [theme, setTheme] = useTheme();
  return (
    <fieldset>
      <legend className="w-full">
        <SectionHeading>{s.theme}</SectionHeading>
      </legend>
      <div className="mt-2">
        {THEMES.map((t) => (
          <label
            key={t}
            className="flex min-h-11 cursor-pointer items-center gap-3 border-b border-rule text-sm last:border-b-0"
          >
            <input
              type="radio"
              name="theme"
              value={t}
              checked={theme === t}
              onChange={() => setTheme(t)}
              className="size-4 accent-[var(--accent)]"
            />
            {s.themes[t]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Shortcuts() {
  return (
    <section>
      <SectionHeading>{s.shortcuts}</SectionHeading>
      <dl>
        {s.shortcutRows.map((row) => (
          <div
            key={row.label}
            className="flex items-center justify-between gap-4 border-b border-rule py-2.5 text-sm last:border-b-0"
          >
            <dt className="text-ink">{row.label}</dt>
            <dd className="flex gap-1">
              {row.keys.map((k) => (
                <Kbd key={k}>{shortcutLabel(k)}</Kbd>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Account() {
  const { me } = useMe();
  const navigate = useNavigate();
  const accounts = useQuery({
    queryKey: ['me', 'accounts'],
    queryFn: async () => {
      const { data, error } = await authClient.listAccounts();
      if (error) throw new Error(error.message ?? 'Could not load linked accounts');
      return data;
    },
    staleTime: 5 * 60_000,
  });
  const github = accounts.data?.some((a) => a.providerId === 'github');

  return (
    <section>
      <SectionHeading>{s.account}</SectionHeading>
      <dl className="text-sm">
        <Row label={s.name}>{me?.name}</Row>
        <Row label={s.email}>{me?.email}</Row>
        <Row label={s.github}>
          {accounts.isPending ? '…' : github ? s.githubLinked : s.githubNotLinked}
        </Row>
      </dl>
      <div className="mt-6 flex flex-wrap gap-2">
        <Button
          variant="secondary"
          onClick={async () => {
            await signOut();
            void navigate({ to: '/' });
          }}
        >
          {strings.nav.signOut}
        </Button>
        <span className="inline-flex items-center gap-3">
          <Button variant="ghost" disabled aria-describedby="delete-unavailable">
            {s.deleteAccount}
          </Button>
          <span id="delete-unavailable" className="text-xs text-ink-3">
            {s.deleteUnavailable}
          </span>
        </span>
      </div>
    </section>
  );
}

function GuestAccount() {
  return (
    <section>
      <SectionHeading>{s.account}</SectionHeading>
      <p className="mt-3 text-sm text-ink-2">{s.guest}</p>
      <Button asChild variant="primary" className="mt-4">
        <Link to="/sign-in">{s.signIn}</Link>
      </Button>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-rule py-2.5 last:border-b-0">
      <dt className="text-ink-3">{label}</dt>
      <dd className="min-w-0 truncate text-ink">{children}</dd>
    </div>
  );
}
