import { Link, useLocation } from '@tanstack/react-router';
import { cn } from '@/lib/cn';
import { icons, isAccountPath, labels } from './navItems';

const tabClass =
  'flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs text-ink-3 ' +
  '[&.active]:font-medium [&.active]:text-ink [@media(max-height:480px)]:min-h-11 ' +
  '[@media(max-height:480px)]:flex-row [@media(max-height:480px)]:gap-2';

/** Bottom tabs on phones: an icon over a label; the active one is ink, the rest ink-3. */
export function PhoneTabs({ workspaceId }: { workspaceId: string }) {
  const onAccountPage = useLocation({ select: (l) => isAccountPath(l.pathname) });
  const tabs = [
    { to: '/w/$workspaceId' as const, label: labels.chat, Icon: icons.chat, exact: true },
    { to: '/w/$workspaceId/sources' as const, label: labels.sources, Icon: icons.sources },
    { to: '/w/$workspaceId/study' as const, label: labels.study, Icon: icons.study },
    { to: '/w/$workspaceId/more' as const, label: labels.more, Icon: icons.more },
  ];
  return (
    <nav
      aria-label="Sections"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-rule bg-paper pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]"
    >
      <ul className="grid grid-cols-4">
        {tabs.map(({ to, label, Icon, exact }) => (
          <li key={to}>
            <Link
              to={to}
              params={{ workspaceId }}
              activeOptions={{ exact }}
              className={cn(
                tabClass,
                to.endsWith('/more') && onAccountPage && 'font-medium text-ink',
              )}
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
