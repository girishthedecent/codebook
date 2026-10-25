import { createFileRoute, Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { CaretRight } from '@phosphor-icons/react';
import { useMe } from '@/auth';
import { WorkspaceSwitcher } from '@/features/workspaces/WorkspaceSwitcher';
import { strings } from '@/features/account/strings';

// The phone "More" tab: everything that doesn't fit in the four bottom tabs. The workspace
// switcher sits at the top; its menu also holds the account rows (settings, sign out).
export const Route = createFileRoute('/w/$workspaceId/more')({
  component: MorePage,
});

const rowClass =
  'flex min-h-12 items-center justify-between gap-4 border-b border-rule px-4 text-sm text-ink';

function MorePage() {
  const { workspaceId } = Route.useParams();
  const { isAdmin, isGuest } = useMe();

  return (
    <nav aria-label={strings.nav.more}>
      <div className="border-b border-rule">
        <WorkspaceSwitcher collapsed={false} />
      </div>
      <ul>
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
  );
}

function Row({ children }: { children: ReactNode }) {
  return <li>{children}</li>;
}

function Caret() {
  return <CaretRight size={14} aria-hidden className="shrink-0 text-ink-3" />;
}
