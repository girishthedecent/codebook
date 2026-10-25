import { memo, useEffect, useMemo } from 'react';
import {
  Handle,
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
import { cn } from '@/lib/cn';
import { prefersReducedMotion } from './hooks';
import { NODE_HEIGHT, NODE_WIDTH, type Layout, type LaidNode } from './layout';
import { graphStrings as t, kindLabel } from './strings';

type SymbolNodeData = { symbol: GraphSymbol; role: LaidNode['role']; highlighted: boolean };
type SymbolNode = Node<SymbolNodeData, 'symbol'>;

const SymbolNodeView = memo(function SymbolNodeView({ data, selected }: NodeProps<SymbolNode>) {
  const { symbol, role, highlighted } = data;
  return (
    <div
      style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
      className={cn(
        'flex cursor-pointer flex-col justify-center rounded-sm border bg-paper px-2.5',
        role === 'center' || highlighted ? 'border-accent' : 'border-rule-2 hover:border-ink-3',
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
      <div className="flex min-w-0 items-baseline gap-1.5 font-mono text-xs">
        <span className="shrink-0 text-ink-3">
          {kindLabel[symbol.kind] ?? symbol.kind.toLowerCase()}
        </span>
        <span className="truncate text-ink">{symbol.name}</span>
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
  const duration = prefersReducedMotion() ? 0 : 160;

  const nodes = useMemo<SymbolNode[]>(
    () =>
      layout.nodes.map((n) => ({
        id: n.id,
        type: 'symbol',
        position: { x: n.x, y: n.y },
        data: { symbol: n.symbol, role: n.role, highlighted: highlight?.has(n.id) ?? false },
        draggable: false,
        connectable: false,
        ariaLabel: `${kindLabel[n.symbol.kind] ?? n.symbol.kind} ${n.symbol.name}, ${n.symbol.filePath} line ${n.symbol.lineStart}`,
      })),
    [layout, highlight],
  );

  const edges = useMemo<Edge[]>(
    () =>
      layout.edges.map((e) => {
        const lit = highlight?.has(e.source) && highlight.has(e.target);
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          focusable: false,
          style: { stroke: lit ? 'var(--accent)' : 'var(--rule-2)', strokeWidth: lit ? 1.5 : 1 },
        };
      }),
    [layout, highlight],
  );

  // A new neighbourhood re-frames itself; panning within one stays where the user left it.
  useEffect(() => {
    const id = requestAnimationFrame(
      () => void flow.fitView({ padding: 0.15, duration, maxZoom: 1.1 }),
    );
    return () => cancelAnimationFrame(id);
  }, [layout, flow, duration]);

  return (
    <ReactFlow
      aria-label={label}
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable
      zoomOnDoubleClick={false}
      minZoom={0.2}
      maxZoom={1.6}
      proOptions={{ hideAttribution: true }}
      onNodeClick={(_, node) => onOpen(node.data.symbol)}
      onNodeDoubleClick={(_, node) => onFocus?.(node.data.symbol)}
      onNodesChange={() => {}}
      fitView
      className="text-ink"
    >
      <Panel position="top-right">
        <button
          type="button"
          onClick={() => void flow.fitView({ padding: 0.15, duration, maxZoom: 1.1 })}
          className="h-7 rounded-sm border border-rule-2 bg-paper px-2.5 text-xs text-ink-2 transition-colors duration-150 hover:bg-paper-2 hover:text-ink"
        >
          {t.fitView}
        </button>
      </Panel>
      {showMinimap && (
        <MiniMap
          pannable
          zoomable
          ariaLabel="Overview"
          nodeColor="var(--paper-3)"
          nodeStrokeColor="var(--rule-2)"
          maskColor="rgb(0 0 0 / 0.04)"
          className="!m-3 overflow-hidden rounded-sm border border-rule !bg-paper"
        />
      )}
    </ReactFlow>
  );
}

/** The graph canvas. Its own chunk: React Flow loads only when the graph is opened on a big screen. */
export default function GraphCanvas(props: GraphCanvasProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
