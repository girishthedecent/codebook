import { createFileRoute } from '@tanstack/react-router';
import { DemoEntry } from '@/features/auth/DemoEntry';

type DemoSearch = { q?: string; next?: string };

// `q` is a question to ask once the demo opens; `next` is a path to land on instead.
export const Route = createFileRoute('/demo')({
  validateSearch: (search: Record<string, unknown>): DemoSearch => {
    const out: DemoSearch = {};
    if (typeof search.q === 'string' && search.q.trim()) out.q = search.q.trim().slice(0, 1000);
    if (typeof search.next === 'string') out.next = search.next;
    return out;
  },
  component: DemoEntry,
});
