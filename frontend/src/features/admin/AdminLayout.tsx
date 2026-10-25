import { Link, Outlet } from '@tanstack/react-router';
import { strings } from './strings';

const tab =
  '-mb-px flex min-h-10 items-center border-b-2 border-transparent px-0.5 text-sm text-ink-2 ' +
  'transition-colors duration-150 ease-out hover:text-ink [&.active]:border-ink [&.active]:text-ink';

/** Admin pages: a heading, Evals / Monitoring as tabs on a hairline, then the page. */
export function AdminLayout() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6">
      <h1 className="text-lg font-semibold text-ink">{strings.title}</h1>
      <nav aria-label="Admin sections" className="mt-3 flex gap-5 border-b border-rule">
        <Link to="/admin/evals" className={tab}>
          {strings.nav.evals}
        </Link>
        <Link to="/admin/monitoring" className={tab}>
          {strings.nav.monitoring}
        </Link>
      </nav>
      <div className="pt-6">
        <Outlet />
      </div>
    </div>
  );
}
