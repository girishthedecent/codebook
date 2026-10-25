import { useRef, useState, type DragEvent, type FormEvent, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { isApiError } from '@/api/client';
import { flatItems, keys } from '@/api/queries/keys';
import { PDF_MAX_BYTES, looksLikePdf, useCreateSource, useUploadPdf } from '@/api/queries/sources';
import type { Source } from '@/api/types';
import { useBreakpoint } from '@/lib/breakpoints';
import { cn } from '@/lib/cn';
import { Button, Dialog, Field, Input, ProgressRule, Sheet, TabPanel, Tabs } from '@/ui';
import { findDuplicate, isHttpUrl, parseRepoInput } from './sourceMeta';
import { strings } from './strings';

const s = strings.addDialog;
type Tab = 'book' | 'repo' | 'site';

/**
 * One place to add any kind of source. A dialog on wide screens, a bottom sheet on phones.
 * Closes on success; the new source shows up in the list with its progress line.
 */
export function AddSourceDialog({
  workspaceId,
  open,
  onOpenChange,
}: {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const bp = useBreakpoint();
  const [tab, setTab] = useState<Tab>('book');
  const close = () => onOpenChange(false);

  const body = (
    <Tabs
      label="Source type"
      value={tab}
      onValueChange={(v) => setTab(v as Tab)}
      items={[
        { value: 'book', label: s.tabs.book },
        { value: 'repo', label: s.tabs.repo },
        { value: 'site', label: s.tabs.site },
      ]}
    >
      <TabPanel value="book">
        <BookForm workspaceId={workspaceId} onDone={close} />
      </TabPanel>
      <TabPanel value="repo">
        <RepoForm workspaceId={workspaceId} onDone={close} />
      </TabPanel>
      <TabPanel value="site">
        <SiteForm workspaceId={workspaceId} onDone={close} />
      </TabPanel>
    </Tabs>
  );

  if (bp === 'phone') {
    return (
      <Sheet open={open} onOpenChange={onOpenChange} title={s.title} description={s.description}>
        <div className="px-4 pb-6">{body}</div>
      </Sheet>
    );
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={s.title} description={s.description}>
      {body}
    </Dialog>
  );
}

function BookForm({ workspaceId, onDone }: { workspaceId: string; onDone: () => void }) {
  const upload = useUploadPdf(workspaceId);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const choose = async (picked: File | undefined) => {
    upload.reset();
    setFile(null);
    setFileError(null);
    if (!picked) return;
    if (picked.size > PDF_MAX_BYTES) return setFileError(s.tooBig);
    if (!(await looksLikePdf(picked))) return setFileError(s.notPdf);
    setFile(picked);
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    void choose(event.dataTransfer.files[0]);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!file) return;
    controller.current = new AbortController();
    setProgress(0);
    upload.mutate(
      {
        file,
        title: title.trim() || undefined,
        onProgress: setProgress,
        signal: controller.current.signal,
      },
      { onSuccess: onDone },
    );
  };

  const cancelled = upload.error instanceof DOMException && upload.error.name === 'AbortError';

  return (
    <form onSubmit={submit} className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'rounded-md border border-dashed px-4 py-6 text-sm transition-colors duration-150',
          dragging ? 'border-accent bg-accent-wash' : 'border-rule-2',
        )}
      >
        {file ? (
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate font-mono text-xs text-ink">{file.name}</span>
            <span className="shrink-0 font-mono text-xs text-ink-3">{formatBytes(file.size)}</span>
          </div>
        ) : (
          <p className="text-ink-2">
            {s.drop}{' '}
            <button
              type="button"
              onClick={() => input.current?.click()}
              className="text-accent underline underline-offset-2"
            >
              {s.pick}
            </button>
            .
          </p>
        )}
        <p className="mt-1 text-xs text-ink-3">{s.pdfLimit}</p>
        <input
          ref={input}
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => void choose(e.target.files?.[0])}
        />
        {file && !upload.isPending && (
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="mt-2 text-xs text-accent underline underline-offset-2"
          >
            Choose another file
          </button>
        )}
      </div>
      {fileError && <p className="text-sm text-error">{fileError}</p>}

      <Field label={s.titleLabel} hint={s.titleHint}>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
      </Field>

      {upload.isPending && (
        <div className="space-y-1.5">
          <ProgressRule value={progress} label={s.uploading} />
          <div className="flex justify-between text-xs text-ink-3">
            <span>
              {s.uploading} · {Math.round(progress * 100)}%
            </span>
            <button
              type="button"
              onClick={() => controller.current?.abort()}
              className="text-accent underline underline-offset-2"
            >
              {s.cancel}
            </button>
          </div>
        </div>
      )}
      {upload.error && !cancelled && (
        <SubmitError error={upload.error} workspaceId={workspaceId} duplicate={undefined} />
      )}

      <Actions disabled={!file} loading={upload.isPending} />
    </form>
  );
}

function RepoForm({ workspaceId, onDone }: { workspaceId: string; onDone: () => void }) {
  const create = useCreateSource(workspaceId);
  const sources = useCachedSources(workspaceId);
  const [repo, setRepo] = useState('');
  const [ref, setRef] = useState('');
  const [touched, setTouched] = useState(false);
  const parsed = parseRepoInput(repo);
  const invalid = touched && repo.trim() !== '' && !parsed;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!parsed) return;
    create.mutate(
      { type: 'GITHUB_REPO', url: parsed.url, ref: ref.trim() || parsed.ref },
      { onSuccess: onDone },
    );
  };

  const duplicate =
    parsed && isApiError(create.error, 409)
      ? findDuplicate(sources(), { type: 'GITHUB_REPO', owner: parsed.owner, repo: parsed.repo })
      : undefined;

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Field label={s.repoLabel} hint={s.repoHint} error={invalid ? s.repoInvalid : undefined}>
        <Input
          value={repo}
          onChange={(e) => {
            setRepo(e.target.value);
            create.reset();
          }}
          onBlur={() => setTouched(true)}
          placeholder="expressjs/express"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          className="font-mono"
        />
      </Field>
      <Field label={s.refLabel} hint={parsed?.ref ? `From the link: ${parsed.ref}` : s.refHint}>
        <Input
          value={ref}
          onChange={(e) => setRef(e.target.value)}
          maxLength={255}
          placeholder={parsed?.ref ?? 'main'}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          className="font-mono"
        />
      </Field>
      {create.error && (
        <SubmitError error={create.error} workspaceId={workspaceId} duplicate={duplicate} />
      )}
      <Actions disabled={!parsed} loading={create.isPending} />
    </form>
  );
}

function SiteForm({ workspaceId, onDone }: { workspaceId: string; onDone: () => void }) {
  const create = useCreateSource(workspaceId);
  const sources = useCachedSources(workspaceId);
  const [url, setUrl] = useState('');
  const [touched, setTouched] = useState(false);
  const valid = isHttpUrl(url);
  const invalid = touched && url.trim() !== '' && !valid;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!valid) return;
    create.mutate({ type: 'WEBSITE', url: url.trim() }, { onSuccess: onDone });
  };

  const duplicate = isApiError(create.error, 409)
    ? findDuplicate(sources(), { type: 'WEBSITE', url: url.trim() })
    : undefined;

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Field label={s.siteLabel} hint={s.siteHint} error={invalid ? s.siteInvalid : undefined}>
        <Input
          type="url"
          inputMode="url"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            create.reset();
          }}
          onBlur={() => setTouched(true)}
          placeholder="https://expressjs.com/en/guide/routing.html"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          className="font-mono"
        />
      </Field>
      {create.error && (
        <SubmitError error={create.error} workspaceId={workspaceId} duplicate={duplicate} />
      )}
      <Actions disabled={!valid} loading={create.isPending} />
    </form>
  );
}

function Actions({ disabled, loading }: { disabled: boolean; loading: boolean }) {
  return (
    <div className="flex justify-end pt-1">
      <Button type="submit" variant="primary" disabled={disabled} loading={loading}>
        {s.submit}
      </Button>
    </div>
  );
}

/** The backend's message, except a duplicate, which links to the source when it's known. */
function SubmitError({
  error,
  workspaceId,
  duplicate,
}: {
  error: Error;
  workspaceId: string;
  duplicate: Source | undefined;
}): ReactNode {
  if (isApiError(error, 409) && error.message === s.duplicate.replace(/\.$/, '')) {
    return (
      <p className="text-sm text-error">
        {s.duplicate}{' '}
        {duplicate ? (
          <Link
            to="/w/$workspaceId/sources/$sourceId"
            params={{ workspaceId, sourceId: duplicate.id }}
            className="text-accent underline underline-offset-2"
          >
            {s.seeIt}
          </Link>
        ) : (
          <Link
            to="/w/$workspaceId/sources"
            params={{ workspaceId }}
            className="text-accent underline underline-offset-2"
          >
            {strings.all}
          </Link>
        )}
      </p>
    );
  }
  return <p className="text-sm text-error">{error.message}</p>;
}

/** Reads the sources already in the cache, to point a duplicate at the existing one. */
function useCachedSources(workspaceId: string) {
  const client = useQueryClient();
  return () =>
    flatItems(client.getQueryData<{ pages: { items: Source[] }[] }>(keys.sources(workspaceId)));
}

function formatBytes(n: number) {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
