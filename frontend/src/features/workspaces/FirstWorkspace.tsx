import { Link, useNavigate } from '@tanstack/react-router';
import { CreateWorkspaceForm } from './WorkspaceForm';
import { workspaceStrings } from './strings';

const t = workspaceStrings.first;

/** Shown at `/w` to someone with no workspaces yet. */
export function FirstWorkspace() {
  const navigate = useNavigate();
  return (
    <div className="min-h-dvh bg-paper text-ink">
      <main className="mx-auto max-w-[720px] px-4 pt-10 pb-16 sm:pt-16">
        <Link to="/" className="font-mono text-xs tracking-wide text-ink-3 hover:text-ink">
          CodeBook
        </Link>
        <div className="mt-8 max-w-[440px]">
          <h1 className="font-serif text-xl font-semibold">{t.title}</h1>
          <p className="mt-2 text-sm text-ink-2">{t.body}</p>
          <div className="mt-8">
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
        </div>
      </main>
    </div>
  );
}
