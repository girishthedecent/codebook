import { Link, useParams } from '@tanstack/react-router';
import { en } from '@/i18n/en';
import { cn } from '@/lib/cn';
import { WorkspaceSwitcher } from '@/features/workspaces/WorkspaceSwitcher';
import { SourcesSection } from '@/features/sources/SourcesSection';
import { ConversationsSection } from '@/features/chat/ConversationsSection';

/**
 * Workspace navigation. Sections are filled in by their features (conversations, sources,
 * study); this file owns only the frame and the primary links.
 */
export function Sidebar({ collapsed }: { collapsed: boolean }) {
  const { workspaceId } = useParams({ from: '/w/$workspaceId' });
  const links = [
    { to: '/w/$workspaceId' as const, label: en.nav.chat },
    { to: '/w/$workspaceId/sources' as const, label: en.nav.sources },
    { to: '/w/$workspaceId/graph' as const, label: en.nav.graph },
    { to: '/w/$workspaceId/study' as const, label: en.nav.study },
  ];
  return (
    <nav
      aria-label="Workspace"
      className={cn(
        'sticky top-0 h-dvh shrink-0 overflow-y-auto bg-paper-2/60 pb-6',
        collapsed ? 'w-14' : 'w-64',
      )}
    >
      <WorkspaceSwitcher collapsed={collapsed} />
      <ul className="px-2">
        {links.map((l) => (
          <li key={l.to}>
            <Link
              to={l.to}
              params={{ workspaceId }}
              activeOptions={{ exact: l.to === '/w/$workspaceId' }}
              className="block rounded-sm px-2 py-1.5 text-sm text-ink-2 hover:bg-paper-3 [&.active]:text-ink [&.active]:font-medium"
              title={collapsed ? l.label : undefined}
            >
              {collapsed ? l.label.slice(0, 1) : l.label}
            </Link>
          </li>
        ))}
      </ul>
      <div className="mt-4 space-y-6">
        <ConversationsSection workspaceId={workspaceId} collapsed={collapsed} />
        <SourcesSection workspaceId={workspaceId} collapsed={collapsed} />
      </div>
    </nav>
  );
}
