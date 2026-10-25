import { useId, useState, type FormEvent } from 'react';
import { useEvalDatasets, useStartEvalRun } from '@/api/queries';
import { isApiError } from '@/api/client';
import { Button, Dialog, Field, Input, controlClass, toast } from '@/ui';
import { cn } from '@/lib/cn';
import { strings } from '../strings';
import { knownConfigs } from './metrics';

const NAME = /^[a-z0-9-]+$/;

/** Queues a run for the eval worker. Runs go one at a time; a busy worker answers 409. */
export function StartRunDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const datasets = useEvalDatasets();
  const start = useStartEvalRun();
  const listId = useId();
  const [suite, setSuite] = useState<'retrieval' | 'answer'>('retrieval');
  const [dataset, setDataset] = useState('core');
  const [config, setConfig] = useState('hybrid');
  const [split, setSplit] = useState<'DEV' | 'HELDOUT'>('DEV');
  const [limit, setLimit] = useState('');
  const [error, setError] = useState<string | null>(null);

  const configError =
    config && !NAME.test(config) ? 'Lowercase letters, digits and dashes only.' : undefined;
  const limitNumber = limit ? Number(limit) : undefined;
  const limitError =
    limit && (!Number.isInteger(limitNumber) || limitNumber! < 1 || limitNumber! > 500)
      ? 'A whole number from 1 to 500.'
      : undefined;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!config || configError || limitError) return;
    setError(null);
    start.mutate(
      { suite, config, dataset, split, limit: limitNumber },
      {
        onSuccess: () => {
          toast({ title: `Queued ${suite} run with ${config}` });
          onOpenChange(false);
        },
        onError: (err) => setError(isApiError(err) ? err.message : 'The run could not be queued.'),
      },
    );
  };

  const pickSuite = (next: 'retrieval' | 'answer') => {
    setSuite(next);
    if (!knownConfigs[next]?.includes(config)) setConfig(knownConfigs[next]![0]!);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={strings.evals.start}
      description="The eval worker picks it up and runs one case at a time."
      actions={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="start-run" loading={start.isPending}>
            Queue run
          </Button>
        </>
      }
    >
      <form id="start-run" onSubmit={submit} className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-sm font-medium text-ink">Suite</legend>
          {(['retrieval', 'answer'] as const).map((s) => (
            <label
              key={s}
              className="flex min-h-9 cursor-pointer items-center gap-2 text-sm text-ink"
            >
              <input
                type="radio"
                name="suite"
                value={s}
                checked={suite === s}
                onChange={() => pickSuite(s)}
                className="accent-[var(--accent)]"
              />
              <span className="font-mono">{s}</span>
              <span className="text-ink-3">
                {s === 'retrieval'
                  ? 'search quality, no model answers'
                  : 'the full chat pipeline plus a judge'}
              </span>
            </label>
          ))}
        </fieldset>

        {suite === 'answer' && (
          <p className="border-l-2 border-warn pl-3 text-sm text-ink-2">
            {strings.evals.runWarning}
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Dataset">
            <select
              value={dataset}
              onChange={(e) => setDataset(e.target.value)}
              className={cn(controlClass, 'h-9')}
            >
              {(datasets.data ?? [{ name: 'core', cases: 0 }]).map((d) => (
                <option key={d.name} value={d.name}>
                  {d.name}
                  {d.cases ? ` (${d.cases} cases)` : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Split">
            <select
              value={split}
              onChange={(e) => setSplit(e.target.value as 'DEV' | 'HELDOUT')}
              className={cn(controlClass, 'h-9')}
            >
              <option value="DEV">dev</option>
              <option value="HELDOUT">held-out</option>
            </select>
          </Field>
        </div>

        <Field label="Config" hint="A file name under evals/configs/<suite>/." error={configError}>
          <Input
            value={config}
            onChange={(e) => setConfig(e.target.value.trim())}
            list={listId}
            className="font-mono"
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        <datalist id={listId}>
          {knownConfigs[suite]?.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>

        <Field label="Limit" hint="Optional: run only the first N cases." error={limitError}>
          <Input
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            inputMode="numeric"
            className="w-32 font-mono"
          />
        </Field>

        {error && (
          <p role="alert" className="text-sm text-error">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
