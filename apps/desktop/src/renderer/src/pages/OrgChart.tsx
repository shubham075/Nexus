import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { api } from '@/lib/api';
import { Spinner, UserLine } from '@/components/ui';
import { OrgGraph } from '@/components/OrgGraph';
import { useHierarchy } from '@/components/NodeSelect';

export function NodeDetails({ id }: { id: string }) {
  const { data: n } = useQuery({ queryKey: ['hierarchy', 'node', id], queryFn: () => api.get(`/hierarchy/nodes/${id}`) });
  if (!n) return <Spinner />;
  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs font-semibold uppercase text-zinc-500">{n.type.toLowerCase()}</div>
        <h2 className="text-xl font-semibold">{n.name}</h2>
        {n.description && <p className="text-sm text-zinc-600">{n.description}</p>}
        <div className="muted mt-1">{n.memberships.length} direct members · {n.descendantCount} sub-units</div>
      </div>
      <div>
        <div className="label">Reporting lines</div>
        {n.paths.map((p: any[], i: number) => (
          <div key={i} className="flex flex-wrap items-center gap-1 text-xs">
            {p.map((x, j) => <span key={x.id} className="flex items-center gap-1">{j > 0 && <ChevronRight size={12} />}<span className={j === p.length - 1 ? 'font-semibold' : ''}>{x.name}</span></span>)}
          </div>
        ))}
      </div>
      <div>
        <div className="label">Members</div>
        <div className="space-y-3">{n.memberships.map((m: any) => <UserLine key={m.userId} user={m.user} size={32} sub={m.title} />)}</div>
        {!n.memberships.length && <div className="muted">No direct members.</div>}
      </div>
    </div>
  );
}

export default function OrgChart() {
  const [params, setParams] = useSearchParams();
  const selected = params.get('node');
  const { data } = useHierarchy();
  if (!data) return <Spinner />;
  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)_340px]">
      <div className="h-full bg-white"><OrgGraph graph={data} selectedId={selected} onSelect={(id) => setParams({ node: id })} /></div>
      <aside className="h-full overflow-y-auto border-l border-zinc-200 bg-white p-4">
        {selected ? <NodeDetails id={selected} /> : <div className="muted">Select a unit to see its members and reporting lines.</div>}
      </aside>
    </div>
  );
}
