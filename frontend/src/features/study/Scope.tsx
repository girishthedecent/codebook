import { useMemo } from 'react';
import { useSourceToc } from '@/api/queries/sources';
import type { Source, TocNode } from '@/api/types';
import { useAllFiles } from '@/features/sources/useAllFiles';
import { displayTitle } from '@/lib/displayTitle';
import { Field, Select, Textarea } from '@/ui';
import { s } from './strings';

/** A chapter or folder needs a source that offers one; without it the scope falls back to none. */
export function effectiveKind(value: ScopeValue, books: Source[], repos: Source[]): ScopeKind {
  if (value.kind === 'chapter' && books.length === 0) return 'none';
  if (value.kind === 'folder' && repos.length === 0) return 'none';
  return value.kind;
}

export type ScopeKind = 'none' | 'topic' | 'chapter' | 'folder';

export type ScopeValue = {
  kind: ScopeKind;
  topic: string;
  /** The book or repository a chapter or folder is taken from. */
  sourceId?: string;
  tocNodeId: string;
  pathPrefix: string;
};

type Props = {
  value: ScopeValue;
  onChange: (next: ScopeValue) => void;
  /** The picked sources that can offer a chapter, or a folder. */
  books: Source[];
  repos: Source[];
};

/**
 * What the set is about, one way at a time: nothing in particular, a topic, a chapter of a
 * book or a folder of a repository. A chapter or folder narrows the set to that one source.
 */
export function ScopeFields({ value, onChange, books, repos }: Props) {
  const { kind } = value;
  const pool = kind === 'chapter' ? books : kind === 'folder' ? repos : [];
  const source = pool.find((src) => src.id === value.sourceId) ?? pool[0];
  const set = (patch: Partial<ScopeValue>) => onChange({ ...value, ...patch });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <Field label={s.create.focus} note={s.create.optional} className="w-44">
          <Select
            value={kind}
            onChange={(e) =>
              set({
                kind: e.target.value as ScopeKind,
                sourceId: undefined,
                tocNodeId: '',
                pathPrefix: '',
              })
            }
          >
            <option value="none">{s.create.focusNone}</option>
            <option value="topic">{s.create.focusTopic}</option>
            {books.length > 0 && <option value="chapter">{s.create.focusChapter}</option>}
            {repos.length > 0 && <option value="folder">{s.create.focusFolder}</option>}
          </Select>
        </Field>

        {source && pool.length > 1 && (
          <Field
            label={kind === 'chapter' ? s.create.book : s.create.repo}
            className="min-w-0 flex-1"
          >
            <Select
              value={source.id}
              onChange={(e) => set({ sourceId: e.target.value, tocNodeId: '', pathPrefix: '' })}
            >
              {pool.map((src) => (
                <option key={src.id} value={src.id}>
                  {displayTitle(src).name}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>

      {kind === 'none' && <p className="text-xs text-ink-3">{s.create.sampled}</p>}

      {kind === 'topic' && (
        <Field label={s.create.topic}>
          <Textarea
            rows={2}
            maxLength={500}
            value={value.topic}
            placeholder={s.create.topicHint}
            onChange={(e) => set({ topic: e.target.value })}
          />
        </Field>
      )}

      {kind === 'chapter' && source && (
        <ChapterSelect
          key={source.id}
          source={source}
          value={value.tocNodeId}
          onChange={(tocNodeId) => set({ tocNodeId, sourceId: source.id })}
        />
      )}

      {kind === 'folder' && source && (
        <FolderSelect
          key={source.id}
          source={source}
          value={value.pathPrefix}
          onChange={(pathPrefix) => set({ pathPrefix, sourceId: source.id })}
        />
      )}
    </div>
  );
}

// Sections nest deeper than a study set is likely to be about; chapters and their parts are enough.
const TOC_DEPTH = 2;

function flattenToc(nodes: TocNode[], depth = 0): { id: string; label: string }[] {
  return nodes.flatMap((node) => [
    {
      id: node.id,
      label: ' '.repeat(depth) + (node.number ? `${node.number}. ` : '') + node.title,
    },
    ...(depth + 1 < TOC_DEPTH ? flattenToc(node.children, depth + 1) : []),
  ]);
}

function ChapterSelect({
  source,
  value,
  onChange,
}: {
  source: Source;
  value: string;
  onChange: (id: string) => void;
}) {
  const toc = useSourceToc(source.id);
  const options = useMemo(() => flattenToc(toc.data ?? []), [toc.data]);
  const empty = toc.isSuccess && options.length === 0;
  return (
    <Field
      label={s.create.chapter}
      hint={empty ? s.create.noChapters : s.create.onlyThis(displayTitle(source).name)}
      error={toc.isError ? s.create.chaptersFailed : undefined}
    >
      <Select
        value={value}
        disabled={!toc.isSuccess || empty}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{toc.isPending ? s.create.loadingChapters : s.create.pickChapter}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </Select>
    </Field>
  );
}

// Folders more than this deep are left out; a path prefix that specific is rarely wanted.
const FOLDER_DEPTH = 3;

function folderPrefixes(paths: string[]): string[] {
  const found = new Set<string>();
  for (const path of paths) {
    const parts = path.split('/');
    for (let i = 1; i < Math.min(parts.length, FOLDER_DEPTH + 1); i++) {
      found.add(parts.slice(0, i).join('/') + '/');
    }
  }
  return [...found].sort();
}

function FolderSelect({
  source,
  value,
  onChange,
}: {
  source: Source;
  value: string;
  onChange: (prefix: string) => void;
}) {
  const { files, isPending, isError, hasNextPage } = useAllFiles(source.id);
  const folders = useMemo(() => folderPrefixes(files.map((f) => f.path)), [files]);
  const loading = isPending || (hasNextPage && !isError);
  const empty = !loading && !isError && folders.length === 0;
  return (
    <Field
      label={s.create.folder}
      hint={empty ? s.create.noFolders : s.create.onlyThis(displayTitle(source).name)}
      error={isError ? s.create.foldersFailed : undefined}
    >
      <Select value={value} disabled={loading || empty} onChange={(e) => onChange(e.target.value)}>
        <option value="">{loading ? s.create.loadingFolders : s.create.pickFolder}</option>
        {folders.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </Select>
    </Field>
  );
}
