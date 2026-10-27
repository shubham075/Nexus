import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Plus, Trash2, X } from 'lucide-react';
import { ORG_NODE_TYPES } from '@nexus/shared';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { ErrorText, Modal, Spinner, Tabs, UserLine } from '@/components/ui';
import { OrgGraph } from '@/components/OrgGraph';
import { useHierarchy } from '@/components/NodeSelect';

function NodeForm({ parentId, initial, onClose }: { parentId?: string; initial?: any; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: initial?.name ?? '', type: initial?.type ?? 'TEAM', description: initial?.description ?? '' });
  const save = useMutation({
    mutationFn: () => (initial ? api.patch(`/hierarchy/nodes/${initial.id}`, f) : api.post('/hierarchy/nodes', { ...f, parentIds: [parentId] })),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['hierarchy'] }); onClose(); },
  });
  return (
    <Modal title={initial ? 'Edit unit' : 'Add sub-unit'} onClose={onClose} footer={<button className="btn-primary" disabled={!f.name.trim()} onClick={() => save.mutate()}>Save</button>}>
      <div className="space-y-3">
        <div><label className="label">Name *</label><input className="input" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div>
          <label className="label">Type</label>
          <select className="input" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
            {ORG_NODE_TYPES.filter((t) => t !== 'COMPANY' || initial?.type === 'COMPANY').map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div><label className="label">Description</label><textarea className="input" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
        <ErrorText error={save.error} />
      </div>
    </Modal>
  );
}

function AddMembers({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<any[]>([]);
  const [title, setTitle] = useState('');
  const { data = [] } = useQuery({ queryKey: ['users', 'search', q], queryFn: () => api.get<any[]>(`/users?q=${encodeURIComponent(q)}`) });
  const save = useMutation({
    mutationFn: () => api.post(`/hierarchy/nodes/${nodeId}/members`, { userIds: picked.map((p) => p.id), title: title || null }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['hierarchy'] }); onClose(); },
  });
  return (
    <Modal title="Add members" onClose={onClose} footer={<button className="btn-primary" disabled={!picked.length} onClick={() => save.mutate()}>Add {picked.length || ''}</button>}>
      <div className="mb-2 flex flex-wrap gap-1">{picked.map((p) => <button key={p.id} className="chip chip-active" onClick={() => setPicked(picked.filter((x) => x.id !== p.id))}>{p.name} ✕</button>)}</div>
      <input className="input" placeholder="Search employees" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="mt-2 max-h-56 space-y-2 overflow-y-auto">
        {data.filter((u) => !picked.some((p) => p.id === u.id)).map((u) => (
          <button key={u.id} className="w-full rounded px-1 py-1 text-left hover:bg-zinc-100" onClick={() => setPicked([...picked, u])}><UserLine user={u} size={32} /></button>
        ))}
      </div>
      <label className="label mt-3">Title in this unit (optional)</label>
      <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
      <ErrorText error={save.error} />
    </Modal>
  );
}

function GrantRole({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const roles = useQuery({ queryKey: ['admin', 'roles'], queryFn: () => api.get<any[]>('/admin/roles') });
  const [roleId, setRoleId] = useState('');
  const [scope, setScope] = useState<'node' | 'user'>('node');
  const [q, setQ] = useState('');
  const [user, setUser] = useState<any>(null);
  const { data: users = [] } = useQuery({ queryKey: ['users', 'search', q], queryFn: () => api.get<any[]>(`/users?q=${encodeURIComponent(q)}`), enabled: scope === 'user' });
  const save = useMutation({
    mutationFn: () => api.post('/admin/grants', { roleId, nodeId, userId: scope === 'user' ? user?.id : null }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['hierarchy'] }); onClose(); },
  });
  return (
    <Modal title="Grant a role on this unit" onClose={onClose} footer={<button className="btn-primary" disabled={!roleId || (scope === 'user' && !user)} onClick={() => save.mutate()}>Grant</button>}>
      <div className="space-y-3">
        <div>
          <label className="label">Role</label>
          <select className="input" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            <option value="">Select a role…</option>
            {(roles.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
        <div className="space-y-2 text-sm">
          <label className="flex items-start gap-2"><input type="radio" checked={scope === 'node'} onChange={() => setScope('node')} className="mt-1" /><span><b>Everyone in this unit</b> — all members of this unit and every unit below it inherit the role.</span></label>
          <label className="flex items-start gap-2"><input type="radio" checked={scope === 'user'} onChange={() => setScope('user')} className="mt-1" /><span><b>A specific person</b> — they get the role scoped to this unit and everything below it.</span></label>
        </div>
        {scope === 'user' && (
          user ? <div className="flex items-center justify-between rounded border p-2"><UserLine user={user} size={32} /><button onClick={() => setUser(null)}><X size={16} /></button></div> : (
            <>
              <input className="input" placeholder="Search employee" value={q} onChange={(e) => setQ(e.target.value)} />
              <div className="max-h-40 space-y-1 overflow-y-auto">{users.map((u) => <button key={u.id} className="w-full rounded px-1 py-1 text-left hover:bg-zinc-100" onClick={() => setUser(u)}><UserLine user={u} size={28} /></button>)}</div>
            </>
          )
        )}
        <ErrorText error={save.error} />
      </div>
    </Modal>
  );
}

function NodePanel({ id, graph, onDeleted }: { id: string; graph: any; onDeleted: () => void }) {
  const qc = useQueryClient();
  const canHierarchy = useCan('hierarchy.manage');
  const canUsers = useCan('users.manage');
  const canRoles = useCan('roles.manage');
  const [tab, setTab] = useState<'members' | 'roles' | 'structure'>('members');
  const [modal, setModal] = useState<null | 'child' | 'edit' | 'members' | 'grant'>(null);
  const [newParent, setNewParent] = useState('');
  const { data: n } = useQuery({ queryKey: ['hierarchy', 'node', id], queryFn: () => api.get(`/hierarchy/nodes/${id}`) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['hierarchy'] });
  const err = useState<unknown>(null);
  const onError = (e: unknown) => err[1](e);

  const addParent = useMutation({ mutationFn: () => api.post('/hierarchy/edges', { parentId: newParent, childId: id }), onSuccess: () => { setNewParent(''); refresh(); }, onError });
  const removeParent = useMutation({ mutationFn: (parentId: string) => api.del(`/hierarchy/edges?parentId=${parentId}&childId=${id}`), onSuccess: refresh, onError });
  const removeMember = useMutation({ mutationFn: (userId: string) => api.del(`/hierarchy/nodes/${id}/members/${userId}`), onSuccess: refresh, onError });
  const setPrimary = useMutation({ mutationFn: (userId: string) => api.patch(`/hierarchy/nodes/${id}/members/${userId}`, { isPrimary: true }), onSuccess: refresh, onError });
  const revoke = useMutation({ mutationFn: (grantId: string) => api.del(`/admin/grants/${grantId}`), onSuccess: refresh, onError });
  const del = useMutation({ mutationFn: (reparent: boolean) => api.del(`/hierarchy/nodes/${id}?reparent=${reparent}`), onSuccess: () => { refresh(); onDeleted(); }, onError });

  if (!n) return <Spinner />;
  const invalidParents = new Set([id, ...n.parents.map((p: any) => p.id)]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-zinc-200 p-4">
        <div className="text-xs font-semibold uppercase text-zinc-500">{n.type.toLowerCase()}</div>
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-xl font-semibold">{n.name}</h2>
          {canHierarchy && <button className="btn-ghost px-2 py-1" onClick={() => setModal('edit')}>Edit</button>}
        </div>
        {n.paths.map((p: any[], i: number) => (
          <div key={i} className="flex flex-wrap items-center gap-1 text-xs text-zinc-500">
            {p.map((x, j) => <span key={x.id} className="flex items-center gap-1">{j > 0 && <ChevronRight size={12} />}{x.name}</span>)}
          </div>
        ))}
        {canHierarchy && <button className="btn-outline mt-3 py-1" onClick={() => setModal('child')}><Plus size={14} /> Add sub-unit</button>}
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'members', label: `Members (${n.memberships.length})` }, { value: 'roles', label: `Roles (${n.grants.length})` }, { value: 'structure', label: 'Structure' }]} />
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        <ErrorText error={err[0]} />
        {tab === 'members' && (
          <>
            {canUsers && <button className="btn-outline py-1" onClick={() => setModal('members')}><Plus size={14} /> Add members</button>}
            {n.memberships.map((m: any) => (
              <UserLine
                key={m.userId}
                user={m.user}
                size={36}
                sub={<>{m.title}{m.isPrimary && ' · primary unit'}</>}
                right={canUsers && (
                  <div className="flex gap-1">
                    {!m.isPrimary && <button className="text-xs text-zinc-500 hover:underline" onClick={() => setPrimary.mutate(m.userId)}>Make primary</button>}
                    <button className="rounded p-1 text-zinc-400 hover:text-red-600" title="Remove from unit" onClick={() => removeMember.mutate(m.userId)}><Trash2 size={14} /></button>
                  </div>
                )}
              />
            ))}
          </>
        )}
        {tab === 'roles' && (
          <>
            <p className="text-xs text-zinc-500">Roles granted here apply to this unit and all units below it (SOT §4).</p>
            {canRoles && <button className="btn-outline py-1" onClick={() => setModal('grant')}><Plus size={14} /> Grant role</button>}
            {n.grants.map((g: any) => (
              <div key={g.id} className="flex items-center justify-between rounded-md border border-zinc-200 p-2">
                <div>
                  <div className="text-sm font-semibold">{g.role.name}</div>
                  <div className="text-xs text-zinc-500">{g.user ? `Granted to ${g.user.name}` : 'All members (inherited downward)'}</div>
                  <div className="mt-1 flex flex-wrap gap-1">{g.role.permissions.map((p: string) => <span key={p} className="rounded bg-zinc-100 px-1.5 text-[10px] font-semibold text-zinc-600">{p}</span>)}</div>
                </div>
                {canRoles && <button className="rounded p-1 text-zinc-400 hover:text-red-600" onClick={() => revoke.mutate(g.id)}><Trash2 size={14} /></button>}
              </div>
            ))}
            {!n.grants.length && <div className="muted">No roles granted directly on this unit.</div>}
          </>
        )}
        {tab === 'structure' && (
          <>
            <div>
              <div className="label">Parents ({n.parents.length})</div>
              {n.parents.map((p: any) => (
                <div key={p.id} className="flex items-center justify-between py-1 text-sm">
                  {p.name}
                  {canHierarchy && n.parents.length > 1 && <button className="text-xs text-red-600 hover:underline" onClick={() => removeParent.mutate(p.id)}>Disconnect</button>}
                </div>
              ))}
              {canHierarchy && !n.isRoot && (
                <div className="mt-2 flex gap-2">
                  <select className="input py-1" value={newParent} onChange={(e) => setNewParent(e.target.value)}>
                    <option value="">Add another parent…</option>
                    {graph.nodes.filter((x: any) => !invalidParents.has(x.id)).map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                  <button className="btn-outline py-1" disabled={!newParent} onClick={() => addParent.mutate()}>Add</button>
                </div>
              )}
              <p className="mt-1 text-xs text-zinc-500">A unit can report to several parents (matrix). Cycles are rejected.</p>
            </div>
            <div>
              <div className="label">Children ({n.children.length})</div>
              {n.children.map((c: any) => <div key={c.id} className="py-1 text-sm">{c.name}</div>)}
            </div>
            {canHierarchy && !n.isRoot && (
              <div className="rounded-md border border-red-200 p-3">
                <div className="text-sm font-semibold text-red-700">Delete unit</div>
                <p className="text-xs text-zinc-600">Memberships and role grants on this unit are removed.</p>
                <div className="mt-2 flex gap-2">
                  <button className="btn-danger py-1" disabled={n.children.length > 0} onClick={() => confirm(`Delete ${n.name}?`) && del.mutate(false)}>Delete</button>
                  {n.children.length > 0 && <button className="btn-danger py-1" onClick={() => confirm(`Delete ${n.name} and attach its ${n.children.length} sub-units to its parents?`) && del.mutate(true)}>Delete & re-parent children</button>}
                </div>
              </div>
            )}
          </>
        )}
      </div>
      {modal === 'child' && <NodeForm parentId={id} onClose={() => setModal(null)} />}
      {modal === 'edit' && <NodeForm initial={n} onClose={() => setModal(null)} />}
      {modal === 'members' && <AddMembers nodeId={id} onClose={() => setModal(null)} />}
      {modal === 'grant' && <GrantRole nodeId={id} onClose={() => setModal(null)} />}
    </div>
  );
}

export default function AdminHierarchy() {
  const qc = useQueryClient();
  const canHierarchy = useCan('hierarchy.manage');
  const { data } = useHierarchy();
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const connect = useMutation({
    mutationFn: ({ parentId, childId }: { parentId: string; childId: string }) => api.post('/hierarchy/edges', { parentId, childId }),
    onSuccess: () => { setError(null); qc.invalidateQueries({ queryKey: ['hierarchy'] }); },
    onError: setError,
  });
  if (!data) return <Spinner />;
  const sel = selected ?? data.nodes.find((n) => n.isRoot)?.id ?? null;
  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)_400px]">
      <div className="relative h-full bg-white">
        <div className="absolute left-3 top-3 z-10 max-w-md rounded-md bg-white/90 p-2 text-xs text-zinc-600 shadow">
          <b>Company hierarchy (DAG).</b> Click a unit to manage it.{canHierarchy && ' Drag from a unit’s bottom handle to another unit’s top handle to add a reporting line.'}
          {error ? <div className="mt-1 text-red-600">{(error as Error).message}</div> : null}
        </div>
        <OrgGraph graph={data} selectedId={sel} onSelect={setSelected} editable={canHierarchy} onConnect={(parentId, childId) => connect.mutate({ parentId, childId })} />
      </div>
      <aside className="h-full min-h-0 border-l border-zinc-200 bg-white">{sel && <NodePanel key={sel} id={sel} graph={data} onDeleted={() => setSelected(null)} />}</aside>
    </div>
  );
}
