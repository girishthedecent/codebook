import { useMemo, useState } from 'react';
import { CaretRight } from '@phosphor-icons/react';
import type { SourceFile } from '@/api/types';
import { TextButton } from '@/ui';
import { formatBytes, plural } from './sourceInfo';
import { strings } from './strings';
import { useAllFiles } from './useAllFiles';

// Why each kind of path is skipped, from the backend's SkipReason, in the order they are listed.
const reasons: Array<{ key: string; label: string; why: string }> = [
  {
    key: 'dependencies',
    label: 'Installed dependencies',
    why: "Other people's code, downloaded by the package manager.",
  },
  {
    key: 'build output',
    label: 'Build output',
    why: 'Made from the source by a build, so it repeats it.',
  },
  { key: 'generated', label: 'Generated files', why: 'Written by a tool, not by a person.' },
  {
    key: 'lockfile',
    label: 'Lockfiles',
    why: 'Exact package versions, long and with no logic in them.',
  },
  {
    key: 'binary',
    label: 'Binary files',
    why: 'Images, archives and other files that are not text.',
  },
  { key: 'test', label: 'Tests', why: 'Left out so answers are about the code itself.' },
  { key: 'changelog', label: 'Changelogs', why: 'Long histories that crowd out the current code.' },
  { key: 'too large', label: 'Files over the size limit', why: 'Too big to index whole.' },
  {
    key: 'secret file',
    label: 'Files that may hold secrets',
    why: 'Keys and environment files are never read.',
  },
  { key: 'link', label: 'Links', why: 'Shortcuts to other files, which are listed on their own.' },
  {
    key: 'unsupported entry',
    label: 'Other entries',
    why: 'Entries that are neither files nor folders.',
  },
];

const SHOWN = 40;

/**
 * What the index leaves out of a repository, as a footnote under the file list: each reason
 * in plain words with its files and sizes. A whole folder that was skipped is one row.
 */
export function LeftOut({ sourceId }: { sourceId: string }) {
  const { files } = useAllFiles(sourceId);
  const skipped = useMemo(() => files.filter((f) => f.skippedReason), [files]);
  if (skipped.length === 0) return null;

  const dirs = skipped.filter(isFolder).length;
  const groups = reasons
    .map((r) => ({ ...r, items: skipped.filter((f) => f.skippedReason === r.key) }))
    .filter((g) => g.items.length > 0);
  // A reason the backend added after this list was written still gets shown.
  const known = new Set(reasons.map((r) => r.key));
  const other = skipped.filter((f) => !known.has(f.skippedReason ?? ''));
  if (other.length) {
    groups.push({ key: 'other', label: 'Other', why: '', items: other });
  }

  return (
    <section aria-labelledby="left-out" className="mt-12">
      <span aria-hidden className="mb-4 block h-px w-12 bg-edge" />
      <h2 id="left-out" className="heading-minor text-ink">
        {strings.detail.leftOut}
      </h2>
      <p className="mt-1 max-w-prose text-xs text-ink-3">
        {strings.detail.leftOutIntro(skipped.length - dirs, dirs)}
      </p>
      <div className="mt-3">
        {groups.map((g) => (
          <Group key={g.key} label={g.label} why={g.why} items={g.items} />
        ))}
      </div>
    </section>
  );
}

const isFolder = (f: SourceFile) => f.path.endsWith('/');

function Group({ label, why, items }: { label: string; why: string; items: SourceFile[] }) {
  const [all, setAll] = useState(false);
  const folders = items.filter(isFolder).length;
  const total = items.reduce((sum, f) => sum + (isFolder(f) ? 0 : f.sizeBytes), 0);
  const shown = all ? items : items.slice(0, SHOWN);

  return (
    <details className="group border-b border-rule last:border-b-0">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 py-2 text-sm text-ink [&::-webkit-details-marker]:hidden">
        <CaretRight
          size={12}
          aria-hidden
          className="shrink-0 text-ink-3 transition-transform duration-150 group-open:rotate-90"
        />
        <span className="min-w-0 flex-1">{label}</span>
        <span className="shrink-0 text-xs text-ink-3">
          {summaryOf(items.length, folders, total)}
        </span>
      </summary>
      <div className="pb-3 pl-5">
        {why && <p className="mb-2 max-w-prose text-xs text-ink-3">{why}</p>}
        <ul className="space-y-1">
          {shown.map((f) => (
            <li key={f.id} className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate font-mono text-xs text-ink-2">{f.path}</span>
              <span className="shrink-0 text-xs text-ink-3">
                {isFolder(f) ? strings.detail.folder : formatBytes(f.sizeBytes)}
              </span>
            </li>
          ))}
        </ul>
        {items.length > shown.length && (
          <TextButton className="mt-2 py-2 text-xs" onClick={() => setAll(true)}>
            Show all {items.length}
          </TextButton>
        )}
      </div>
    </details>
  );
}

function summaryOf(count: number, folders: number, bytes: number) {
  const files = count - folders;
  const parts = [
    files ? plural(files, 'file') : '',
    folders ? plural(folders, 'folder') : '',
    bytes ? formatBytes(bytes) : '',
  ];
  return parts.filter(Boolean).join(' · ');
}
