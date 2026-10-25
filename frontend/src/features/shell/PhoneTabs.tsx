import { Link, useParams } from '@tanstack/react-router';
import { icons, labels } from './navItems';

/** Bottom tabs on phones: an icon over a label; the active one is ink, the rest ink-3. */
export function PhoneTabs() {
  const { workspaceId } = useParams({ from: '/w/$workspaceId' });
  const tabs = [
    { to: '/w/$workspaceId' as const, label: labels.chat, Icon: icons.chat, exact: true },
    { to: '/w/$workspaceId/sources' as const, label: labels.sources, Icon: icons.sources },
    { to: '/w/$workspaceId/study' as const, label: labels.study, Icon: icons.study },
    { to: '/w/$workspaceId/more' as const, label: labels.more, Icon: icons.more },
  ];
  return (
    <nav
      aria-label="Sections"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-rule bg-paper pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="grid grid-cols-4">
        {tabs.map(({ to, label, Icon, exact }) => (
          <li key={to}>
            <Link
              to={to}
              params={{ workspaceId }}
              activeOptions={{ exact }}
              className="flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs text-ink-3 [&.active]:font-medium [&.active]:text-ink [@media(max-height:480px)]:min-h-10 [@media(max-height:480px)]:flex-row [@media(max-height:480px)]:gap-2"
            >
              <Icon size={22} aria-hidden />
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
