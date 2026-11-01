import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/base.css';
import type { GraphSymbol } from '@/api/types';
import { Button, Kbd, Tooltip, TooltipProvider } from '@/ui';
import { cn } from '@/lib/cn';
import { useBreakpoint } from '@/lib/breakpoints';
import { downloadText, fileSlug } from '@/lib/download';
import { prefersReducedMotion } from './hooks';
import {
  NODE_HEIGHT,
  NODE_WIDTH,
  layoutSize,
  type Layout,
  type LaidNode,
  type MoreMarker,
} from './layout';
import { mapSvg } from './mapSvg';
import { graphStrings as t, kindLabel } from './strings';

type SymbolNodeData = {
  symbol: GraphSymbol;
  role: LaidNode['role'];
  highlighted: boolean;
  selected: boolean;
};
type SymbolNode = Node<SymbolNodeData, 'symbol'>;
type MoreNode = Node<{ count: number; side: MoreMarker['side'] }, 'more'>;

/** "function, model.py, lines 42–61": what the hover card says about a symbol. */
function SymbolTip({ symbol }: { symbol: GraphSymbol }) {
  return (
    <span className="flex flex-col gap-0.5">
      <span>
        <span className="text-ink-3">{kindLabel(symbol.kind)}</span>{' '}
        <span className="font-mono [overflow-wrap:anywhere]">{symbol.name}</span>
      </span>
      <span className="text-ink-3">
        <span className="font-mono [overflow-wrap:anywhere]">{symbol.filePath}</span>,{' '}
        {t.lines(symbol.lineStart, symbol.lineEnd)}
      </span>
    </span>
  );
}

const SymbolNodeView = memo(function SymbolNodeView({ data }: NodeProps<SymbolNode>) {
  const { symbol, role, highlighted, selected } = data;
  return (
    <Tooltip content={<SymbolTip symbol={symbol} />} side="bottom">
      <div
        style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
        className={cn(
          'flex cursor-pointer flex-col justify-center rounded-sm border bg-paper px-2.5',
          role === 'center' || highlighted ? 'border-accent' : 'border-edge hover:border-ink-3',
          role === 'center' && 'bg-accent-wash',
          selected && 'outline-2 outline-offset-2 outline-accent',
        )}
      >
        {/* Edges need handles; they are invisible and nothing can be connected by hand. */}
        <Handle
          type="target"
          position={Position.Left}
          isConnectable={false}
          className="!size-px !min-h-0 !min-w-0 !border-0 !bg-transparent"
        />
        <div className="flex min-w-0 items-baseline gap-1.5 text-xs">
          <span className="shrink-0 text-ink-3">{kindLabel(symbol.kind)}</span>
          <span className="truncate font-mono text-ink">{symbol.name}</span>
        </div>
        <div className="truncate font-mono text-xs text-ink-3">
          {symbol.filePath}:{symbol.lineStart}
        </div>
        <Handle
          type="source"
          position={Position.Right}
          isConnectable={false}
          className="!size-px !min-h-0 !min-w-0 !border-0 !bg-transparent"
        />
      </div>
    </Tooltip>
  );
});

const MoreNodeView = memo(function MoreNodeView({ data }: NodeProps<MoreNode>) {
  return (
    <div
      style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
      className="flex cursor-pointer flex-col justify-center rounded-sm border border-dashed border-ink-3 bg-paper px-2.5 text-xs hover:border-accent"
    >
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        className="!size-px !min-h-0 !min-w-0 !border-0 !bg-transparent"
      />
      <span className="font-mono text-sm text-ink">
        {t.moreNode(data.count, data.side === 'caller')}
      </span>
      <span className="text-ink-3">{t.moreNodeHint}</span>
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        className="!size-px !min-h-0 !min-w-0 !border-0 !bg-transparent"
      />
    </div>
  );
});

const nodeTypes = { symbol: SymbolNodeView, more: MoreNodeView };

// Room above and below the nodes, and the least and most height the box takes.
const FRAME = 72;
const MIN_HEIGHT = 200;
const MAX_HEIGHT = 640;

// Below this zoom the labels stop being readable. A map that would need less is framed on the
// symbol and its nearest hop instead of being shrunk to fit.
const MIN_FIT_ZOOM = 0.55;
const FIT = { padding: 0.12, minZoom: MIN_FIT_ZOOM, maxZoom: 1.1 };

export type GraphCanvasProps = {
  layout: Layout;
  /** Node ids drawn in the accent color (a traced path). */
  highlight?: Set<string>;
  showMinimap: boolean;
  onOpen: (symbol: GraphSymbol) => void;
  onFocus?: (symbol: GraphSymbol) => void;
  /** Asked for by the "+N more" nodes; the caller shows the full list. */
  onMore?: () => void;
  label: string;
};

function Canvas({
  layout,
  highlight,
  showMinimap,
  onOpen,
  onFocus,
  onMore,
  label,
}: GraphCanvasProps) {
  const flow = useReactFlow();
  const phone = useBreakpoint() === 'phone';
  const duration = prefersReducedMotion() ? 0 : 160;
  const frame = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<string>();
  const selected = layout.nodes.find((n) => n.id === selectedId);
  const height = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, layoutSize(layout).height + FRAME));

  const nodes = useMemo<(SymbolNode | MoreNode)[]>(
    () => [
      ...layout.nodes.map((n): SymbolNode => ({
        id: n.id,
        type: 'symbol',
        position: { x: n.x, y: n.y },
        data: {
          symbol: n.symbol,
          role: n.role,
          highlighted: highlight?.has(n.id) ?? false,
          selected: n.id === selectedId,
        },
        draggable: false,
        connectable: false,
        ariaLabel: `${kindLabel(n.symbol.kind)} ${n.symbol.name}, ${n.symbol.filePath} line ${n.symbol.lineStart}`,
      })),
      ...(layout.more ?? []).map((m): MoreNode => ({
        id: m.id,
        type: 'more',
        position: { x: m.x, y: m.y },
        data: { count: m.count, side: m.side },
        draggable: false,
        connectable: false,
        ariaRole: 'button',
        ariaLabel: `${t.moreNode(m.count, m.side === 'caller')}. ${t.moreNodeHint}`,
      })),
    ],
    [layout, highlight, selectedId],
  );

  const edges = useMemo<Edge[]>(
    () =>
      layout.edges.map((e) => {
        const lit = highlight?.has(e.source) && highlight.has(e.target);
        const color = lit ? 'var(--accent)' : 'var(--edge)';
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          focusable: false,
          // The arrow ends at the symbol that is called.
          markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
          style: {
            stroke: color,
            strokeWidth: lit ? 1.5 : 1,
            strokeDasharray: e.muted ? '4 4' : undefined,
          },
        };
      }),
    [layout, highlight],
  );

  const fit = useCallback(() => {
    const width = frame.current?.clientWidth ?? 0;
    const size = layoutSize(layout);
    const pad = 1 + FIT.padding * 2;
    const whole = Math.min(width / (size.width * pad), height / (size.height * pad));
    // Too wide to read all at once: frame the symbol and what touches it, the rest is a pan away.
    const near =
      width > 0 && whole < MIN_FIT_ZOOM
        ? [
            ...layout.nodes.filter((n) => n.depth <= 1).map((n) => ({ id: n.id })),
            ...(layout.more ?? []).map((m) => ({ id: m.id })),
          ]
        : undefined;
    void flow.fitView({ ...FIT, duration, nodes: near });
  }, [flow, layout, height, duration]);

  // A new neighbourhood re-frames itself; panning within one stays where the user left it.
  useEffect(() => {
    const id = requestAnimationFrame(fit);
    return () => cancelAnimationFrame(id);
  }, [fit]);

  // Enter and Space on a focused node only select it; the keys for what to do next are here
  // and in the bar above, so nothing depends on a double click.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const node = (e.target as HTMLElement).closest<HTMLElement>('.react-flow__node');
    const id = node?.dataset.id;
    if (e.key === 'Enter' || e.key === ' ') {
      if (!id) return;
      e.preventDefault();
      if (id.startsWith('more:')) onMore?.();
      else setSelectedId(id);
      return;
    }
    if (!selected || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'o') onOpen(selected.symbol);
    else if (e.key === 'c' && onFocus && selected.role !== 'center') onFocus(selected.symbol);
  };

  return (
    <div className="flex flex-col gap-2">
      <div aria-live="polite" className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-1">
        {selected ? (
          <>
            <p className="min-w-0 truncate text-sm text-ink">
              <span className="font-mono">{selected.symbol.name}</span>
              <span className="text-ink-3">
                {' '}
                · {selected.symbol.filePath}:{selected.symbol.lineStart}
              </span>
            </p>
            <div className="flex items-center gap-1">
              <Button size="sm" onClick={() => onOpen(selected.symbol)}>
                {t.openInViewer}
              </Button>
              {onFocus && selected.role !== 'center' && (
                <Button size="sm" onClick={() => onFocus(selected.symbol)}>
                  {t.center}
                </Button>
              )}
            </div>
            {!phone && (
              <p className="text-xs text-ink-3">
                <Kbd>O</Kbd> opens, <Kbd>C</Kbd> centers
              </p>
            )}
          </>
        ) : (
          <p className="text-xs text-ink-3">{phone ? t.selectHint : t.selectHintKeys}</p>
        )}
      </div>
      {/* Keys bubble up from the focused node or the canvas; the wrapper only listens. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div
        ref={frame}
        role="group"
        aria-label={label}
        style={{ height }}
        onKeyDown={onKeyDown}
        className="relative overflow-hidden rounded-md border border-edge bg-paper"
      >
        <ReactFlow
          aria-label={label}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          zoomOnDoubleClick={false}
          minZoom={0.4}
          maxZoom={1.6}
          proOptions={{ hideAttribution: true }}
          fitViewOptions={FIT}
          onNodeClick={(_, node) => {
            if (node.type === 'more') onMore?.();
            else setSelectedId(node.id);
          }}
          onNodeDoubleClick={(_, node) => {
            if (node.type === 'symbol') onFocus?.(node.data.symbol);
          }}
          onPaneClick={() => setSelectedId(undefined)}
          onNodesChange={() => {}}
          fitView
          className="text-ink [&_.react-flow__node:focus-visible]:outline-2 [&_.react-flow__node:focus-visible]:outline-offset-2 [&_.react-flow__node:focus-visible]:outline-accent"
        >
          <Panel position="top-right" className="flex gap-1">
            <Button
              size="sm"
              className="bg-paper"
              onClick={() =>
                downloadText(
                  `${fileSlug(label, 'code-graph')}.svg`,
                  mapSvg(layout, label, highlight),
                  'image/svg+xml;charset=utf-8',
                )
              }
            >
              {t.exportSvg}
            </Button>
            <Button size="sm" className="bg-paper" onClick={fit}>
              {t.fitView}
            </Button>
          </Panel>
          {showMinimap && (
            <MiniMap
              pannable
              zoomable
              ariaLabel="Overview"
              nodeColor="var(--edge)"
              nodeStrokeColor="var(--ink-3)"
              maskColor="color-mix(in srgb, var(--paper-3) 70%, transparent)"
              className="!m-3 overflow-hidden rounded-sm border border-edge !bg-paper"
            />
          )}
        </ReactFlow>
      </div>
    </div>
  );
}

/** The graph canvas. Its own chunk: React Flow loads only when a map is opened on a big screen. */
export default function GraphCanvas(props: GraphCanvasProps) {
  return (
    <ReactFlowProvider>
      <TooltipProvider>
        <Canvas {...props} />
      </TooltipProvider>
    </ReactFlowProvider>
  );
}
