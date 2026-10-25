import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { GithubLogo } from '@phosphor-icons/react';
import { isApiError } from '@/api/client';
import { signInWithEmail, signInWithGitHub, signUpWithEmail, useMe } from '@/auth';
import { Button, Field, Input, TabPanel, Tabs } from '@/ui';
import { authStrings as t } from './strings';
import { safeNext } from './safeNext';

type Mode = 'signIn' | 'signUp';

export function SignInPage({ next, reason }: { next?: string; reason?: 'guest' }) {
  const navigate = useNavigate();
  const { isGuest } = useMe();
  const [mode, setMode] = useState<Mode>('signIn');
  const [github, setGithub] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const target = safeNext(next);

  const continueWithGitHub = async () => {
    setGithub({ busy: true });
    try {
      // The browser leaves for GitHub; better-auth checks this origin against its trusted list.
      await signInWithGitHub(window.location.origin + target);
    } catch (error) {
      setGithub({ busy: false, error: messageOf(error) });
    }
  };

  const done = () => void navigate({ href: target, replace: true });

  return (
    <div className="min-h-dvh bg-paper text-ink">
      <main className="mx-auto max-w-[720px] px-4 pt-10 pb-16 sm:pt-16">
        <Link to="/" className="font-mono text-xs tracking-wide text-ink-3 hover:text-ink">
          CodeBook
        </Link>

        <div className="mt-8 max-w-[360px]">
          <h1 className="font-serif text-xl font-semibold">{t.title}</h1>
          {reason === 'guest' && <p className="mt-2 text-sm text-ink-2">{t.reasonGuest}</p>}

          <Button
            variant="secondary"
            className="mt-8 h-10 w-full"
            loading={github.busy}
            onClick={continueWithGitHub}
          >
            {!github.busy && <GithubLogo size={16} aria-hidden />}
            {t.github}
          </Button>
          {github.error && (
            <p role="alert" className="mt-2 text-xs text-error">
              {github.error}
            </p>
          )}

          <p className="mt-8 text-xs text-ink-3">{t.orEmail}</p>
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
              <EmailForm mode="signIn" onDone={done} />
            </TabPanel>
            <TabPanel value="signUp">
              <EmailForm mode="signUp" onDone={done} />
            </TabPanel>
          </Tabs>

          {isGuest && <p className="mt-6 text-xs text-ink-3">{t.guestLink}</p>}
        </div>
      </main>
    </div>
  );
}

function EmailForm({ mode, onDone }: { mode: Mode; onDone: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      if (mode === 'signIn') await signInWithEmail(email.trim(), password);
      else await signUpWithEmail(name.trim(), email.trim(), password);
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
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-10"
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
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-10"
        />
      </Field>
      <Field
        label={t.fields.password}
        hint={mode === 'signUp' ? t.fields.passwordHint : undefined}
        error={error}
      >
        <Input
          type="password"
          name="password"
          autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
          required
          minLength={mode === 'signUp' ? 8 : undefined}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="h-10"
        />
      </Field>
      <Button type="submit" variant="primary" className="h-10" loading={busy}>
        {mode === 'signIn' ? t.submit.signIn : t.submit.signUp}
      </Button>
    </form>
  );
}

function messageOf(error: unknown) {
  if (isApiError(error, 429)) return 'Too many attempts. Wait a minute and try again.';
  if (isApiError(error)) return error.message;
  return 'Something went wrong. Try again.';
}
