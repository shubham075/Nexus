import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface OrgGraph {
  nodes: { id: string; name: string; type: string; description: string | null; isRoot: boolean; memberCount: number }[];
  edges: { parentId: string; childId: string }[];
}

export const useHierarchy = () => useQuery({ queryKey: ['hierarchy'], queryFn: () => api.get<OrgGraph>('/hierarchy') });

export function NodeSelect({ value, onChange, placeholder = 'Any unit', allowEmpty = true }: { value: string | null | undefined; onChange: (v: string | null) => void; placeholder?: string; allowEmpty?: boolean }) {
  const { data } = useHierarchy();
  return (
    <select className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      {allowEmpty && <option value="">{placeholder}</option>}
      {(data?.nodes ?? []).map((n) => (
        <option key={n.id} value={n.id}>{n.name} · {n.type.toLowerCase()}</option>
      ))}
    </select>
  );
}

export function NodeMultiSelect({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const { data } = useHierarchy();
  return (
    <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-zinc-300 p-2">
      {(data?.nodes ?? []).map((n) => (
        <label key={n.id} className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="accent-zinc-900" checked={value.includes(n.id)} onChange={(e) => onChange(e.target.checked ? [...value, n.id] : value.filter((x) => x !== n.id))} />
          {n.name} <span className="text-xs text-zinc-500">{n.type.toLowerCase()}</span>
        </label>
      ))}
    </div>
  );
}
