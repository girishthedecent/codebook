import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { CaretRight, DotsThree } from '@phosphor-icons/react';
import type { Citation } from '@/api/types';
import { Button, TabPanel, Tabs } from '@/ui';
import { cn } from '@/lib/cn';
import { useBreakpoint } from '@/lib/breakpoints';
import { Cites } from './Cites';
import { citationsOf, type MindmapData, type MindmapNode } from './data';
import { s } from './strings';
import { edge, FONT, layout, PAD, ROOT_FONT, ROW, type Placed } from './mapLayout';
import { NodeMenu } from './NodeMenu';
import { treeKey, type TreeEntry, type TreeMove } from './treeNav';

type Props = {
  map: MindmapData;
  index: Map<number, Citation>;
  workspaceId: string;
  /** The set's title, for asking about a topic that cites nothing. */
  title: string;
};

/**
 * A folding tree: an SVG map on wide screens (with an outline tab), an outline on phones. Each
 * topic has a menu (its button, or the context-menu key or Shift+F10 on a focused topic) to ask
 * about it or open what it cites.
 */
export function MindMap({ map, index, workspaceId, title }: Props) {
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

  const tree = { root: map.root, folded, toggle, index, workspaceId, title };

  if (phone) return <Outline {...tree} />;

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
        <MapCanvas {...tree} />
      </TabPanel>
      <TabPanel value="outline" className="pt-4">
        <Outline {...tree} />
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

type TreeProps = {
  root: MindmapNode;
  folded: Set<string>;
  toggle: (id: string) => void;
  index: Map<number, Citation>;
  workspaceId: string;
  title: string;
};

/** The menu key, or Shift+F10 where there is none, as on any desktop. */
const isMenuKey = (e: KeyboardEvent) => e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10');

/** The visible nodes in reading order, with the facts the keyboard handler needs. */
function visibleEntries(root: MindmapNode, folded: Set<string>): TreeEntry[] {
  const list: TreeEntry[] = [];
  const walk = (node: MindmapNode, depth: number, parent?: string) => {
    const expandable = node.children.length > 0;
    const open = expandable && !folded.has(node.id);
    list.push({ id: node.id, depth, parent, expandable, open });
    if (open) for (const child of node.children) walk(child, depth + 1, node.id);
  };
  walk(root, 0);
  return list;
}

function Outline(props: TreeProps) {
  const { root, folded, toggle } = props;
  const entries = useMemo(() => visibleEntries(root, folded), [root, folded]);
  // Only one row is a tab stop; the arrow keys move it.
  const [stop, setStop] = useState(root.id);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const items = useRef(new Map<string, HTMLElement>());
  const tab = entries.some((e) => e.id === stop) ? stop : root.id;

  const onKeyDown = (e: KeyboardEvent<HTMLElement>, id: string) => {
    if (e.target !== e.currentTarget || e.metaKey || e.ctrlKey || e.altKey) return;
    if (isMenuKey(e)) {
      e.preventDefault();
      setMenuFor(id);
      return;
    }
    const move = treeKey(e.key, id, entries, 'list');
    if (!move) return;
    e.preventDefault();
    if (move.toggle) toggle(move.toggle);
    if (move.focus) items.current.get(move.focus)?.focus();
  };

  return (
    <ul role="tree" aria-label={root.label} className="text-sm">
      <OutlineItem
        {...props}
        node={root}
        depth={0}
        trail={[root.label]}
        tab={tab}
        menuFor={menuFor}
        onMenu={setMenuFor}
        onStop={setStop}
        onKeyDown={onKeyDown}
        register={(id, el) => {
          if (el) items.current.set(id, el);
          else items.current.delete(id);
        }}
      />
    </ul>
  );
}

type ItemProps = {
  tab: string;
  /** The topic whose menu is open, if any. */
  menuFor: string | null;
  onMenu: (id: string | null) => void;
  onStop: (id: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLElement>, id: string) => void;
  register: (id: string, el: HTMLElement | null) => void;
};

function OutlineItem(
  props: { node: MindmapNode; depth: number; trail: string[] } & Omit<TreeProps, 'root'> &
    ItemProps,
) {
  const { node, depth, trail, folded, toggle, index, tab, menuFor, onMenu, onStop, onKeyDown } =
    props;
  const { register, workspaceId, title } = props;
  const hasChildren = node.children.length > 0;
  const open = hasChildren && !folded.has(node.id);
  return (
    <li
      role="treeitem"
      ref={(el) => register(node.id, el)}
      tabIndex={tab === node.id ? 0 : -1}
      aria-selected={tab === node.id}
      aria-expanded={hasChildren ? open : undefined}
      aria-level={depth + 1}
      onFocus={(e) => {
        if (e.target === e.currentTarget) onStop(node.id);
      }}
      onKeyDown={(e) => onKeyDown(e, node.id)}
      className="outline-none [&:focus-visible>div:first-child]:bg-accent-wash"
    >
      <div
        className={cn(
          'flex min-h-10 items-start gap-1 border-b border-rule',
          depth === 0 && 'font-semibold',
        )}
      >
        {hasChildren ? (
          <button
            type="button"
            tabIndex={-1}
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
          {node.label} <Cites citations={citationsOf(node, index)} uncited={node.uncited} />
          {hasChildren && !open && (
            <span className="ml-1 font-mono text-xs text-ink-3">+{node.children.length}</span>
          )}
        </span>
        <NodeMenu
          node={node}
          trail={trail}
          index={index}
          workspaceId={workspaceId}
          title={title}
          open={menuFor === node.id}
          onOpenChange={(next) => onMenu(next ? node.id : null)}
          trigger={
            <button
              type="button"
              // The row is the tab stop; the menu key opens this from the keyboard.
              tabIndex={-1}
              aria-label={s.map.actionsFor(node.label)}
              className="ml-auto flex size-10 shrink-0 items-center justify-center rounded-xs text-ink-3 hover:bg-paper-2 hover:text-ink max-sm:size-11"
            >
              <DotsThree size={16} weight="bold" aria-hidden />
            </button>
          }
        />
      </div>
      {open && (
        <ul role="group" className="pl-5">
          {node.children.map((child) => (
            <OutlineItem
              {...props}
              key={child.id}
              node={child}
              depth={depth + 1}
              trail={[...trail, child.label]}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

type View = { x: number; y: number; k: number };

function MapCanvas({ root, folded, toggle, index, workspaceId, title }: TreeProps) {
  const nodes = useMemo(() => layout(root, folded), [root, folded]);
  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: PAD, y: PAD, k: 1 });
  const [selected, setSelected] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  // Only one node is a tab stop; the arrow keys move it.
  const [stop, setStop] = useState(root.id);
  const items = useRef(new Map<string, SVGGElement>());
  const entries = useMemo<TreeEntry[]>(
    () =>
      nodes.map((n) => ({
        id: n.node.id,
        depth: n.depth,
        parent: n.parent?.node.id,
        expandable: n.node.children.length > 0,
        open: n.node.children.length > 0 && !n.folded,
      })),
    [nodes],
  );
  const tab = entries.some((e) => e.id === stop) ? stop : root.id;

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

  // Ctrl or ⌘ with the wheel zooms around the cursor (a pinch on a trackpad arrives the same
  // way); a plain wheel scrolls the page. Registered by hand so it can cancel the page scroll.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
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
      e.currentTarget.setPointerCapture?.(e.pointerId);
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

  // Pans just enough to bring a node the keyboard reached into view.
  const reveal = (n: Placed) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect) return;
    const edge = 40;
    setView((v) => {
      const left = v.x + n.x * v.k;
      const right = left + (n.width + 30) * v.k;
      const y = v.y + n.y * v.k;
      let dx = 0;
      let dy = 0;
      if (left < edge) dx = edge - left;
      else if (right > rect.width - edge) dx = Math.max(rect.width - edge - right, edge - left);
      if (y < edge) dy = edge - y;
      else if (y > rect.height - edge) dy = rect.height - edge - y;
      return dx || dy ? { ...v, x: v.x + dx, y: v.y + dy } : v;
    });
  };

  const onKeyDown = (e: KeyboardEvent<SVGGElement>, n: Placed) => {
    if (e.target !== e.currentTarget || e.metaKey || e.ctrlKey || e.altKey) return;
    if (isMenuKey(e)) {
      e.preventDefault();
      setSelected(n.node.id);
      setMenuOpen(true);
      return;
    }
    const move: TreeMove | undefined = treeKey(e.key, n.node.id, entries, 'columns');
    if (!move) return;
    e.preventDefault();
    if (move.toggle) toggle(move.toggle);
    const to = move.focus && nodes.find((m) => m.node.id === move.focus);
    if (to) {
      items.current.get(to.node.id)?.focus({ preventScroll: true });
      reveal(to);
    }
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
        className="relative h-[min(70vh,640px)] min-h-[360px] cursor-grab touch-none overflow-hidden rounded-md border border-edge bg-paper active:cursor-grabbing"
      >
        <svg
          width="100%"
          height="100%"
          role="tree"
          aria-label={root.label}
          className="block select-none"
        >
          <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            <g aria-hidden>
              {nodes.map((n) =>
                n.parent ? (
                  <path
                    key={`edge-${n.node.id}`}
                    d={edge(n.parent, n)}
                    fill="none"
                    stroke="var(--edge)"
                    strokeWidth={1 / view.k}
                  />
                ) : null,
              )}
            </g>
            <MapNode
              n={nodes[0]!}
              selected={selected}
              tab={tab}
              register={(id, el) => {
                if (el) items.current.set(id, el);
                else items.current.delete(id);
              }}
              onFocusNode={(n) => {
                setStop(n.node.id);
                setSelected(n.node.id);
              }}
              onKeyDown={onKeyDown}
              onActivate={(n) => {
                if (moved.current <= 4) activate(n);
              }}
            />
          </g>
        </svg>
        <div className="absolute right-2 bottom-2 flex gap-1 rounded-sm border border-rule bg-paper p-0.5">
          <Button
            size="sm"
            variant="ghost"
            className="w-9 px-0 max-sm:w-11"
            aria-label={s.map.zoomOut}
            onClick={() => zoomCenter(0.8)}
          >
            −
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="w-9 px-0 max-sm:w-11"
            aria-label={s.map.zoomIn}
            onClick={() => zoomCenter(1.25)}
          >
            +
          </Button>
          <Button size="sm" variant="ghost" onClick={fitView}>
            {s.map.fit}
          </Button>
        </div>
      </div>
      <div className="mt-2 flex min-h-10 items-start justify-between gap-3 text-xs text-ink-3">
        {current ? (
          <>
            <p className="pt-2.5">
              <span className="text-ink-2">{current.node.label}</span>{' '}
              <Cites citations={cites} uncited={current.node.uncited} />
            </p>
            <NodeMenu
              node={current.node}
              trail={trailOf(current)}
              index={index}
              workspaceId={workspaceId}
              title={title}
              open={menuOpen}
              onOpenChange={setMenuOpen}
              trigger={
                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-1.5 shrink-0"
                  aria-label={s.map.actionsFor(current.node.label)}
                >
                  <DotsThree size={16} weight="bold" aria-hidden />
                </Button>
              }
            />
          </>
        ) : (
          <p className="pt-2.5">{s.map.hint}</p>
        )}
      </div>
    </div>
  );
}

type MapNodeProps = {
  n: Placed;
  selected: string | null;
  tab: string;
  register: (id: string, el: SVGGElement | null) => void;
  onFocusNode: (n: Placed) => void;
  onKeyDown: (e: KeyboardEvent<SVGGElement>, n: Placed) => void;
  onActivate: (n: Placed) => void;
};

/** A topic and, nested inside it, the group of its visible children. */
function MapNode(props: MapNodeProps) {
  const { n, selected, tab, register, onFocusNode, onKeyDown, onActivate } = props;
  const isRoot = !n.parent;
  const hasChildren = n.node.children.length > 0;
  const isSelected = n.node.id === selected;
  return (
    <g
      ref={(el) => register(n.node.id, el)}
      role="treeitem"
      aria-label={n.node.label}
      aria-level={n.depth + 1}
      aria-expanded={hasChildren ? !n.folded : undefined}
      aria-selected={isSelected}
      tabIndex={tab === n.node.id ? 0 : -1}
      onFocus={(e) => {
        if (e.target === e.currentTarget) onFocusNode(n);
      }}
      onKeyDown={(e) => onKeyDown(e, n)}
      className="outline-none [&:focus-visible>g:first-child>rect]:stroke-accent"
    >
      <g
        transform={`translate(${n.x} ${n.y})`}
        onClick={() => onActivate(n)}
        className="cursor-pointer"
      >
        <title>{n.node.label}</title>
        <rect
          x={-6}
          y={-12}
          width={n.width + 20 + (n.folded ? 28 : 0)}
          height={24}
          rx={4}
          fill={isSelected ? 'var(--accent-wash)' : 'transparent'}
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
          <text x={n.width + 16} y={4.5} fill="var(--ink-3)" style={{ font: FONT }}>
            +{n.node.children.length}
          </text>
        )}
      </g>
      {n.kids.length > 0 && (
        <g role="group">
          {n.kids.map((kid) => (
            <MapNode key={kid.node.id} {...props} n={kid} />
          ))}
        </g>
      )}
    </g>
  );
}

function trailOf(n: Placed): string[] {
  const labels: string[] = [];
  for (let at: Placed | undefined = n; at; at = at.parent) labels.unshift(at.node.label);
  return labels;
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
