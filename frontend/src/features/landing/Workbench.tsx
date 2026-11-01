import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowCounterClockwise,
  CaretLeft,
  CaretRight,
  FastForward,
  Pause,
  Play,
} from '@phosphor-icons/react';
import type { Citation, SourceType } from '@/api/types';
import { cn } from '@/lib/cn';
import { displayTitle } from '@/lib/displayTitle';
import { Button } from '@/ui/Button';
import { SourceBadge } from '@/ui/SourceBadge';
import { Spinner } from '@/ui/Spinner';
import { citationOrder, locationOf, parseAnswer, type Part, type Sentence } from './answer';
import { CodeListing } from './CodeListing';
import type { BookPage, CodeSlice, TurnFixture } from './fixtureTypes';
import { fixtures } from './fixtures';
import { useDarkTheme, useReducedMotion, useSeen } from './hooks';
import { landing } from './strings';
import { answerAt, describeStep, formatMs, schedule, type Schedule } from './timeline';

const t = landing.watch;

type Target =
  | { kind: 'page'; page: BookPage; rects: BookPage['marks'][number]['rects'] }
  | { kind: 'code'; slice: CodeSlice; from: number; to: number }
  | { kind: 'text'; heading?: string; text: string };

function targetOf(c: Citation): Target {
  if (c.kind === 'PAGES') {
    const page = fixtures.book?.pages.find((p) => p.page === c.pageStart);
    const rects = page?.marks.find((m) => m.n === c.n)?.rects;
    if (page && rects?.length) return { kind: 'page', page, rects };
  }
  if (c.kind === 'LINES' && c.path && c.lineStart) {
    const from = c.lineStart;
    const to = c.lineEnd ?? from;
    const slice = fixtures.code?.slices.find(
      (s) => s.path === c.path && s.lineStart <= from && s.lineEnd >= to,
    );
    if (slice) return { kind: 'code', slice, from, to };
  }
  return { kind: 'text', heading: c.heading, text: c.snippet };
}

/** Moves a recorded turn forward in steps of about 50 ms; the page shows whatever `time` it is. */
function usePlayback(total: number) {
  const [time, setTime] = useState(total);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    let pending = 0;
    const step = (now: number) => {
      pending += now - last;
      last = now;
      if (pending >= 50) {
        const advance = pending;
        pending = 0;
        setTime((current) => {
          const next = current + advance;
          if (next >= total) {
            setPlaying(false);
            return total;
          }
          return next;
        });
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [playing, total]);
  return {
    time,
    playing,
    reset: () => {
      setPlaying(false);
      setTime(0);
    },
    restart: () => {
      setTime(0);
      setPlaying(true);
    },
    resume: () => setPlaying(true),
    pause: () => setPlaying(false),
    finish: () => {
      setPlaying(false);
      setTime(total);
    },
  };
}

export function Workbench({ highlight }: { highlight: SourceType | null }) {
  const turn = fixtures.turn;
  if (!turn) return null;
  return <Stage turn={turn} highlight={highlight} />;
}

function Stage({ turn, highlight }: { turn: TurnFixture; highlight: SourceType | null }) {
  const plan = useMemo(() => schedule(turn), [turn]);
  const blocks = useMemo(() => parseAnswer(turn.answer), [turn]);
  const order = useMemo(
    () => citationOrder(blocks).filter((n) => turn.citations.some((c) => c.n === n)),
    [blocks, turn],
  );
  const byNumber = useMemo(() => new Map(turn.citations.map((c) => [c.n, c])), [turn]);

  const reduced = useReducedMotion();
  const playback = usePlayback(plan.total);
  const [open, setOpen] = useState<number | undefined>(order[0]);
  const ref = useRef<HTMLDivElement>(null);
  const seen = useSeen(ref, 0.3);
  const waiting = useRef(false);

  // Before the section is reached the recording rests at its start, so it plays as it arrives.
  // Where scripts or motion aren't wanted, or it is already in view, the finished state stays.
  useEffect(() => {
    const el = ref.current;
    if (reduced || !el) return;
    if (el.getBoundingClientRect().top > window.innerHeight * 0.7) {
      waiting.current = true;
      playback.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival of the script
  }, []);
  useEffect(() => {
    if (seen && waiting.current) {
      waiting.current = false;
      playback.restart();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seen]);

  const done = playback.time >= plan.total;
  const index = open === undefined ? -1 : order.indexOf(open);
  const active = open === undefined ? undefined : byNumber.get(open);
  const step = (by: number) => {
    const next = order[(index + by + order.length) % order.length];
    if (next !== undefined) setOpen(next);
  };

  return (
    <section
      ref={ref}
      id="watch"
      aria-labelledby="watch-title"
      className="mx-auto w-full max-w-wide scroll-mt-4 px-4 py-14 sm:px-8 sm:py-20"
    >
      <div className="max-w-[40rem]">
        <h2 id="watch-title" className="heading-page">
          {t.title}
        </h2>
        <p className="prose mt-3 text-ink-2">{t.lede}</p>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-10">
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-1">
            {playback.playing ? (
              <Button variant="ghost" onClick={playback.pause}>
                <Pause size={16} aria-hidden />
                {t.pause}
              </Button>
            ) : done ? (
              <Button variant="ghost" onClick={playback.restart}>
                <ArrowCounterClockwise size={16} aria-hidden />
                {t.replay}
              </Button>
            ) : (
              <Button
                variant="ghost"
                onClick={playback.time === 0 ? playback.restart : playback.resume}
              >
                <Play size={16} aria-hidden />
                {t.play}
              </Button>
            )}
            {!done && (
              <Button variant="ghost" onClick={playback.finish}>
                <FastForward size={16} aria-hidden />
                {t.skip}
              </Button>
            )}
            <p className="ml-auto text-xs text-ink-3" aria-live="polite">
              {done ? t.answeredIn(formatMs(turn.latencyMs)) : playback.playing ? t.working : ''}
            </p>
          </div>

          {/* The finished conversation holds the space, so nothing below moves while it plays. */}
          <div className="grid">
            <div className="col-start-1 row-start-1">
              <Conversation
                turn={turn}
                plan={plan}
                time={playback.time}
                order={order}
                byNumber={byNumber}
                open={open}
                onOpen={setOpen}
                highlight={highlight}
              />
            </div>
            {!done && (
              <div aria-hidden inert className="invisible col-start-1 row-start-1">
                <Conversation
                  turn={turn}
                  plan={plan}
                  time={plan.total}
                  order={order}
                  byNumber={byNumber}
                  open={open}
                  onOpen={setOpen}
                  highlight={null}
                />
              </div>
            )}
          </div>
        </div>

        <div className="min-w-0 lg:sticky lg:top-6 lg:self-start">
          <Viewer
            citation={done ? active : undefined}
            position={index}
            count={order.length}
            onStep={step}
          />
        </div>
      </div>
    </section>
  );
}

function Conversation(props: {
  turn: TurnFixture;
  plan: Schedule;
  time: number;
  order: number[];
  byNumber: Map<number, Citation>;
  open: number | undefined;
  onOpen: (n: number) => void;
  highlight: SourceType | null;
}) {
  const { turn, plan, time, order, byNumber, open, onOpen, highlight } = props;
  const shown = plan.steps.filter((s) => s.start <= time);
  const written = answerAt(plan, time);
  const blocks = useMemo(() => parseAnswer(written), [written]);
  const done = time >= plan.total;

  return (
    <article className="rounded-md border border-rule bg-paper-2 p-4 sm:p-6">
      <p className="heading-minor text-pretty">{turn.question}</p>

      {shown.length > 0 && (
        <div className="mt-5">
          <h3 className="text-xs font-medium text-ink-3">{t.consulted}</h3>
          <ol className="mt-2 flex list-none flex-col gap-1.5 p-0 text-xs">
            {shown.map(({ step, end }, i) => {
              const { verb, detail } = describeStep(step);
              const running = time < end;
              return (
                <li key={i} className="flex min-w-0 items-baseline gap-x-2">
                  <span className="shrink-0 text-ink-2">{verb}</span>
                  <span className="min-w-0 truncate font-mono text-ink">{detail}</span>
                  <span className="ml-auto shrink-0 pl-2 font-mono text-ink-3 tabular-nums">
                    {running ? <Spinner className="size-3" label="Running" /> : formatMs(step.ms)}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {blocks.length > 0 && (
        <div className="prose mt-5 max-w-none text-ink">
          {groupLists(blocks).map((group, g) =>
            group.list ? (
              <ul key={g}>
                {group.items.map((sentences, i) => (
                  <li key={i}>
                    <Sentences
                      sentences={sentences}
                      order={order}
                      byNumber={byNumber}
                      open={open}
                      onOpen={onOpen}
                      highlight={highlight}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p key={g}>
                <Sentences
                  sentences={group.sentences}
                  order={order}
                  byNumber={byNumber}
                  open={open}
                  onOpen={onOpen}
                  highlight={highlight}
                />
              </p>
            ),
          )}
        </div>
      )}

      {done && (
        <div className="mt-6 border-t border-rule pt-4">
          <h3 className="text-xs font-medium text-ink-3">{t.notes}</h3>
          <ol className="mt-2 flex list-none flex-col gap-1 p-0">
            {order.map((n, i) => {
              const c = byNumber.get(n)!;
              const selected = open === n;
              return (
                <li key={n}>
                  <button
                    type="button"
                    onClick={() => onOpen(n)}
                    aria-pressed={selected}
                    className={cn(
                      'flex w-full items-start gap-3 rounded-sm px-2 py-2 text-left text-sm transition-colors max-sm:min-h-11',
                      selected ? 'bg-accent-wash' : 'hover:bg-paper-3',
                    )}
                  >
                    <span className="mt-0.5 w-4 shrink-0 text-right font-serif text-ink-3 tabular-nums">
                      {i + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-ink">
                        {displayTitle({ title: c.sourceTitle, type: c.sourceType }).name}
                        <span className="text-ink-3"> · {locationOf(c)}</span>
                      </span>
                      {selected && (
                        <span className="mt-1 block font-serif text-xs text-ink-2 italic">
                          “{quote(c.snippet)}”
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </article>
  );
}

function quote(snippet: string) {
  const flat = snippet.replace(/\s+/g, ' ').trim().replace(/^…\s*/, '');
  return flat.length > 230 ? `${flat.slice(0, 229).trimEnd()}…` : flat;
}

type Group = { list: false; sentences: Sentence[] } | { list: true; items: Sentence[][] };

function groupLists(blocks: ReturnType<typeof parseAnswer>): Group[] {
  const groups: Group[] = [];
  for (const block of blocks) {
    const last = groups[groups.length - 1];
    if (block.list) {
      if (last?.list) last.items.push(block.sentences);
      else groups.push({ list: true, items: [block.sentences] });
    } else {
      groups.push({ list: false, sentences: block.sentences });
    }
  }
  return groups;
}

function Sentences(props: {
  sentences: Sentence[];
  order: number[];
  byNumber: Map<number, Citation>;
  open: number | undefined;
  onOpen: (n: number) => void;
  highlight: SourceType | null;
}) {
  const { sentences, order, byNumber, open, onOpen, highlight } = props;
  return sentences.map((sentence, i) => {
    const marked =
      highlight !== null && sentence.cites.some((n) => byNumber.get(n)?.sourceType === highlight);
    return (
      <span
        key={i}
        className={cn(
          'rounded-xs transition-colors duration-150 [box-decoration-break:clone]',
          marked && 'bg-highlight',
        )}
      >
        {sentence.parts.map((part, j) => (
          <Fragment key={j}>{renderPart(part, order, byNumber, open, onOpen)}</Fragment>
        ))}
      </span>
    );
  });
}

function renderPart(
  part: Part,
  order: number[],
  byNumber: Map<number, Citation>,
  open: number | undefined,
  onOpen: (n: number) => void,
) {
  switch (part.kind) {
    case 'text':
      return part.text;
    case 'code':
      return <code>{part.text}</code>;
    case 'bold':
      return <strong>{part.text}</strong>;
    case 'cite': {
      const c = byNumber.get(part.n);
      const position = order.indexOf(part.n);
      if (!c || position === -1) return null;
      return (
        <button
          type="button"
          onClick={() => onOpen(part.n)}
          aria-pressed={open === part.n}
          aria-label={`Source ${position + 1}: ${locationOf(c)}`}
          className={cn(
            'relative mx-0.5 inline-flex size-[1.45em] -translate-y-[0.3em] items-center justify-center rounded-full align-baseline font-sans text-[0.7em] font-medium tabular-nums transition-colors',
            'after:absolute after:-inset-1.5 after:content-[""]',
            open === part.n
              ? 'bg-accent text-paper'
              : 'bg-accent-wash text-accent hover:bg-accent hover:text-paper',
          )}
        >
          {position + 1}
        </button>
      );
    }
  }
}

function Viewer({
  citation,
  position,
  count,
  onStep,
}: {
  citation: Citation | undefined;
  position: number;
  count: number;
  onStep: (by: number) => void;
}) {
  const [dark] = useDarkTheme();
  const target = citation ? targetOf(citation) : undefined;
  return (
    <div className="overflow-hidden rounded-md border border-rule bg-paper">
      <div className="flex min-h-12 items-center gap-3 border-b border-rule px-3 py-2">
        {citation ? (
          <>
            {citation.sourceType && <SourceBadge type={citation.sourceType} />}
            <p className="min-w-0 flex-1 truncate text-xs text-ink-2">
              <span className="text-ink">
                {displayTitle({ title: citation.sourceTitle, type: citation.sourceType }).name}
              </span>
              <span className="text-ink-3"> · {locationOf(citation)}</span>
            </p>
            <p className="shrink-0 text-xs text-ink-3 tabular-nums">{t.of(position + 1, count)}</p>
            <div className="flex shrink-0">
              <Button
                variant="ghost"
                size="sm"
                aria-label="Previous source"
                onClick={() => onStep(-1)}
              >
                <CaretLeft size={14} aria-hidden />
              </Button>
              <Button variant="ghost" size="sm" aria-label="Next source" onClick={() => onStep(1)}>
                <CaretRight size={14} aria-hidden />
              </Button>
            </div>
          </>
        ) : (
          <p className="text-xs text-ink-3">{t.viewer}</p>
        )}
      </div>

      <div className="h-[28rem] bg-paper-3">
        {!target && (
          <p className="grid h-full place-items-center px-8 text-center font-serif text-base text-ink-3">
            {t.emptyViewer}
          </p>
        )}
        {target?.kind === 'page' && <PageImage target={target} dark={dark} />}
        {target?.kind === 'code' && (
          <div className="h-full overflow-auto bg-paper-2 py-3">
            <CodeListing slice={target.slice} mark={[target.from, target.to]} />
          </div>
        )}
        {target?.kind === 'text' && (
          <div className="h-full overflow-auto bg-paper p-6">
            {target.heading && <h3 className="heading-minor">{target.heading}</h3>}
            <p className="prose mt-3">
              <mark className="rounded-xs bg-highlight px-0.5 text-ink [box-decoration-break:clone]">
                {quote(target.text)}
              </mark>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function PageImage({ target, dark }: { target: Extract<Target, { kind: 'page' }>; dark: boolean }) {
  const { page, rects } = target;
  const ratio = page.height / page.width;
  const middle = rects.reduce((sum, r) => sum + r.y + r.h / 2, 0) / rects.length;
  // The page is as wide as the pane; slide it so the marked passage sits in the upper third.
  const top = `clamp(calc(28rem - 100cqw * ${ratio.toFixed(4)}), calc(8.4rem - 100cqw * ${(ratio * middle).toFixed(4)}), 0px)`;
  return (
    <div className="relative h-full overflow-hidden [container-type:inline-size]">
      <div className="absolute inset-x-0" style={{ top }}>
        <img
          src={page.image}
          width={page.width}
          height={page.height}
          alt={`Page ${page.page} of the book, with the cited passage marked`}
          decoding="async"
          className={cn('block w-full', dark && 'brightness-[0.82]')}
        />
        {rects.map((r, i) => (
          <span
            key={i}
            aria-hidden
            className="absolute rounded-xs bg-highlight mix-blend-multiply"
            style={{
              left: `${r.x * 100}%`,
              top: `${r.y * 100}%`,
              width: `${r.w * 100}%`,
              height: `${r.h * 100}%`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
