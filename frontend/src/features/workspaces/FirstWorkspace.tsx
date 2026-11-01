import { useNavigate } from '@tanstack/react-router';
import { useMe, useSignOut } from '@/auth';
import { AuthShell, Button, TextLink } from '@/ui';
import { CreateWorkspaceForm } from './WorkspaceForm';
import { workspaceStrings } from './strings';

const t = workspaceStrings.first;

/** Shown at `/w` to someone with no workspaces yet. */
export function FirstWorkspace() {
  const navigate = useNavigate();
  const { me } = useMe();
  const { signOut, pending } = useSignOut();
  return (
    <AuthShell>
      <h1 className="heading-page">{t.title}</h1>
      <p className="mt-2 font-serif text-base text-pretty text-ink-2">{t.body}</p>
      <div className="mt-7">
        <CreateWorkspaceForm
          onCreated={(ws) =>
            void navigate({
              to: '/w/$workspaceId',
              params: { workspaceId: ws.id },
              replace: true,
            })
          }
        />
      </div>
      <p className="mt-8 text-sm text-ink-2">
        {t.demoPrompt} <TextLink to="/demo">{t.demoLink}</TextLink>
      </p>
      {/* Nothing else on this page leads anywhere, so the account needs its own exit. */}
      <div className="mt-10 flex flex-wrap items-center gap-x-3 text-sm text-ink-3">
        <span className="min-w-0 truncate">{me?.email}</span>
        <Button variant="ghost" size="sm" loading={pending} onClick={() => void signOut()}>
          {t.signOut}
        </Button>
      </div>
    </AuthShell>
  );
}
