import { useEffect, useId, useRef, useState } from 'react';
import { DownloadSimple } from '@phosphor-icons/react';
import { useMe } from '@/auth';
import { downloadText } from '@/lib/download';
import { Button, Callout, SectionHeading } from '@/ui';
import { strings } from '@/features/account/strings';
import { collectExport } from './exportData';

const s = strings.settings;

type State =
  | { phase: 'idle' }
  | { phase: 'running'; line: string }
  | { phase: 'done'; line: string }
  | { phase: 'failed'; error: Error };

/** The export of everything the account holds, and the account-deletion notice. */
export function DataSection() {
  const { me } = useMe();
  const [state, setState] = useState<State>({ phase: 'idle' });
  const controller = useRef<AbortController | null>(null);

  // Leaving the page stops the requests; nothing is saved from a partial read.
  useEffect(() => () => controller.current?.abort(), []);

  const start = async () => {
    if (!me) return;
    const run = new AbortController();
    controller.current = run;
    setState({ phase: 'running', line: s.data.progress.workspaces });
    try {
      const { file, counts } = await collectExport(
        me,
        (line) => {
          if (!run.signal.aborted) setState({ phase: 'running', line });
        },
        run.signal,
      );
      if (run.signal.aborted) return;
      const name = s.data.fileName(file.exportedAt.slice(0, 10));
      downloadText(name, JSON.stringify(file, null, 2), 'application/json');
      setState({ phase: 'done', line: s.data.done(name, counts) });
    } catch (error) {
      if (run.signal.aborted) return;
      setState({
        phase: 'failed',
        error: error instanceof Error ? error : new Error(s.data.failed),
      });
    }
  };

  const stop = () => {
    controller.current?.abort();
    setState({ phase: 'idle' });
  };

  const running = state.phase === 'running';

  return (
    <section aria-labelledby="your-data" className="flex flex-col gap-8">
      <div>
        <SectionHeading id="your-data" hint={s.data.hint}>
          {s.data.title}
        </SectionHeading>
        <div className="flex flex-wrap items-center gap-2">
          <Button loading={running} onClick={() => void start()}>
            {!running && <DownloadSimple size={16} aria-hidden />}
            {s.data.download}
          </Button>
          {running && (
            <Button variant="ghost" onClick={stop}>
              {s.data.cancel}
            </Button>
          )}
        </div>
        {/* One live line, so a screen reader hears each step without the page moving. */}
        <p role="status" className="mt-3 min-h-[1.4em] text-xs text-ink-3 tabular-nums">
          {state.phase === 'running' || state.phase === 'done' ? state.line : ''}
        </p>
        {state.phase === 'failed' && (
          <Callout error={state.error} onRetry={() => void start()} className="mt-1">
            {s.data.failed}
          </Callout>
        )}
      </div>
      <DeleteBlock />
    </section>
  );
}

function DeleteBlock() {
  const reasonId = useId();
  return (
    <div>
      <h3 className="heading-minor text-ink">{s.delete.title}</h3>
      <p id={reasonId} className="mt-1 max-w-prose text-sm text-ink-2">
        {s.delete.reason}
      </p>
      <Button variant="danger" className="mt-3" disabled aria-describedby={reasonId}>
        {s.delete.button}
      </Button>
    </div>
  );
}
