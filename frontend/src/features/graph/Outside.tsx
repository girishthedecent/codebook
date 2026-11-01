import { useMemo, useState } from 'react';
import type { GraphDependencies } from '@/api/types';
import { SectionHeading, TextButton } from '@/ui';
import { graphStrings as t } from './strings';

type External = GraphDependencies['external'][number];

// What the backend lists at most, so a list this long was cut.
const BACKEND_CAP = 100;
const FIRST_GROUPS = 6;
const FIRST_NAMES = 6;
const OWN = new Set(['this', 'self', 'cls', 'super']);

type Group = {
  key: string;
  label: string;
  tone: 'library' | 'other' | 'own' | 'direct';
  calls: number;
  names: Map<string, number>;
};

const order = { library: 0, other: 1, own: 2, direct: 3 } as const;

/** `@scope/name`, `lodash` for `lodash/fp`, `torch` for `torch.nn`, `node:fs` as it is. */
function packageOf(specifier: string) {
  const parts = specifier.split('/');
  const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
  return name.startsWith('node:') ? name : name.split('.')[0]!;
}

/**
 * The names a symbol uses that the repository doesn't define, grouped by what each call
 * starts with (`Buffer.from` is under Buffer). A group that is one of the libraries from the
 * overview is marked as one; the rest are built-ins or calls the graph couldn't match.
 */
export function groupExternal(external: External[], packages: ReadonlySet<string>): Group[] {
  const groups = new Map<string, Group>();
  for (const { toName, type } of external) {
    // An import names its module, which is the library.
    const imported = type === 'IMPORTS';
    const dot = toName.indexOf('.');
    const head = imported ? packageOf(toName) : dot === -1 ? '' : toName.slice(0, dot);
    const member = imported ? toName : dot === -1 ? toName : toName.slice(dot + 1);
    const tone: Group['tone'] = imported
      ? 'library'
      : dot === -1
        ? 'direct'
        : OWN.has(head)
          ? 'own'
          : packages.has(head.replace(/^node:/, ''))
            ? 'library'
            : 'other';
    const key = tone === 'direct' || tone === 'own' ? tone : head;
    let group = groups.get(key);
    if (!group) {
      const label = tone === 'direct' ? t.directCalls : tone === 'own' ? t.ownMethods : head;
      group = { key, label, tone, calls: 0, names: new Map() };
      groups.set(key, group);
    }
    group.calls += 1;
    group.names.set(member, (group.names.get(member) ?? 0) + 1);
  }
  return [...groups.values()].sort(
    (a, b) => order[a.tone] - order[b.tone] || b.calls - a.calls || a.label.localeCompare(b.label),
  );
}

export function Outside({
  external,
  packages,
  className,
}: {
  external: External[];
  packages: string[];
  className?: string;
}) {
  const [all, setAll] = useState(false);
  const known = useMemo(() => new Set(packages), [packages]);
  const groups = useMemo(() => groupExternal(external, known), [external, known]);
  if (groups.length === 0) return null;
  const shown = all ? groups : groups.slice(0, FIRST_GROUPS);

  return (
    <section className={className} aria-label={t.outsideTitle}>
      <SectionHeading as="h3" hint={t.outsideHint}>
        {t.outsideTitle}
      </SectionHeading>
      <dl className="flex flex-col gap-3">
        {shown.map((g) => (
          <div key={g.key}>
            <dt className="flex items-baseline gap-2">
              <span className="font-mono text-sm text-ink">{g.label}</span>
              <span className="text-xs text-ink-3">
                {g.tone === 'library' && 'library, '}
                {t.packageCalls(g.calls)}
              </span>
            </dt>
            <dd className="m-0 font-mono text-xs break-words text-ink-2">{names(g)}</dd>
          </div>
        ))}
      </dl>
      {groups.length > FIRST_GROUPS && (
        <TextButton className="mt-2 inline-flex min-h-10 items-center" onClick={() => setAll(!all)}>
          {all ? t.fewer : t.more(groups.length - FIRST_GROUPS)}
        </TextButton>
      )}
      {external.length >= BACKEND_CAP && (
        <p className="mt-2 text-xs text-ink-3">{t.outsideCapped}</p>
      )}
    </section>
  );
}

function names(group: Group) {
  const list = [...group.names.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  const rest = list.length - FIRST_NAMES;
  return rest > 0 ? `${list.slice(0, FIRST_NAMES).join(', ')} ${t.andMore(rest)}` : list.join(', ');
}
