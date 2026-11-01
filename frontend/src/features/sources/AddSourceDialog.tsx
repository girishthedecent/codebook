import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { isApiError } from '@/api/client';
import { flatItems } from '@/api/queries/keys';
import {
  PDF_MAX_BYTES,
  looksLikePdf,
  useCreateSource,
  useSources,
  useUploadPdf,
} from '@/api/queries/sources';
import type { Source } from '@/api/types';
import { useBreakpoint } from '@/lib/breakpoints';
import { cn } from '@/lib/cn';
import {
  Button,
  Callout,
  Dialog,
  Field,
  Input,
  ProgressRule,
  Select,
  Sheet,
  TabPanel,
  Tabs,
  TextButton,
  TextLink,
  toast,
} from '@/ui';
import { formatBytes, nameOf } from './sourceInfo';
import { enqueuePdfs } from './uploadQueue';
import { findDuplicate, isHttpUrl, parseRepoInput } from './sourceMeta';
import { SOURCE_LIMIT, strings } from './strings';

const s = strings.addDialog;
type Tab = 'book' | 'repo' | 'site';

const DEFAULT_PAGES = 10;
const MAX_PAGES = 50;

/** What a form needs from its dialog: close, and report the source that was made. */
type FormProps = {
  workspaceId: string;
  sources: Source[];
  full: boolean;
  onAdded: (s: Source) => void;
};

/**
 * One place to add any kind of source. A dialog on wide screens, a bottom sheet on phones.
 * Closes on success with a toast; the new source shows up in the list with its progress.
 */
export function AddSourceDialog({
  workspaceId,
  open,
  onOpenChange,
  onAdded,
}: {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the new source, after the dialog has closed. */
  onAdded?: (source: Source) => void;
}) {
  const bp = useBreakpoint();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('book');
  // An upload in flight keeps the dialog open: dismissing it by accident would lose the file.
  const [uploading, setUploading] = useState(false);
  const sources = flatItems(useSources(workspaceId).data);
  const full = sources.length >= SOURCE_LIMIT;

  const guardedChange = (next: boolean) => {
    if (!next && uploading) return;
    onOpenChange(next);
  };

  const added = (source: Source) => {
    onOpenChange(false);
    toast({
      kind: 'ok',
      title: strings.addedTitle(nameOf(source).name),
      description: strings.addedBody,
      action: {
        label: strings.addedOpen,
        onClick: () =>
          void navigate({
            to: '/w/$workspaceId/sources/$sourceId',
            params: { workspaceId, sourceId: source.id },
          }),
      },
    });
    onAdded?.(source);
  };

  // Several books at once go up one after another in the background, and the dialog closes.
  const queue = (files: File[]) => {
    const openLibrary = () =>
      void navigate({ to: '/w/$workspaceId/sources', params: { workspaceId } });
    enqueuePdfs(workspaceId, files, openLibrary);
    onOpenChange(false);
    toast({
      title: s.queued(files.length),
      action: { label: s.queuedOpen, onClick: openLibrary },
    });
  };

  const shared = { workspaceId, sources, full, onAdded: added };
  const body = (
    <Tabs
      label="Source type"
      value={tab}
      onValueChange={(v) => !uploading && setTab(v as Tab)}
      items={[
        { value: 'book', label: s.tabs.book },
        { value: 'repo', label: s.tabs.repo },
        { value: 'site', label: s.tabs.site },
      ]}
    >
      <TabPanel value="book">
        <BookForm {...shared} onBusy={setUploading} onMany={queue} />
      </TabPanel>
      <TabPanel value="repo">
        <RepoForm {...shared} />
      </TabPanel>
      <TabPanel value="site">
        <SiteForm {...shared} />
      </TabPanel>
    </Tabs>
  );

  const description = (
    <>
      {s.description} {strings.count(sources.length, SOURCE_LIMIT)}.
    </>
  );

  if (bp === 'phone') {
    return (
      <Sheet open={open} onOpenChange={guardedChange} title={s.title} description={description}>
        <div className="px-4 pb-6">{body}</div>
      </Sheet>
    );
  }
  return (
    <Dialog open={open} onOpenChange={guardedChange} title={s.title} description={description}>
      {body}
    </Dialog>
  );
}

function BookForm({
  workspaceId,
  full,
  onAdded,
  onBusy,
  onMany,
}: FormProps & { onBusy: (busy: boolean) => void; onMany: (files: File[]) => void }) {
  const upload = useUploadPdf(workspaceId);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);

  // Tell the dialog while the request runs, and clear it if this form goes away first.
  const pending = upload.isPending;
  useEffect(() => {
    onBusy(pending);
    return () => onBusy(false);
  }, [pending, onBusy]);

  const choose = async (picked: File | undefined) => {
    upload.reset();
    setFile(null);
    setFileError(null);
    if (!picked) return;
    if (picked.size === 0) return setFileError(s.empty);
    if (picked.size > PDF_MAX_BYTES) return setFileError(s.tooBig);
    if (!(await looksLikePdf(picked))) return setFileError(s.notPdf);
    setFile(picked);
  };

  const pick = (files: File[]) => {
    if (files.length > 1) onMany(files);
    else void choose(files[0]);
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    pick([...event.dataTransfer.files]);
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
      { onSuccess: onAdded },
    );
  };

  const cancelled = upload.error instanceof DOMException && upload.error.name === 'AbortError';
  // The bytes are all sent at 100%, but the server still has to store them before it answers.
  const saving = upload.isPending && progress >= 1;

  return (
    <form onSubmit={submit} className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        // Moving over a child fires dragleave on the zone; only leaving it counts.
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={onDrop}
        className={cn(
          'rounded-md border border-dashed px-4 py-6 text-sm transition-colors duration-150',
          dragging ? 'border-accent bg-accent-wash' : 'border-edge',
        )}
      >
        {file ? (
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-ink">{file.name}</span>
            <span className="shrink-0 text-xs text-ink-3">{formatBytes(file.size)}</span>
          </div>
        ) : (
          <p className="text-ink-2">
            {s.drop}{' '}
            <TextButton className="py-2" onClick={() => input.current?.click()}>
              {s.pick}
            </TextButton>
            .
          </p>
        )}
        <p className="mt-1 text-xs text-ink-3">{s.pdfLimit}</p>
        <input
          ref={input}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            pick([...(e.target.files ?? [])]);
            // Lets the same file be picked again after fixing it.
            e.target.value = '';
          }}
        />
        {file && !upload.isPending && (
          <TextButton className="mt-1 py-2 text-xs" onClick={() => input.current?.click()}>
            {s.another}
          </TextButton>
        )}
      </div>
      {fileError && <Callout tone="error">{fileError}</Callout>}

      <Field label={s.titleLabel} hint={s.titleHint}>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
      </Field>

      {upload.isPending && (
        <div className="space-y-1.5" aria-live="polite">
          <ProgressRule
            value={saving ? undefined : progress}
            label={saving ? s.saving : s.uploading}
          />
          <div className="flex items-baseline justify-between gap-3 text-xs text-ink-3">
            <span>
              {saving
                ? `${s.saving}. ${s.savingHint}`
                : `${s.uploading}, ${Math.round(progress * 100)}%`}
            </span>
            {!saving && (
              <TextButton className="py-2" onClick={() => controller.current?.abort()}>
                {s.cancel}
              </TextButton>
            )}
          </div>
        </div>
      )}
      {upload.error && !cancelled && <SubmitError error={upload.error} workspaceId={workspaceId} />}
      {full && <Callout tone="warn">{s.full(SOURCE_LIMIT)}</Callout>}

      <Actions disabled={!file || full} loading={upload.isPending} />
    </form>
  );
}

function RepoForm({ workspaceId, sources, full, onAdded }: FormProps) {
  const create = useCreateSource(workspaceId);
  const [repo, setRepo] = useState('');
  const [ref, setRef] = useState('');
  const [touched, setTouched] = useState(false);
  const parsed = parseRepoInput(repo);
  const invalid = touched && repo.trim() !== '' && !parsed;
  const wantedRef = ref.trim() || parsed?.ref;

  const duplicate = parsed
    ? findDuplicate(sources, {
        type: 'GITHUB_REPO',
        owner: parsed.owner,
        repo: parsed.repo,
        ref: wantedRef,
      })
    : undefined;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!parsed || duplicate) return;
    create.mutate({ type: 'GITHUB_REPO', url: parsed.url, ref: wantedRef }, { onSuccess: onAdded });
  };

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
          placeholder="karpathy/nanoGPT"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          className="font-mono"
        />
      </Field>
      <Field label={s.refLabel} hint={parsed?.ref ? s.refFromLink(parsed.ref) : s.refHint}>
        <Input
          value={ref}
          onChange={(e) => {
            setRef(e.target.value);
            create.reset();
          }}
          maxLength={255}
          placeholder={parsed?.ref ?? 'main'}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          className="font-mono"
        />
      </Field>
      {duplicate && <Duplicate source={duplicate} workspaceId={workspaceId} />}
      {create.error && !duplicate && <SubmitError error={create.error} workspaceId={workspaceId} />}
      {full && <Callout tone="warn">{s.full(SOURCE_LIMIT)}</Callout>}
      <Actions disabled={!parsed || !!duplicate || full} loading={create.isPending} />
    </form>
  );
}

function SiteForm({ workspaceId, sources, full, onAdded }: FormProps) {
  const create = useCreateSource(workspaceId);
  const [url, setUrl] = useState('');
  const [touched, setTouched] = useState(false);
  const [depth, setDepth] = useState(0);
  const [pages, setPages] = useState(String(DEFAULT_PAGES));
  const valid = isHttpUrl(url);
  const invalid = touched && url.trim() !== '' && !valid;
  const pageCount = Number(pages);
  const pagesValid = Number.isInteger(pageCount) && pageCount >= 1 && pageCount <= MAX_PAGES;

  const duplicate = valid
    ? findDuplicate(sources, { type: 'WEBSITE', url: url.trim() })
    : undefined;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!valid || duplicate || (depth > 0 && !pagesValid)) return;
    create.mutate(
      depth > 0
        ? { type: 'WEBSITE', url: url.trim(), maxDepth: depth, maxPages: pageCount }
        : { type: 'WEBSITE', url: url.trim(), maxDepth: 0 },
      { onSuccess: onAdded },
    );
  };

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
          placeholder="https://huggingface.co/docs/transformers/en/llm_tutorial"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          className="font-mono"
        />
      </Field>
      <Field label={s.depthLabel} hint={s.depthHint}>
        <Select value={depth} onChange={(e) => setDepth(Number(e.target.value))}>
          {([0, 1, 2] as const).map((d) => (
            <option key={d} value={d}>
              {s.depthOptions[d]}
            </option>
          ))}
        </Select>
      </Field>
      {depth > 0 && (
        <Field
          label={s.pagesLabel}
          hint={s.pagesHint}
          error={pagesValid ? undefined : `Enter a number from 1 to ${MAX_PAGES}.`}
        >
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_PAGES}
            value={pages}
            onChange={(e) => setPages(e.target.value)}
            className="w-28"
          />
        </Field>
      )}
      {duplicate && <Duplicate source={duplicate} workspaceId={workspaceId} />}
      {create.error && !duplicate && <SubmitError error={create.error} workspaceId={workspaceId} />}
      {full && <Callout tone="warn">{s.full(SOURCE_LIMIT)}</Callout>}
      <Actions
        disabled={!valid || !!duplicate || full || (depth > 0 && !pagesValid)}
        loading={create.isPending}
      />
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

function Duplicate({ source, workspaceId }: { source: Source; workspaceId: string }) {
  return (
    <Callout
      tone="warn"
      action={
        <TextLink
          to="/w/$workspaceId/sources/$sourceId"
          params={{ workspaceId, sourceId: source.id }}
        >
          {s.seeIt}
        </TextLink>
      }
    >
      {s.duplicate}
    </Callout>
  );
}

/**
 * The backend's message, with the cases that need more than words: a 409 (a duplicate that
 * was added elsewhere meanwhile, or the limit) links to the list, a 429 says when to retry,
 * and an upload that a proxy rejected for size has no message of its own.
 */
function SubmitError({ error, workspaceId }: { error: Error; workspaceId: string }) {
  if (isApiError(error, 409)) {
    return (
      <Callout
        tone="warn"
        action={
          <TextLink to="/w/$workspaceId/sources" params={{ workspaceId }}>
            {strings.all}
          </TextLink>
        }
      >
        {/[.!?]$/.test(error.message) ? error.message : `${error.message}.`}
      </Callout>
    );
  }
  let message = error.message;
  if (isApiError(error, 413)) message = s.tooBig;
  else if (isApiError(error, 429) && error.retryAfterSec)
    message = s.retryAfter(error.retryAfterSec);
  return <Callout tone="error">{message}</Callout>;
}
