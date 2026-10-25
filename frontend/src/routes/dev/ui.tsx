import { useState } from 'react';
import { createFileRoute, notFound } from '@tanstack/react-router';
import { DotsThree, Trash } from '@phosphor-icons/react';
import { useTheme } from '@/lib/theme';
import {
  Button,
  Chip,
  ChipButton,
  Dialog,
  Field,
  Input,
  Kbd,
  Menu,
  MenuCheckboxItem,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  Popover,
  ProgressRule,
  Rule,
  Sheet,
  Spinner,
  Switch,
  TBody,
  TD,
  TH,
  THead,
  TR,
  TabPanel,
  Table,
  Tabs,
  Textarea,
  Toaster,
  Tooltip,
  TooltipProvider,
  toast,
} from '@/ui';

// Development gallery: every primitive, light and dark side by side. Not shipped.
export const Route = createFileRoute('/dev/ui')({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound();
  },
  component: Gallery,
});

function Gallery() {
  const [theme, setTheme] = useTheme();
  return (
    <TooltipProvider>
      <div className="min-h-dvh bg-paper text-ink">
        <header className="flex items-center justify-between border-b border-rule px-6 py-3">
          <h1 className="text-sm font-semibold">UI primitives</h1>
          <div className="flex items-center gap-2 text-xs text-ink-3">
            <span>Theme</span>
            {(['system', 'light', 'dark'] as const).map((t) => (
              <ChipButton key={t} pressed={theme === t} onClick={() => setTheme(t)}>
                {t}
              </ChipButton>
            ))}
          </div>
        </header>
        <div className="grid grid-cols-1 md:grid-cols-2">
          <Column />
          <div data-theme="dark" className="bg-paper text-ink">
            <Column />
          </div>
        </div>
        <Toaster />
      </div>
    </TooltipProvider>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-rule px-6 py-5">
      <h2 className="mb-3 font-mono text-xs text-ink-3">{title}</h2>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </section>
  );
}

function Column() {
  const [dialog, setDialog] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [on, setOn] = useState(true);
  const [tab, setTab] = useState('pdf');
  const [pinned, setPinned] = useState(false);
  return (
    <div>
      <Section title="type">
        <div className="flex flex-col gap-2">
          <p className="text-2xl font-semibold">Ask a book and its code together.</p>
          <p className="text-xl font-semibold">Leader-based replication</p>
          <p className="text-lg font-semibold">How a failed follower catches up</p>
          <p className="prose max-w-[60ch]">
            On a node failure, each follower keeps a log of the data changes it has received from
            the leader. When it reconnects, it requests all changes that happened since the last
            transaction it processed.<sup className="ml-0.5 font-sans text-accent">1</sup>
          </p>
          <p className="text-sm text-ink-2">Secondary text at 15px, for descriptions and rows.</p>
          <p className="font-mono text-xs text-ink-3">search_sources "leader failure" 42 ms</p>
        </div>
      </Section>

      <Section title="buttons">
        <Button variant="primary">Ask</Button>
        <Button>Cancel</Button>
        <Button variant="ghost">Rename</Button>
        <Button size="sm" variant="primary">
          Save
        </Button>
        <Button size="sm">Resync</Button>
        <Button loading variant="primary">
          Indexing
        </Button>
        <Button disabled>Disabled</Button>
      </Section>

      <Section title="fields">
        <div className="grid w-full max-w-[420px] gap-4">
          <Field label="Workspace name" hint="You can change it later.">
            <Input placeholder="Distributed systems" />
          </Field>
          <Field label="Repository" note="optional" error="Use the form owner/repo.">
            <Input defaultValue="expressjs express" />
          </Field>
          <Field label="Focus">
            <Textarea placeholder="What should the summary concentrate on?" />
          </Field>
          <Switch
            checked={on}
            onCheckedChange={setOn}
            label="Use memory"
            description="The answer can use what CodeBook remembers about you."
          />
        </div>
      </Section>

      <Section title="overlays">
        <Button onClick={() => setDialog(true)}>Dialog</Button>
        <Dialog
          open={dialog}
          onOpenChange={setDialog}
          title="Delete workspace"
          description="Sources, conversations and study sets in it are removed."
          actions={
            <>
              <Button onClick={() => setDialog(false)}>Cancel</Button>
              <Button variant="primary" onClick={() => setDialog(false)}>
                Delete
              </Button>
            </>
          }
        >
          <Field label="Type the workspace name to confirm">
            <Input />
          </Field>
        </Dialog>

        <Button onClick={() => setSheet(true)}>Sheet</Button>
        <Sheet
          open={sheet}
          onOpenChange={setSheet}
          title="DDIA · p. 157"
          description="Designing Data-Intensive Applications"
        >
          <div className="prose px-4 py-4">
            <p>
              Each follower keeps a log of the data changes it has received from the leader. If a
              follower crashes and is restarted, it can recover from its log.
            </p>
          </div>
        </Sheet>

        <Popover trigger={<Button>Popover</Button>}>
          <p className="text-sm">A short note with its location.</p>
          <p className="mt-1 font-mono text-xs text-ink-3">lib/router/index.js:42–61</p>
        </Popover>

        <Menu
          trigger={
            <Button aria-label="More actions" size="sm">
              <DotsThree size={18} />
            </Button>
          }
        >
          <MenuLabel>Conversation</MenuLabel>
          <MenuItem shortcut="R">Rename</MenuItem>
          <MenuCheckboxItem checked={pinned} onCheckedChange={setPinned}>
            Pinned
          </MenuCheckboxItem>
          <MenuSeparator />
          <MenuItem danger icon={<Trash size={14} />}>
            Delete
          </MenuItem>
        </Menu>

        <Tooltip content="Open the cited page">
          <Button variant="ghost">Tooltip</Button>
        </Tooltip>

        <Button
          onClick={() =>
            toast({
              title: 'Summary ready',
              description: 'Leader-based replication, 6 sections',
              kind: 'ok',
            })
          }
        >
          Toast
        </Button>
        <Button
          onClick={() =>
            toast({
              title: 'Indexing failed',
              description: 'The repository is private.',
              kind: 'error',
              action: { label: 'Resync', onClick: () => {} },
            })
          }
        >
          Error toast
        </Button>
      </Section>

      <Section title="tabs">
        <Tabs
          label="Source type"
          value={tab}
          onValueChange={setTab}
          className="w-full"
          items={[
            { value: 'pdf', label: 'PDF' },
            { value: 'repo', label: 'Repository' },
            { value: 'web', label: 'Website' },
          ]}
        >
          <TabPanel value="pdf">Drop a PDF here, or pick one. Up to 50 MB.</TabPanel>
          <TabPanel value="repo">A public GitHub repository and a branch, tag or commit.</TabPanel>
          <TabPanel value="web">One page, or a documentation site.</TabPanel>
        </Tabs>
      </Section>

      <Section title="marks">
        <Chip>Book</Chip>
        <Chip tone="accent">Ready</Chip>
        <Chip tone="ok">Supported</Chip>
        <Chip tone="warn">Indexing</Chip>
        <Chip tone="error">Failed</Chip>
        <ChipButton pressed>Jump to latest</ChipButton>
        <Kbd>⌘K</Kbd>
        <Kbd>Esc</Kbd>
        <Spinner />
      </Section>

      <Section title="progress">
        <div className="w-full max-w-[420px]">
          <div className="py-2 text-sm">Designing Data-Intensive Applications</div>
          <ProgressRule value={0.62} label="Indexing the book" />
          <div className="py-2 pt-4 text-sm">expressjs/express</div>
          <ProgressRule label="Cloning the repository" />
        </div>
      </Section>

      <Section title="table">
        <Table stickyHeader>
          <THead>
            <TR>
              <TH>Run</TH>
              <TH>Suite</TH>
              <TH className="text-right">recall@5</TH>
              <TH className="text-right">p95</TH>
            </TR>
          </THead>
          <TBody>
            <TR>
              <TD>hybrid-kw025</TD>
              <TD>retrieval</TD>
              <TD numeric>0.819</TD>
              <TD numeric>131 ms</TD>
            </TR>
            <TR>
              <TD>vector-only</TD>
              <TD>retrieval</TD>
              <TD numeric>0.771</TD>
              <TD numeric>96 ms</TD>
            </TR>
          </TBody>
        </Table>
      </Section>

      <Section title="rule">
        <div className="flex h-8 w-full items-center gap-3 text-xs text-ink-3">
          left
          <Rule orientation="vertical" />
          right
        </div>
        <Rule />
      </Section>
    </div>
  );
}
