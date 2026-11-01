import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { GithubLogo } from '@phosphor-icons/react';
import { isApiError } from '@/api/client';
import { signInWithEmail, signInWithGitHub, signUpWithEmail, useMe } from '@/auth';
import { AuthShell, Button, Callout, Field, Input, TabPanel, Tabs, TextLink } from '@/ui';
import { authStrings as t } from './strings';
import { safeNext } from './safeNext';

type Mode = 'signIn' | 'signUp';
type Values = { name: string; email: string; password: string };

export function SignInPage({
  next,
  reason,
  oauthFailed,
}: {
  next?: string;
  reason?: 'guest';
  oauthFailed?: boolean;
}) {
  const navigate = useNavigate();
  const { isGuest } = useMe();
  const [mode, setMode] = useState<Mode>('signIn');
  // Held here, not in the forms, so switching tabs doesn't lose what was typed.
  const [values, setValues] = useState<Values>({ name: '', email: '', password: '' });
  const [github, setGithub] = useState<{ busy: boolean; error?: string }>({
    busy: false,
    error: oauthFailed ? t.githubFailed : undefined,
  });
  const target = safeNext(next);

  // Coming back from GitHub with the back button restores this page from memory, spinner and all.
  useEffect(() => {
    const reset = (e: PageTransitionEvent) => {
      if (e.persisted) setGithub((g) => ({ ...g, busy: false }));
    };
    window.addEventListener('pageshow', reset);
    return () => window.removeEventListener('pageshow', reset);
  }, []);

  const continueWithGitHub = async () => {
    setGithub({ busy: true });
    try {
      // The browser leaves for GitHub; better-auth checks this origin against its trusted list.
      const back = new URLSearchParams({ next: target }).toString();
      await signInWithGitHub(
        window.location.origin + target,
        `${window.location.origin}/sign-in?${back}&error=github`,
      );
    } catch (error) {
      setGithub({ busy: false, error: messageOf(error) });
    }
  };

  const done = () => void navigate({ href: target, replace: true });
  const change = (patch: Partial<Values>) => setValues((v) => ({ ...v, ...patch }));

  return (
    <AuthShell
      aside={
        <>
          <p className="heading-display text-ink">{t.aside.line}</p>
          <p className="mt-4 font-serif text-base text-pretty text-ink-2">{t.aside.body}</p>
        </>
      }
    >
      <h1 className="heading-page">{mode === 'signIn' ? t.title : t.createTitle}</h1>
      <p className="mt-2 font-serif text-base text-pretty text-ink-2">
        {mode === 'signIn' ? t.intro : t.createIntro}
      </p>
      {reason === 'guest' && <Callout className="mt-5">{t.reasonGuest}</Callout>}

      <Button
        variant="secondary"
        className="mt-6 w-full"
        loading={github.busy}
        onClick={continueWithGitHub}
      >
        {!github.busy && <GithubLogo size={18} weight="fill" aria-hidden className="shrink-0" />}
        {t.github}
      </Button>
      {github.error && (
        <Callout tone="error" className="mt-3">
          {github.error}
        </Callout>
      )}

      <p className="mt-7 text-xs text-ink-3">{t.orEmail}</p>
      <Tabs
        label={t.orEmail}
        className="mt-2"
        value={mode}
        onValueChange={(v) => setMode(v as Mode)}
        items={[
          { value: 'signIn', label: t.tabs.signIn },
          { value: 'signUp', label: t.tabs.signUp },
        ]}
      >
        <TabPanel value="signIn">
          <EmailForm mode="signIn" values={values} onChange={change} onDone={done} />
        </TabPanel>
        <TabPanel value="signUp">
          <EmailForm mode="signUp" values={values} onChange={change} onDone={done} />
        </TabPanel>
      </Tabs>

      {isGuest && <p className="mt-6 text-xs text-ink-3">{t.guestLink}</p>}

      <p className="mt-8 text-sm text-ink-2">
        {t.noAccount} <TextLink to="/demo">{t.tryDemo}</TextLink>
      </p>
    </AuthShell>
  );
}

function EmailForm({
  mode,
  values,
  onChange,
  onDone,
}: {
  mode: Mode;
  values: Values;
  onChange: (patch: Partial<Values>) => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const email = values.email.trim();
      if (mode === 'signIn') await signInWithEmail(email, values.password);
      else await signUpWithEmail(values.name.trim(), email, values.password);
      onDone();
    } catch (e) {
      setError(messageOf(e));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {mode === 'signUp' && (
        <Field label={t.fields.name}>
          <Input
            name="name"
            autoComplete="name"
            required
            maxLength={80}
            value={values.name}
            onChange={(e) => onChange({ name: e.target.value })}
          />
        </Field>
      )}
      <Field label={t.fields.email}>
        <Input
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          required
          value={values.email}
          onChange={(e) => onChange({ email: e.target.value })}
        />
      </Field>
      <Field label={t.fields.password} hint={mode === 'signUp' ? t.fields.passwordHint : undefined}>
        <Input
          type="password"
          name="password"
          autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
          required
          minLength={mode === 'signUp' ? 8 : undefined}
          value={values.password}
          onChange={(e) => onChange({ password: e.target.value })}
        />
      </Field>
      {error && <Callout tone="error">{error}</Callout>}
      <Button type="submit" variant="primary" className="w-full" loading={busy}>
        {mode === 'signIn' ? t.submit.signIn : t.submit.signUp}
      </Button>
    </form>
  );
}

function messageOf(error: unknown) {
  if (isApiError(error, 429)) return t.tooMany;
  if (isApiError(error)) return error.message;
  return t.failed;
}
