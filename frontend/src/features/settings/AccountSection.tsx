import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { keys } from '@/api/queries/keys';
import { authClient, useMe, useSignOut } from '@/auth';
import {
  Button,
  Callout,
  Field,
  Input,
  SectionHeading,
  Skeleton,
  VisuallyHidden,
  toast,
} from '@/ui';
import { Avatar } from '@/features/account/Avatar';
import { strings } from '@/features/account/strings';

const s = strings.settings;
const MIN_PASSWORD = 8;

/** The signed-in person: picture, name, password, linked GitHub and sign-out. */
export function AccountSection({ githubFailed }: { githubFailed: boolean }) {
  const { me } = useMe();
  const accounts = useQuery({
    queryKey: ['me', 'accounts'],
    queryFn: async () => {
      const { data, error } = await authClient.listAccounts();
      if (error) throw new Error(error.message ?? 'Could not load linked accounts');
      return data;
    },
    staleTime: 5 * 60_000,
  });
  const { signOut, pending } = useSignOut();
  if (!me) return null;

  const hasPassword = accounts.data?.some((a) => a.providerId === 'credential') ?? false;
  const hasGitHub = accounts.data?.some((a) => a.providerId === 'github') ?? false;

  return (
    <section aria-labelledby="account" className="flex flex-col gap-8">
      <div>
        <SectionHeading id="account">{s.account}</SectionHeading>
        <div className="flex items-center gap-4">
          <Avatar name={me.name} image={me.image} size={56} />
          <div className="min-w-0">
            <p className="heading-minor truncate text-ink">{me.name}</p>
            <p className="truncate text-sm text-ink-2">{me.email}</p>
          </div>
        </div>
      </div>

      <NameForm name={me.name} />

      {accounts.isPending ? (
        <div role="status" className="flex flex-col gap-3">
          <VisuallyHidden>Loading sign-in methods</VisuallyHidden>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : accounts.isError ? (
        <Callout error={accounts.error} onRetry={() => void accounts.refetch()} />
      ) : (
        <>
          <PasswordBlock hasPassword={hasPassword} />
          <GitHubBlock linked={hasGitHub} failed={githubFailed} />
        </>
      )}

      <div>
        <Button variant="secondary" loading={pending} onClick={() => void signOut()}>
          {s.signOut}
        </Button>
      </div>
    </section>
  );
}

function NameForm({ name }: { name: string }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(name);
  const trimmed = value.trim();
  const save = useMutation({
    mutationFn: async (next: string) => {
      const { error } = await authClient.updateUser({ name: next });
      if (error) throw new Error(error.message ?? s.failed);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.me });
      toast({ title: s.nameSaved });
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (trimmed && trimmed !== name) save.mutate(trimmed);
  };

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <Field label={s.name} error={save.error?.message} className="min-w-52 flex-1">
        <Input
          name="name"
          autoComplete="name"
          maxLength={80}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </Field>
      <Button type="submit" loading={save.isPending} disabled={!trimmed || trimmed === name}>
        {s.nameSave}
      </Button>
    </form>
  );
}

function PasswordBlock({ hasPassword }: { hasPassword: boolean }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const change = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.changePassword({
        currentPassword: current,
        newPassword: next,
        revokeOtherSessions: true,
      });
      if (error) throw new Error(error.message ?? s.failed);
    },
    onSuccess: () => {
      toast({ title: s.password.saved });
      close();
    },
  });

  const close = () => {
    setOpen(false);
    setCurrent('');
    setNext('');
    change.reset();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    change.mutate();
  };

  return (
    <div>
      <h3 className="heading-minor text-ink">{s.password.title}</h3>
      {!hasPassword ? (
        <p className="mt-1 text-sm text-ink-2">{s.password.none}</p>
      ) : open ? (
        <form onSubmit={submit} className="mt-3 flex max-w-sm flex-col gap-4">
          <Field label={s.password.current}>
            <Input
              type="password"
              name="current-password"
              autoComplete="current-password"
              required
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </Field>
          <Field label={s.password.next} hint={s.password.hint}>
            <Input
              type="password"
              name="new-password"
              autoComplete="new-password"
              required
              minLength={MIN_PASSWORD}
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          </Field>
          {change.error && <Callout tone="error">{change.error.message}</Callout>}
          <div className="flex gap-2">
            <Button type="submit" variant="primary" loading={change.isPending}>
              {s.password.save}
            </Button>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button className="mt-3" onClick={() => setOpen(true)}>
          {s.password.change}
        </Button>
      )}
    </div>
  );
}

function GitHubBlock({ linked, failed }: { linked: boolean; failed: boolean }) {
  const link = useMutation({
    mutationFn: async () => {
      // The browser leaves for GitHub and comes back to the settings page.
      const { error } = await authClient.linkSocial({
        provider: 'github',
        callbackURL: `${window.location.origin}/settings`,
        errorCallbackURL: `${window.location.origin}/settings?github=failed`,
      });
      if (error) throw new Error(error.message ?? s.github.failed);
    },
  });

  return (
    <div>
      <h3 className="heading-minor text-ink">{s.github.title}</h3>
      <p className="mt-1 text-sm text-ink-2">{linked ? s.github.linked : s.github.notLinked}</p>
      {!linked && (
        <Button className="mt-3" loading={link.isPending} onClick={() => link.mutate()}>
          {s.github.link}
        </Button>
      )}
      {(failed || link.isError) && (
        <Callout tone="error" className="mt-3">
          {s.github.failed}
        </Callout>
      )}
    </div>
  );
}
