import { createFileRoute, Link, useLocation } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { CaretRight } from '@phosphor-icons/react';
import { useMe } from '@/auth';
import { useSignOut } from '@/auth/useSignOut';
import { Button, PageHeader } from '@/ui';
import { en } from '@/i18n/en';
import { strings } from '@/features/account/strings';
import { shellStrings } from '@/features/shell/strings';

// The phone "More" tab: everything that doesn't fit in the four bottom tabs. The workspace
// switcher sits at the top bar; its menu also holds the account rows.
export const Route = createFileRoute('/w/$workspaceId/more')({
  component: MorePage,
});

const rowClass =
  'flex min-h-12 items-center justify-between gap-4 rounded-sm px-2 text-sm text-ink hover:bg-paper-2';

function MorePage() {
  const { workspaceId } = Route.useParams();
  const { me, isAdmin, isGuest } = useMe();
  const { signOut, pending } = useSignOut();
  const href = useLocation({ select: (l) => l.href });

  return (
    <div className="px-4 py-6">
      <PageHeader
        title={shellStrings.more.title}
        intro={
          isGuest ? shellStrings.more.demoVisitor : me && shellStrings.more.signedInAs(me.email)
        }
        className="mb-4"
      />
      <nav aria-label={strings.nav.more}>
        <ul className="-mx-2">
          <Row>
            <Link to="/w/$workspaceId/graph" params={{ workspaceId }} className={rowClass}>
              {strings.nav.graph}
              <Caret />
            </Link>
          </Row>
          {!isGuest && (
            <Row>
              <Link to="/memory" className={rowClass}>
                {strings.nav.memory}
                <Caret />
              </Link>
            </Row>
          )}
          <Row>
            <Link to="/usage" className={rowClass}>
              {strings.nav.usage}
              <Caret />
            </Link>
          </Row>
          <Row>
            <Link to="/settings" className={rowClass}>
              {strings.nav.settings}
              <Caret />
            </Link>
          </Row>
          {isAdmin && (
            <Row>
              <Link to="/admin" className={rowClass}>
                {strings.nav.admin}
                <Caret />
              </Link>
            </Row>
          )}
        </ul>
      </nav>
      <div className="mt-8">
        {isGuest ? (
          <Button asChild variant="primary">
            <Link to="/sign-in" search={{ next: href }}>
              {en.auth.signIn}
            </Link>
          </Button>
        ) : (
          <Button loading={pending} onClick={() => void signOut()}>
            {strings.nav.signOut}
          </Button>
        )}
      </div>
    </div>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <li>{children}</li>;
}

function Caret() {
  return <CaretRight size={14} aria-hidden className="shrink-0 text-ink-3" />;
}
