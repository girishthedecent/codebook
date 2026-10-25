import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { CaretRight } from '@phosphor-icons/react';
import type { Citation } from '@/api/types';
import { Button, TabPanel, Tabs } from '@/ui';
import { cn } from '@/lib/cn';
import { useBreakpoint } from '@/lib/breakpoints';
import { Cites } from './Cites';
import { citationsOf, type MindmapData, type MindmapNode } from './data';
import { s } from './strings';

type Props = { map: MindmapData; index: Map<number, Citation> };

/** A folding tree: an SVG map on wide screens (with an outline tab), an outline on phones. */
export function MindMap({ map, index }: Props) {
  const phone = useBreakpoint() === 'phone';
  const [view, setView] = useState('map');
  // Folded node ids, shared by both views so switching keeps what you folded.
  const [folded, setFolded] = useState<Set<string>>(() => initialFolds(map.root));
  const toggle = (id: string) =>
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (phone) return <Outline root={map.root} folded={folded} toggle={toggle} index={index} />;

  return (
    <Tabs
      label={s.map.view}
      value={view}
      onValueChange={setView}
      items={[
        { value: 'map', label: s.map.map },
        { value: 'outline', label: s.map.outline },
      ]}
    >
      <TabPanel value="map" className="pt-4">
        <MapCanvas root={map.root} folded={folded} toggle={toggle} index={index} />
      </TabPanel>
      <TabPanel value="outline" className="pt-4">
        <Outline root={map.root} folded={folded} toggle={toggle} index={index} />
      </TabPanel>
    </Tabs>
  );
}

/** Big maps open with everything below the second level folded. */
function initialFolds(root: MindmapNode): Set<string> {
  const folds = new Set<string>();
  const total = count(root);
  if (total <= 24) return folds;
  for (const child of root.children)
    for (const grand of child.children) if (grand.children.length) folds.add(grand.id);
  return folds;
}

function count(node: MindmapNode): number {
  return 1 + node.children.reduce((n, c) => n + count(c), 0);
}

// ---------------------------------------------------------------------------------------------
// Outline

type TreeProps = {
  root: MindmapNode;
  folded: Set<string>;
  toggle: (id: string) => void;
  index: Map<number, Citation>;
};

function Outline({ root, folded, toggle, index }: TreeProps) {
  return (
    <ul role="tree" aria-label={root.label} className="text-sm">
      <OutlineItem node={root} depth={0} folded={folded} toggle={toggle} index={index} />
    </ul>
  );
}

function OutlineItem({
  node,
  depth,
  folded,
  toggle,
  index,
}: { node: MindmapNode; depth: number } & Omit<TreeProps, 'root'>) {
  const hasChildren = node.children.length > 0;
  const open = hasChildren && !folded.has(node.id);
  return (
    <li role="treeitem" aria-expanded={hasChildren ? open : undefined} aria-selected={false}>
      <div
        className={cn(
          'flex min-h-10 items-start gap-1 border-b border-rule',
          depth === 0 && 'font-semibold',
        )}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => toggle(node.id)}
            aria-label={open ? `${s.map.collapse} ${node.label}` : `${s.map.expand} ${node.label}`}
            className="-ml-2 flex size-10 shrink-0 items-center justify-center rounded-xs text-ink-3 hover:bg-paper-2 hover:text-ink"
          >
            <CaretRight
              size={12}
              className={cn('transition-transform duration-150', open && 'rotate-90')}
            />
          </button>
        ) : (
          <span className="size-8 shrink-0" />
        )}
        <span className="py-2.5">
          {node.label} <Cites citations={citationsOf(node, index)} />
          {hasChildren && !open && (
            <span className="ml-1 font-mono text-xs text-ink-3">+{node.children.length}</span>
          )}
        </span>
      </div>
      {open && (
        <ul role="group" className="pl-5">
          {node.children.map((child) => (
            <OutlineItem
              key={child.id}
              node={child}
              depth={depth + 1}
              folded={folded}
              toggle={toggle}
              index={index}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------------------------
// Map: columns by depth, leaves one row apart, each parent centred on its children.

const COL = 240;
const ROW = 34;
const PAD = 24;
const MAX_LABEL = 210;
const FONT = '13px "IBM Plex Sans", system-ui, sans-serif';
const ROOT_FONT = '600 14px "IBM Plex Sans", system-ui, sans-serif';

type Placed = {
  node: MindmapNode;
  x: number;
  y: number;
  label: string;
  width: number;
  parent?: Placed;
  folded: boolean;
};

let ctx: CanvasRenderingContext2D | null | undefined;
function measure(text: string, font: string) {
  if (ctx === undefined) ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return text.length * 6.8;
  ctx.font = font;
  return ctx.measureText(text).width;
}

/** Shortens a label to fit the column, on a word boundary when there is one. */
function fit(label: string, font: string): { label: string; width: number } {
  let width = measure(label, font);
  if (width <= MAX_LABEL) return { label, width };
  let cut = label;
  while (cut.length > 4 && measure(cut + '…', font) > MAX_LABEL) {
    const space = cut.lastIndexOf(' ', cut.length - 2);
    cut = space > cut.length * 0.6 ? cut.slice(0, space) : cut.slice(0, -1);
  }
  cut = cut.trimEnd() + '…';
  width = measure(cut, font);
  return { label: cut, width };
}

function layout(root: MindmapNode, folded: Set<string>): Placed[] {
  const placed: Placed[] = [];
  let row = 0;
  const walk = (node: MindmapNode, depth: number, parent?: Placed): Placed => {
    const font = depth === 0 ? ROOT_FONT : FONT;
    const { label, width } = fit(node.label, font);
    const isFolded = folded.has(node.id) && node.children.length > 0;
    const me: Placed = { node, x: depth * COL, y: 0, label, width, parent, folded: isFolded };
    placed.push(me);
    const kids = isFolded ? [] : node.children.map((child) => walk(child, depth + 1, me));
    if (kids.length === 0) me.y = row++ * ROW;
    else me.y = (kids[0]!.y + kids[kids.length - 1]!.y) / 2;
    return me;
  };
  walk(root, 0);
  return placed;
}

type View = { x: number; y: number; k: number };

function MapCanvas({ root, folded, toggle, index }: TreeProps) {
  const nodes = useMemo(() => layout(root, folded), [root, folded]);
  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: PAD, y: PAD, k: 1 });
  const [selected, setSelected] = useState<string | null>(null);

  const bounds = useMemo(() => {
    let w = 0;
    let h = 0;
    for (const n of nodes) {
      w = Math.max(w, n.x + n.width + 40);
      h = Math.max(h, n.y);
    }
    return { w, h: h + ROW };
  }, [nodes]);

  const fitView = () => {
    const el = box.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const k = Math.min(
      1,
      Math.max(0.35, Math.min((width - PAD * 2) / bounds.w, (height - PAD * 2) / bounds.h)),
    );
    setView({ k, x: PAD, y: Math.max(PAD, (height - bounds.h * k) / 2) + (ROW / 2) * k });
  };
  // Fit once when the map opens; after that the reader's pan and zoom are left alone.
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current) return;
    fitted.current = true;
    fitView();
  });

  const zoomAt = (px: number, py: number, factor: number) =>
    setView((v) => zoomed(v, px, py, factor));
  const zoomCenter = (factor: number) => {
    const rect = box.current?.getBoundingClientRect();
    if (rect) zoomAt(rect.width / 2, rect.height / 2, factor);
  };

  // Wheel zooms around the cursor. Registered by hand so it can cancel the page scroll.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * 0.0015);
      setView((v) => zoomed(v, e.clientX - rect.left, e.clientY - rect.top, factor));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Drag pans; two fingers pinch. A press that barely moves is a click on whatever is under it.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const moved = useRef(0);
  const pinch = useRef<number | null>(null);
  const onPointerDown = (e: ReactPointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved.current = 0;
    if (pointers.current.size === 2) pinch.current = spread(pointers.current);
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const next = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, next);
    if (pointers.current.size === 2 && pinch.current) {
      const now = spread(pointers.current);
      const rect = box.current!.getBoundingClientRect();
      const [a, b] = [...pointers.current.values()];
      zoomAt((a!.x + b!.x) / 2 - rect.left, (a!.y + b!.y) / 2 - rect.top, now / pinch.current);
      pinch.current = now;
      moved.current += 10;
      return;
    }
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    moved.current += Math.abs(dx) + Math.abs(dy);
    if (moved.current > 4) {
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
    }
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };

  const activate = (n: Placed) => {
    setSelected(n.node.id);
    if (n.node.children.length) toggle(n.node.id);
  };

  const current = nodes.find((n) => n.node.id === selected);
  const cites = current ? citationsOf(current.node, index) : [];

  return (
    <div>
      <div
        ref={box}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="relative h-[min(70vh,640px)] min-h-[360px] cursor-grab touch-none overflow-hidden rounded-md border border-rule bg-paper active:cursor-grabbing"
      >
        <svg
          width="100%"
          height="100%"
          role="tree"
          aria-label={root.label}
          className="block select-none"
        >
          <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            {nodes.map((n) =>
              n.parent ? (
                <path
                  key={`edge-${n.node.id}`}
                  d={edge(n.parent, n)}
                  fill="none"
                  stroke="var(--rule-2)"
                  strokeWidth={1 / view.k}
                />
              ) : null,
            )}
            {nodes.map((n) => (
              <MapNode
                key={n.node.id}
                n={n}
                selected={n.node.id === selected}
                onActivate={() => {
                  if (moved.current <= 4) activate(n);
                }}
              />
            ))}
          </g>
        </svg>
        <div className="absolute right-2 bottom-2 flex gap-1 rounded-sm border border-rule bg-paper p-0.5">
          <Button
            size="sm"
            variant="ghost"
            className="h-10! min-w-10!"
            aria-label={s.map.zoomOut}
            onClick={() => zoomCenter(0.8)}
          >
            −
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-10! min-w-10!"
            aria-label={s.map.zoomIn}
            onClick={() => zoomCenter(1.25)}
          >
            +
          </Button>
          <Button size="sm" variant="ghost" className="h-10! md:h-7!" onClick={fitView}>
            {s.map.fit}
          </Button>
        </div>
      </div>
      <p className="mt-2 min-h-5 text-xs text-ink-3">
        {current ? (
          <>
            <span className="text-ink-2">{current.node.label}</span> <Cites citations={cites} />
          </>
        ) : (
          s.map.hint
        )}
      </p>
    </div>
  );
}

function MapNode({
  n,
  selected,
  onActivate,
}: {
  n: Placed;
  selected: boolean;
  onActivate: () => void;
}) {
  const isRoot = !n.parent;
  const hasChildren = n.node.children.length > 0;
  return (
    <g
      transform={`translate(${n.x} ${n.y})`}
      role="treeitem"
      aria-label={n.node.label}
      aria-expanded={hasChildren ? !n.folded : undefined}
      aria-selected={selected}
      tabIndex={0}
      onClick={onActivate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onActivate();
        }
      }}
      className="cursor-pointer outline-none [&:focus-visible>rect]:stroke-accent"
    >
      <title>{n.node.label}</title>
      <rect
        x={-6}
        y={-12}
        width={n.width + 20 + (n.folded ? 28 : 0)}
        height={24}
        rx={4}
        fill={selected ? 'var(--accent-wash)' : 'transparent'}
        stroke="transparent"
        strokeWidth={2}
      />
      <circle
        r={isRoot ? 3.5 : 2.5}
        cx={0}
        cy={0}
        fill={hasChildren ? 'var(--accent)' : 'var(--ink-3)'}
      />
      <text x={9} y={4.5} fill="var(--ink)" style={{ font: isRoot ? ROOT_FONT : FONT }}>
        {n.label}
      </text>
      {n.folded && (
        <text
          x={n.width + 16}
          y={4.5}
          fill="var(--ink-3)"
          style={{ font: '11px "IBM Plex Mono", monospace' }}
        >
          +{n.node.children.length}
        </text>
      )}
    </g>
  );
}

/** A soft S-curve from the end of the parent's label to the child's dot. */
function edge(from: Placed, to: Placed) {
  const x1 = from.x + from.width + 16;
  const x2 = to.x - 6;
  const mid = (x1 + x2) / 2;
  return `M${x1},${from.y} C${mid},${from.y} ${mid},${to.y} ${x2},${to.y}`;
}

/** The view scaled by `factor` around the point (px, py), within the zoom limits. */
function zoomed(v: View, px: number, py: number, factor: number): View {
  const k = Math.min(2.5, Math.max(0.3, v.k * factor));
  const f = k / v.k;
  return { k, x: px - (px - v.x) * f, y: py - (py - v.y) * f };
}

function spread(points: Map<number, { x: number; y: number }>) {
  const [a, b] = [...points.values()];
  return Math.hypot(a!.x - b!.x, a!.y - b!.y);
}
