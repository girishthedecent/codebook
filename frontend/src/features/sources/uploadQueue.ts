import { useSyncExternalStore } from 'react';
import { isApiError } from '@/api/client';
import { keys } from '@/api/queries/keys';
import { PDF_MAX_BYTES, looksLikePdf, uploadPdf } from '@/api/queries/sources';
import { queryClient } from '@/api/queryClient';
import { toast } from '@/ui';
import { strings } from './strings';

/**
 * Books dropped or picked several at a time go up one after another, in the background, so
 * the reader can keep working and the server isn't sent ten files at once. The queue lives as
 * long as the tab; the library page shows it.
 */
export type UploadStatus =
  'waiting' | 'checking' | 'uploading' | 'saving' | 'done' | 'failed' | 'cancelled';

export type Upload = {
  id: number;
  name: string;
  size: number;
  status: UploadStatus;
  progress: number;
  error?: string;
  sourceId?: string;
};

type Queue = {
  items: Upload[];
  files: Map<number, File>;
  running: boolean;
  current?: AbortController;
  /** How many of this run's files were added and how many there were. */
  batch: { added: number; total: number };
  /** Opens the library, from the toast that ends a run. */
  openLibrary?: () => void;
};

const EMPTY: Upload[] = [];
const queues = new Map<string, Queue>();
const listeners = new Set<() => void>();
let nextId = 1;

function queueFor(workspaceId: string) {
  let queue = queues.get(workspaceId);
  if (!queue) {
    queue = { items: [], files: new Map(), running: false, batch: { added: 0, total: 0 } };
    queues.set(workspaceId, queue);
  }
  return queue;
}

function emit() {
  for (const fn of listeners) fn();
}

function patch(queue: Queue, id: number, change: Partial<Upload>) {
  queue.items = queue.items.map((item) => (item.id === id ? { ...item, ...change } : item));
  emit();
}

export function enqueuePdfs(workspaceId: string, files: File[], openLibrary?: () => void) {
  if (!files.length) return;
  const queue = queueFor(workspaceId);
  if (openLibrary) queue.openLibrary = openLibrary;
  const added = files.map((file) => {
    const id = nextId++;
    queue.files.set(id, file);
    return { id, name: file.name, size: file.size, status: 'waiting' as const, progress: 0 };
  });
  queue.items = [...queue.items, ...added];
  queue.batch.total += added.length;
  emit();
  if (!queue.running) void run(workspaceId, queue);
}

export function cancelUpload(workspaceId: string, id: number) {
  const queue = queues.get(workspaceId);
  const item = queue?.items.find((i) => i.id === id);
  if (!queue || !item) return;
  if (item.status === 'waiting') {
    queue.files.delete(id);
    queue.batch.total -= 1;
    patch(queue, id, { status: 'cancelled' });
  } else if (item.status === 'uploading' || item.status === 'checking') {
    queue.current?.abort();
  }
}

export function clearFinished(workspaceId: string) {
  const queue = queues.get(workspaceId);
  if (!queue) return;
  queue.items = queue.items.filter((i) => !['done', 'failed', 'cancelled'].includes(i.status));
  emit();
}

async function run(workspaceId: string, queue: Queue) {
  queue.running = true;
  for (let item = nextWaiting(queue); item; item = nextWaiting(queue)) {
    const file = queue.files.get(item.id)!;
    queue.files.delete(item.id);
    await send(workspaceId, queue, item.id, file);
  }
  queue.running = false;
  queue.current = undefined;
  announce(workspaceId, queue.batch, queue.openLibrary);
  queue.batch = { added: 0, total: 0 };
}

const nextWaiting = (queue: Queue) => queue.items.find((i) => i.status === 'waiting');

async function send(workspaceId: string, queue: Queue, id: number, file: File) {
  const s = strings.addDialog;
  patch(queue, id, { status: 'checking' });
  const controller = new AbortController();
  queue.current = controller;
  if (file.size === 0) return patch(queue, id, { status: 'failed', error: s.empty });
  if (file.size > PDF_MAX_BYTES) return patch(queue, id, { status: 'failed', error: s.tooBig });
  if (!(await looksLikePdf(file))) return patch(queue, id, { status: 'failed', error: s.notPdf });
  if (controller.signal.aborted) return patch(queue, id, { status: 'cancelled' });

  patch(queue, id, { status: 'uploading' });
  try {
    const source = await uploadPdf(
      workspaceId,
      { file },
      {
        signal: controller.signal,
        // The last bytes are sent long before the server answers; that wait is "saving".
        onProgress: (fraction) =>
          patch(
            queue,
            id,
            fraction >= 1 ? { status: 'saving', progress: 1 } : { progress: fraction },
          ),
      },
    );
    queue.batch.added += 1;
    patch(queue, id, { status: 'done', sourceId: source.id, progress: 1 });
    void queryClient.invalidateQueries({ queryKey: keys.sources(workspaceId) });
    void queryClient.invalidateQueries({ queryKey: keys.workspace(workspaceId) });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      queue.batch.total -= 1;
      return patch(queue, id, { status: 'cancelled' });
    }
    const message = isApiError(error, 413)
      ? s.tooBig
      : isApiError(error, 429) && error.retryAfterSec
        ? s.retryAfter(error.retryAfterSec)
        : error instanceof Error
          ? error.message
          : String(error);
    patch(queue, id, { status: 'failed', error: message });
  }
}

/** Says how a run went, unless the library is open, where the list already shows it. */
function announce(workspaceId: string, batch: Queue['batch'], openLibrary?: () => void) {
  const u = strings.uploads;
  const library = `/w/${workspaceId}/sources`;
  if (!batch.total || window.location.pathname.replace(/\/$/, '') === library) return;
  const all = batch.added === batch.total;
  toast({
    kind: all ? 'ok' : 'error',
    title: all ? u.batchDone(batch.added) : u.batchSome(batch.added, batch.total),
    description: batch.added ? u.batchBody : undefined,
    action: openLibrary && { label: u.batchOpen, onClick: openLibrary },
  });
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useUploads(workspaceId: string) {
  return useSyncExternalStore(
    subscribe,
    () => queues.get(workspaceId)?.items ?? EMPTY,
    () => EMPTY,
  );
}
