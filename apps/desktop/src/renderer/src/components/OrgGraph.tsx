import { useMemo } from 'react';
import { Background, BackgroundVariant, Controls, Handle, MarkerType, Position, ReactFlow, type Connection, type Edge, type Node, type NodeProps } from '@xyflow/react';
import dagre from '@dagrejs/dagre';
import '@xyflow/react/dist/style.css';
import type { OrgGraph as Graph } from './NodeSelect';

// Neutral cards; the unit type is a small coloured dot so the graph stays calm in both themes.
const TYPE_DOT: Record<string, string> = {
  COMPANY: 'bg-zinc-900',
  DIVISION: 'bg-sky-500',
  DEPARTMENT: 'bg-emerald-500',
  TEAM: 'bg-amber-500',
  GUILD: 'bg-violet-500',
  LOCATION: 'bg-rose-500',
  CUSTOM: 'bg-zinc-400',
};

const W = 200;
const H = 64;

type OrgNodeData = { name: string; type: string; memberCount: number; selected: boolean };

function OrgNodeView({ data }: NodeProps<Node<OrgNodeData>>) {
  return (
    <div className={`rounded-xl border bg-surface px-3 py-2 shadow-soft transition ${data.selected ? 'border-zinc-900 ring-4 ring-zinc-900/10' : 'border-zinc-200 hover:border-zinc-400'}`} style={{ width: W }}>
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !border-surface !bg-zinc-400" />
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${TYPE_DOT[data.type] ?? TYPE_DOT.CUSTOM}`} />
        <div className="truncate text-sm font-medium text-zinc-900">{data.name}</div>
      </div>
      <div className="pl-4 text-[11px] text-zinc-500">{data.type.toLowerCase()} · {data.memberCount} member{data.memberCount === 1 ? '' : 's'}</div>
      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !border-surface !bg-zinc-400" />
    </div>
  );
}

const nodeTypes = { org: OrgNodeView };

/** Top-down dagre layout of the hierarchy DAG; multi-parent nodes get several incoming edges. */
export function OrgGraph({
  graph,
  selectedId,
  onSelect,
  editable,
  onConnect,
  onEdgeClick,
}: {
  graph: Graph;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  editable?: boolean;
  onConnect?: (parentId: string, childId: string) => void;
  onEdgeClick?: (parentId: string, childId: string) => void;
}) {
  const { nodes, edges } = useMemo(() => {
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: 'TB', nodesep: 40, ranksep: 70 });
    g.setDefaultEdgeLabel(() => ({}));
    graph.nodes.forEach((n) => g.setNode(n.id, { width: W, height: H }));
    graph.edges.forEach((e) => g.setEdge(e.parentId, e.childId));
    dagre.layout(g);
    const nodes: Node<OrgNodeData>[] = graph.nodes.map((n) => {
      const p = g.node(n.id);
      return { id: n.id, type: 'org', position: { x: p.x - W / 2, y: p.y - H / 2 }, data: { name: n.name, type: n.type, memberCount: n.memberCount, selected: n.id === selectedId } };
    });
    const edges: Edge[] = graph.edges.map((e) => ({
      id: `${e.parentId}->${e.childId}`,
      source: e.parentId,
      target: e.childId,
      type: 'smoothstep',
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { strokeWidth: 1.5 },
      data: e,
    }));
    return { nodes, edges };
  }, [graph, selectedId]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.08, maxZoom: 1.25 }}
      minZoom={0.2}
      nodesDraggable={false}
      nodesConnectable={!!editable}
      onNodeClick={(_, n) => onSelect?.(n.id)}
      onConnect={(c: Connection) => c.source && c.target && onConnect?.(c.source, c.target)}
      onEdgeClick={(_, e) => onEdgeClick?.(e.source, e.target)}
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
