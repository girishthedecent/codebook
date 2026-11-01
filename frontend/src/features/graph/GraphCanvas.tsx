import { memo, useEffect, useMemo, useState, type KeyboardEvent } from 'react';
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
import { Button, Kbd } from '@/ui';
import { cn } from '@/lib/cn';
import { useBreakpoint } from '@/lib/breakpoints';
import { prefersReducedMotion } from './hooks';
import { NODE_HEIGHT, NODE_WIDTH, layoutSize, type Layout, type LaidNode } from './layout';
import { graphStrings as t, kindLabel } from './strings';

type SymbolNodeData = {
  symbol: GraphSymbol;
  role: LaidNode['role'];
  highlighted: boolean;
  selected: boolean;
};
type SymbolNode = Node<SymbolNodeData, 'symbol'>;

const SymbolNodeView = memo(function SymbolNodeView({ data }: NodeProps<SymbolNode>) {
  const { symbol, role, highlighted, selected } = data;
  return (
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
  );
});

const nodeTypes = { symbol: SymbolNodeView };

// Room above and below the nodes, and the least and most height the box takes.
const FRAME = 72;
const MIN_HEIGHT = 200;
const MAX_HEIGHT = 640;

export type GraphCanvasProps = {
  layout: Layout;
  /** Node ids drawn in the accent color (a traced path). */
  highlight?: Set<string>;
  showMinimap: boolean;
  onOpen: (symbol: GraphSymbol) => void;
  onFocus?: (symbol: GraphSymbol) => void;
  label: string;
};

function Canvas({ layout, highlight, showMinimap, onOpen, onFocus, label }: GraphCanvasProps) {
  const flow = useReactFlow();
  const phone = useBreakpoint() === 'phone';
  const duration = prefersReducedMotion() ? 0 : 160;
  const [selectedId, setSelectedId] = useState<string>();
  const selected = layout.nodes.find((n) => n.id === selectedId);
  const height = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, layoutSize(layout).height + FRAME));

  const nodes = useMemo<SymbolNode[]>(
    () =>
      layout.nodes.map((n) => ({
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
          style: { stroke: color, strokeWidth: lit ? 1.5 : 1 },
        };
      }),
    [layout, highlight],
  );

  // A new neighbourhood re-frames itself; panning within one stays where the user left it.
  useEffect(() => {
    const id = requestAnimationFrame(
      () => void flow.fitView({ padding: 0.12, duration, minZoom: 0.55, maxZoom: 1.1 }),
    );
    return () => cancelAnimationFrame(id);
  }, [layout, flow, duration]);

  // Enter and Space on a focused node only select it; the keys for what to do next are here
  // and in the bar above, so nothing depends on a double click.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const node = (e.target as HTMLElement).closest<HTMLElement>('.react-flow__node');
    const id = node?.dataset.id;
    if (e.key === 'Enter' || e.key === ' ') {
      if (!id) return;
      e.preventDefault();
      setSelectedId(id);
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
          minZoom={0.2}
          maxZoom={1.6}
          proOptions={{ hideAttribution: true }}
          onNodeClick={(_, node) => setSelectedId(node.id)}
          onNodeDoubleClick={(_, node) => onFocus?.(node.data.symbol)}
          onPaneClick={() => setSelectedId(undefined)}
          onNodesChange={() => {}}
          fitView
          className="text-ink [&_.react-flow__node:focus-visible]:outline-2 [&_.react-flow__node:focus-visible]:outline-offset-2 [&_.react-flow__node:focus-visible]:outline-accent"
        >
          <Panel position="top-right">
            <Button
              size="sm"
              className="bg-paper"
              onClick={() =>
                void flow.fitView({ padding: 0.12, duration, minZoom: 0.55, maxZoom: 1.1 })
              }
            >
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
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
