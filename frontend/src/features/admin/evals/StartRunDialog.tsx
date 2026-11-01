import { useId, useState, type FormEvent } from 'react';
import { useEvalDatasets, useStartEvalRun } from '@/api/queries';
import { isApiError } from '@/api/client';
import { Button, Callout, Dialog, Field, Input, RadioGroup, Select, toast } from '@/ui';
import { strings } from '../strings';
import { knownConfigs } from './metrics';

const NAME = /^[a-z0-9-]+$/;

type Suite = 'retrieval' | 'answer';

const suites = [
  { value: 'retrieval', label: 'Retrieval', description: 'Search quality, no model answers.' },
  { value: 'answer', label: 'Answer', description: 'The full chat pipeline plus a judge.' },
];

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
  const suiteLabel = useId();
  const [suite, setSuite] = useState<Suite>('retrieval');
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

  const pickSuite = (next: Suite) => {
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
          <Button type="submit" variant="primary" form="start-run" loading={start.isPending}>
            Queue run
          </Button>
        </>
      }
    >
      <form id="start-run" onSubmit={submit} className="flex flex-col gap-4">
        <div>
          <p id={suiteLabel} className="text-xs font-medium text-ink">
            Suite
          </p>
          <RadioGroup
            aria-labelledby={suiteLabel}
            value={suite}
            onValueChange={(value) => pickSuite(value as Suite)}
            options={suites}
          />
        </div>

        {suite === 'answer' && <Callout tone="warn">{strings.evals.runWarning}</Callout>}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Dataset">
            <Select value={dataset} onChange={(e) => setDataset(e.target.value)}>
              {(datasets.data ?? [{ name: 'core', cases: 0 }]).map((d) => (
                <option key={d.name} value={d.name}>
                  {d.name}
                  {d.cases ? ` (${d.cases} cases)` : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Split">
            <Select value={split} onChange={(e) => setSplit(e.target.value as 'DEV' | 'HELDOUT')}>
              <option value="DEV">dev</option>
              <option value="HELDOUT">held-out</option>
            </Select>
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
          <div className="w-32">
            <Input
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              inputMode="numeric"
              className="font-mono"
            />
          </div>
        </Field>

        {error && <Callout tone="error">{error}</Callout>}
      </form>
    </Dialog>
  );
}
