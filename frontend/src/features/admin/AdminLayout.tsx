import { Outlet } from '@tanstack/react-router';
import { LinkTab, LinkTabs, PageHeader } from '@/ui';
import { strings } from './strings';

/** Admin pages: the page title, Evals / Monitoring as tabs, then the page. */
export function AdminLayout() {
  return (
    <div className="w-full">
      <PageHeader title={strings.title} intro={strings.intro} />
      <LinkTabs label="Admin sections">
        <LinkTab to="/admin/evals">{strings.nav.evals}</LinkTab>
        <LinkTab to="/admin/monitoring">{strings.nav.monitoring}</LinkTab>
      </LinkTabs>
      <div className="pt-6">
        <Outlet />
      </div>
    </div>
  );
}
