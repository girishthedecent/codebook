import { Link } from '@tanstack/react-router';
import { useMe } from '@/auth';
import { Button, Kbd, PageHeader, RadioGroup, SectionHeading, TextLink } from '@/ui';
import { useTheme, type Theme } from '@/lib/theme';
import { strings } from '@/features/account/strings';
import { AccountSection } from './AccountSection';
import { DataSection } from './DataSection';
import { ReadingSection } from './ReadingSection';
import { shortcutRows } from './shortcuts';

const s = strings.settings;
const THEMES: Theme[] = ['system', 'light', 'dark'];

export function SettingsPage({ githubFailed = false }: { githubFailed?: boolean }) {
  const { isGuest } = useMe();
  return (
    <>
      <PageHeader title={s.title} />
      <div className="flex max-w-narrow flex-col gap-10">
        <ThemePicker />
        <ReadingSection />
        <Shortcuts />
        {isGuest ? <GuestAccount /> : <AccountSection githubFailed={githubFailed} />}
        {!isGuest && <DataSection />}
      </div>
    </>
  );
}

function ThemePicker() {
  const [theme, setTheme] = useTheme();
  return (
    <section aria-labelledby="theme">
      <SectionHeading id="theme">{s.theme}</SectionHeading>
      <RadioGroup
        aria-labelledby="theme"
        value={theme}
        onValueChange={(value) => setTheme(value as Theme)}
        options={THEMES.map((value) => ({ value, label: s.themes[value] }))}
      />
    </section>
  );
}

function Shortcuts() {
  return (
    // No keyboard on a phone, so the list would only be noise there.
    <section aria-labelledby="shortcuts" className="max-sm:hidden">
      <SectionHeading id="shortcuts">{s.shortcuts}</SectionHeading>
      <dl className="flex flex-col gap-3">
        {shortcutRows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-4 text-sm">
            <dt className="text-ink-2">{row.label}</dt>
            <dd className="m-0 flex shrink-0 gap-1">
              {row.keys.map((key) => (
                <Kbd key={key}>{key}</Kbd>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function GuestAccount() {
  return (
    <section aria-labelledby="account">
      <SectionHeading id="account">{s.account}</SectionHeading>
      <p className="text-sm text-ink-2">{s.guest}</p>
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1">
        <Button asChild variant="primary">
          <Link to="/sign-in">{s.signIn}</Link>
        </Button>
        <TextLink to="/demo" className="py-2">
          {s.backToDemo}
        </TextLink>
      </div>
    </section>
  );
}
