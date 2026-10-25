import { Link, useParams } from '@tanstack/react-router';
import { en } from '@/i18n/en';

/** Bottom tabs on phones. Four plain text labels; the active one is ink, the rest ink-3. */
export function PhoneTabs() {
  const { workspaceId } = useParams({ from: '/w/$workspaceId' });
  const tabs = [
    { to: '/w/$workspaceId' as const, label: en.nav.chat, exact: true },
    { to: '/w/$workspaceId/sources' as const, label: en.nav.sources },
    { to: '/w/$workspaceId/study' as const, label: en.nav.study },
    { to: '/w/$workspaceId/more' as const, label: en.nav.more },
  ];
  return (
    <nav
      aria-label="Sections"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-rule bg-paper pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="grid grid-cols-4">
        {tabs.map((t) => (
          <li key={t.to}>
            <Link
              to={t.to}
              params={{ workspaceId }}
              activeOptions={{ exact: t.exact }}
              className="flex min-h-14 items-center justify-center text-sm text-ink-3 [&.active]:text-ink [&.active]:font-medium"
            >
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
