import { useState, type ReactNode } from 'react';
import { createFileRoute, notFound } from '@tanstack/react-router';
import { DotsThree, Trash } from '@phosphor-icons/react';
import { useBreakpoint } from '@/lib/breakpoints';
import { displayTitle } from '@/lib/displayTitle';
import { useTheme } from '@/lib/theme';
import { ApiError } from '@/api/client';
import {
  AuthShell,
  BackLink,
  Button,
  Callout,
  Card,
  Checkbox,
  Chip,
  ChipButton,
  DataTable,
  Dialog,
  EmptyState,
  Field,
  Input,
  Kbd,
  LinkTab,
  LinkTabs,
  Menu,
  MenuCheckboxItem,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  NotFound,
  PageHeader,
  PageLoading,
  Popover,
  ProgressRule,
  RadioGroup,
  RouteError,
  Rule,
  SectionHeading,
  Select,
  Sheet,
  Skeleton,
  SourceBadge,
  Spinner,
  Stat,
  Stats,
  StatusDot,
  Switch,
  TBody,
  TD,
  TH,
  THead,
  TR,
  TabPanel,
  Table,
  Tabs,
  TextButton,
  TextLink,
  Textarea,
  Tooltip,
  TooltipProvider,
  Wordmark,
  toast,
} from '@/ui';

// Development gallery: every part of the kit, light and dark side by side. Not shipped.
// Dialogs, menus and toasts render at the page root, so they follow the Theme switch rather
// than the column they were opened from.
export const Route = createFileRoute('/dev/ui')({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound();
  },
  component: Gallery,
});

type Preview = 'auth' | 'notFound' | 'error' | null;

function Gallery() {
  const [theme, setTheme] = useTheme();
  const [preview, setPreview] = useState<Preview>(null);
  const bp = useBreakpoint();
  return (
    <TooltipProvider>
      <div className="min-h-dvh bg-paper text-ink">
        <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-rule px-6 py-3">
          <div className="flex items-baseline gap-4">
            <Wordmark />
            <span className="text-xs text-ink-3">Interface kit · {bp}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
            <span>Theme</span>
            {(['system', 'light', 'dark'] as const).map((t) => (
              <ChipButton key={t} pressed={theme === t} onClick={() => setTheme(t)}>
                {t}
              </ChipButton>
            ))}
            <span className="ml-3">Full pages</span>
            <ChipButton onClick={() => setPreview('auth')}>Auth shell</ChipButton>
            <ChipButton onClick={() => setPreview('notFound')}>404</ChipButton>
            <ChipButton onClick={() => setPreview('error')}>Route error</ChipButton>
          </div>
        </header>
        <div className="grid grid-cols-1 sm:grid-cols-2">
          <Column />
          <div data-theme="dark" className="bg-paper text-ink">
            <Column />
          </div>
        </div>
        {preview && (
          <div className="fixed inset-0 z-40 overflow-auto bg-paper">
            <Button className="fixed top-3 right-3 z-50" onClick={() => setPreview(null)}>
              Close preview
            </Button>
            {preview === 'auth' && <AuthPreview />}
            {preview === 'notFound' && <NotFound />}
            {preview === 'error' && (
              <RouteError
                error={
                  new ApiError(500, {
                    success: false,
                    code: 'INTERNAL',
                    message: 'Something broke on our side.',
                    correlationId: '7f3c9a2e',
                  })
                }
                reset={() => {}}
                info={undefined}
              />
            )}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

function AuthPreview() {
  return (
    <AuthShell
      aside={
        <figure>
          <blockquote className="font-serif text-lg text-pretty text-ink">
            “Over the years, the field of deep learning has developed, for each application domain,
            multiple architectures.”
          </blockquote>
          <figcaption className="mt-3 text-xs text-ink-3">
            From a cited answer · The Little Book of Deep Learning, p. 101
          </figcaption>
        </figure>
      }
    >
      <h1 className="heading-page">Sign in</h1>
      <p className="mt-2 font-serif text-base text-ink-2">
        Your workspaces, conversations and study sets are kept.
      </p>
      <form className="mt-6 flex flex-col gap-4" onSubmit={(e) => e.preventDefault()}>
        <Field label="Email">
          <Input type="email" placeholder="you@example.com" />
        </Field>
        <Field label="Password">
          <Input type="password" />
        </Field>
        <Button variant="primary" type="submit">
          Sign in
        </Button>
      </form>
      <p className="mt-6 text-sm text-ink-2">
        Just looking? <TextLink to="/demo">Try the demo</TextLink>
      </p>
    </AuthShell>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} data-section={id} className="border-b border-rule px-6 py-6">
      <h2 className="mb-4 font-mono text-xs text-ink-3">{title}</h2>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </section>
  );
}

function Swatch({ token }: { token: string }) {
  return (
    <div className="flex w-24 flex-col gap-1">
      <div
        className="h-10 rounded-sm border border-rule"
        style={{ background: `var(--${token})` }}
      />
      <span className="font-mono text-xs text-ink-3">{token}</span>
    </div>
  );
}

function Column() {
  const [dialog, setDialog] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [on, setOn] = useState(true);
  const [off, setOff] = useState(false);
  const [tab, setTab] = useState('pdf');
  const [pinned, setPinned] = useState(false);
  const [checked, setChecked] = useState(true);
  const [mode, setMode] = useState('hybrid');
  return (
    <div>
      <Section id="type" title="type">
        <div className="flex flex-col gap-3">
          <p className="heading-display">Ask a book and its code together.</p>
          <p className="heading-page">Attention layers</p>
          <p className="heading-section">How the causal mask works</p>
          <p className="heading-minor">A token that only looks back</p>
          <div className="prose">
            <h2>Masking the future</h2>
            <p>
              In a causal attention layer, each token attends only to the tokens before it, and
              <em>every later position is masked out before the softmax</em>.
              <sup className="ml-0.5 font-sans text-accent">1</sup> Pages 98–101, 1,024 tokens,
              2023.
            </p>
            <h3>In nanoGPT</h3>
            <p>
              See <code>CausalSelfAttention.forward</code> in model.py.
            </p>
          </div>
          <p className="small-caps font-serif text-sm text-ink-3">Chapter five · Architectures</p>
          <p className="font-serif text-base oldstyle-nums">Oldstyle figures: 1,234 and 2025.</p>
          <p className="font-serif text-base lining-nums">Lining figures: 1,234 and 2025.</p>
          <p className="text-sm text-ink-2">UI text at 15px for descriptions and rows.</p>
          <p className="text-xs text-ink-3">Metadata at 13px: 189 pages, 22 files.</p>
          <p className="font-mono text-xs text-ink-3">search_sources “causal mask” 42 ms</p>
        </div>
      </Section>

      <Section id="colour" title="colour">
        <Swatch token="paper" />
        <Swatch token="paper-2" />
        <Swatch token="paper-3" />
        <Swatch token="ink" />
        <Swatch token="ink-2" />
        <Swatch token="ink-3" />
        <Swatch token="edge" />
        <Swatch token="accent" />
        <Swatch token="ok" />
        <Swatch token="warn" />
        <Swatch token="error" />
        <Swatch token="accent-wash" />
        <Swatch token="ok-wash" />
        <Swatch token="warn-wash" />
        <Swatch token="error-wash" />
        <Swatch token="kind-book" />
        <Swatch token="kind-repo" />
        <Swatch token="kind-site" />
        <Swatch token="kind-book-wash" />
        <Swatch token="kind-repo-wash" />
        <Swatch token="kind-site-wash" />
        <Swatch token="series-1" />
        <Swatch token="series-2" />
        <Swatch token="overlay" />
      </Section>

      <Section id="buttons" title="buttons">
        <Button variant="primary">Ask</Button>
        <Button>Cancel</Button>
        <Button variant="ghost">Rename</Button>
        <Button variant="danger">Delete</Button>
        <Button size="sm" variant="primary">
          Save
        </Button>
        <Button size="sm">Resync</Button>
        <Button loading variant="primary">
          Indexing
        </Button>
        <Button disabled>Disabled</Button>
      </Section>

      <Section id="links" title="links">
        <TextLink to="/dev/ui">Router link</TextLink>
        <TextButton onClick={() => {}}>Text button</TextButton>
        <BackLink to="/dev/ui">Back to sources</BackLink>
        <Kbd>⌘K</Kbd>
        <Kbd>Esc</Kbd>
      </Section>

      <Section id="fields" title="fields">
        <div className="grid w-full max-w-[420px] gap-4">
          <Field label="Workspace name" hint="You can change it later.">
            <Input placeholder="Deep learning notes" />
          </Field>
          <Field label="Repository" note="optional" error="Use the form owner/repo.">
            <Input defaultValue="karpathy nanoGPT" />
          </Field>
          <Field label="Search mode">
            <Select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="hybrid">Hybrid</option>
              <option value="vector">Vector only</option>
              <option value="keyword">Keywords only</option>
            </Select>
          </Field>
          <Field label="Focus">
            <Textarea placeholder="What should the summary concentrate on?" />
          </Field>
          <RadioGroup
            aria-label="Study type"
            value={mode}
            onValueChange={setMode}
            options={[
              { value: 'hybrid', label: 'Quiz', description: 'Multiple choice, with citations.' },
              { value: 'vector', label: 'Flashcards', description: 'Front and back.' },
              { value: 'keyword', label: 'Mind map', disabled: true },
            ]}
          />
          <div>
            <Checkbox
              checked={checked}
              onCheckedChange={setChecked}
              label="The Little Book of Deep Learning"
              description="Book · 189 pages"
            />
            <Checkbox checked={false} onCheckedChange={() => {}} label="Unchecked" />
            <Checkbox checked="indeterminate" onCheckedChange={() => {}} label="Some selected" />
          </div>
          <div>
            <Switch
              checked={on}
              onCheckedChange={setOn}
              label="Use memory"
              description="The answer can use what CodeBook remembers about you."
            />
            <Switch checked={off} onCheckedChange={setOff} label="Rerank results" />
          </div>
        </div>
      </Section>

      <Section id="overlays" title="overlays">
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
          title="Little Book · p. 101"
          description="The Little Book of Deep Learning"
        >
          <div className="prose px-4 py-4">
            <p>
              Over the years, the field of deep learning has developed, for each application domain,
              multiple architectures that exhibit good trade-offs.
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
              description: 'Architectures, 6 sections',
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

      <Section id="tabs" title="tabs">
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
        <LinkTabs label="Pages" className="w-full">
          <LinkTab to="/dev/ui">This page</LinkTab>
          <LinkTab to="/">Front page</LinkTab>
        </LinkTabs>
      </Section>

      <Section id="marks" title="marks">
        <Chip>Book</Chip>
        <Chip tone="accent">Ready</Chip>
        <Chip tone="ok">Supported</Chip>
        <Chip tone="warn">Indexing</Chip>
        <Chip tone="error">Failed</Chip>
        <ChipButton>Filter</ChipButton>
        <ChipButton pressed>Jump to latest</ChipButton>
        <Spinner />
      </Section>

      <Section id="status" title="status and source kind">
        <StatusDot tone="ok" label="Ready" />
        <StatusDot tone="warn" label="Indexing" />
        <StatusDot tone="error" label="Failed" />
        <StatusDot tone="neutral" label="Queued" />
        <StatusDot tone="accent" label="Selected" />
        <span className="flex items-center gap-2 text-xs text-ink-3">
          dot only
          <StatusDot tone="ok" label="Ready" hideLabel />
          <StatusDot tone="warn" label="Indexing" hideLabel />
          <StatusDot tone="error" label="Failed" hideLabel />
          <StatusDot tone="neutral" label="Queued" hideLabel />
        </span>
        <div className="flex w-full flex-wrap items-center gap-4">
          <SourceBadge type="PDF" />
          <SourceBadge type="GITHUB_REPO" />
          <SourceBadge type="WEBSITE" />
          <SourceBadge type="PDF" showLabel />
          <SourceBadge type="GITHUB_REPO" showLabel />
          <SourceBadge type="WEBSITE" showLabel />
        </div>
        <TitleRow type="PDF" title="The Little Book of Deep Learning" />
        <TitleRow
          type="GITHUB_REPO"
          title="karpathy/nanoGPT@3adf61e154c3fe3fca428ad6bc3818b27a3b8291"
        />
        <TitleRow type="GITHUB_REPO" title="pallets/flask@main" />
        <TitleRow type="GITHUB_REPO" title="karpathy/nanoGPT" />
      </Section>

      <Section id="page-parts" title="page header, section heading, empty state">
        <div className="w-full">
          <PageHeader
            kicker="Workspace"
            title="Deep learning notes"
            intro="A book, a repository and a documentation site, searched together."
            actions={
              <>
                <Button>Rename</Button>
                <Button variant="primary">Add a source</Button>
              </>
            }
          />
          <SectionHeading
            hint="Everything indexed in this workspace."
            actions={<Button size="sm">Resync all</Button>}
          >
            Sources
          </SectionHeading>
          <Rule />
          <EmptyState action={<TextLink to="/dev/ui">Add a source</TextLink>}>
            No sources yet. Add a book, a repository or a docs page to ask questions about it.
          </EmptyState>
        </div>
      </Section>

      <Section id="callouts" title="callouts and cards">
        <div className="flex w-full flex-col gap-3">
          <Callout title="Heads up">The demo workspace is read-only.</Callout>
          <Callout tone="warn" title="Some files were left out">
            Binary files and anything over 1 MB are skipped.
          </Callout>
          <Callout tone="error">The repository is private.</Callout>
          <Callout
            error={
              new ApiError(500, {
                success: false,
                code: 'INTERNAL',
                message: 'Sources could not be loaded.',
              })
            }
            onRetry={() => {}}
          />
          <Callout
            error={
              new ApiError(429, { success: false, code: 'RATE', message: 'Too many requests.' }, 30)
            }
            onRetry={() => {}}
          />
          <Callout error={new ApiError(401, undefined)} onRetry={() => {}} />
        </div>
        <div className="grid w-full grid-cols-2 gap-3">
          <Card>
            <p className="heading-minor">Quiz</p>
            <p className="mt-1 text-sm text-ink-2">Ten questions on attention.</p>
          </Card>
          <Card as="article" bare>
            <p className="px-4 pt-3 heading-minor">Bare card</p>
            <p className="px-4 pt-1 pb-3 text-sm text-ink-2">No built-in padding.</p>
          </Card>
        </div>
        <Stats className="w-full">
          <Stat label="pages" value="189" />
          <Stat label="files" value="1,024" />
          <Stat label="recall@5" value="0.819" note="of 1" />
          <Stat label="failed" value="3" tone="error" />
        </Stats>
      </Section>

      <Section id="loading" title="loading">
        <div className="w-full max-w-[420px]">
          <div className="py-2 text-sm">The Little Book of Deep Learning</div>
          <ProgressRule value={0.62} label="Indexing the book" />
          <div className="py-2 pt-4 text-sm">karpathy/nanoGPT</div>
          <ProgressRule label="Cloning the repository" />
        </div>
        <div className="flex w-full items-center gap-3">
          <Skeleton className="size-6" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-24" />
        </div>
        <PageLoading className="w-full" rows={3} />
      </Section>

      <Section id="tables" title="tables">
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
        <div className="w-full">
          <DataTable label="Evaluation runs" pinFirstColumn className="min-w-[720px]">
            <THead>
              <TR>
                <TH>Run</TH>
                <TH>Suite</TH>
                <TH>Model</TH>
                <TH className="text-right">recall@5</TH>
                <TH className="text-right">mrr</TH>
                <TH className="text-right">p95</TH>
              </TR>
            </THead>
            <TBody>
              <TR>
                <TD>hybrid-kw025</TD>
                <TD>retrieval</TD>
                <TD>gemini-2.5-flash</TD>
                <TD numeric>0.819</TD>
                <TD numeric>0.654</TD>
                <TD numeric>131 ms</TD>
              </TR>
              <TR>
                <TD>vector-only</TD>
                <TD>retrieval</TD>
                <TD>gemini-2.5-flash</TD>
                <TD numeric>0.771</TD>
                <TD numeric>0.602</TD>
                <TD numeric>96 ms</TD>
              </TR>
            </TBody>
          </DataTable>
        </div>
      </Section>

      <Section id="brand" title="wordmark and rule">
        <Wordmark size="sm" />
        <Wordmark size="md" />
        <Wordmark size="lg" />
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

function TitleRow({ type, title }: { type: 'PDF' | 'GITHUB_REPO' | 'WEBSITE'; title: string }) {
  const { name, ref } = displayTitle({ title, type });
  return (
    <div className="flex w-full items-center gap-3">
      <SourceBadge type={type} />
      <span className="min-w-0 truncate text-sm">{name}</span>
      {ref && <span className="font-mono text-xs text-ink-3">{ref}</span>}
    </div>
  );
}
