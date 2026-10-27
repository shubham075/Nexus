import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { PERMISSION_GROUPS, PERMISSIONS, type Permission } from '@nexus/shared';
import { api } from '@/lib/api';
import { ErrorText, Modal, Spinner } from '@/components/ui';

function RoleEditor({ role, onClose }: { role?: any; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [perms, setPerms] = useState<string[]>(role?.permissions ?? []);
  const save = useMutation({
    mutationFn: () => (role ? api.patch(`/admin/roles/${role.id}`, { name, description, permissions: perms }) : api.post('/admin/roles', { name, description, permissions: perms })),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin', 'roles'] }); qc.invalidateQueries({ queryKey: ['hierarchy'] }); onClose(); },
  });
  return (
    <Modal title={role ? `Edit role: ${role.name}` : 'Create role'} width={680} onClose={onClose} footer={<button className="btn-primary" disabled={!name.trim()} onClick={() => save.mutate()}>Save role</button>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Name *</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><label className="label">Description</label><input className="input" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        </div>
        {PERMISSION_GROUPS.map((g) => (
          <div key={g.label}>
            <div className="label">{g.label}</div>
            <div className="grid grid-cols-2 gap-1">
              {g.perms.map((p) => (
                <label key={p} className="flex items-start gap-2 rounded p-1.5 text-sm hover:bg-zinc-50">
                  <input type="checkbox" className="mt-0.5 accent-zinc-900" checked={perms.includes(p)} onChange={(e) => setPerms(e.target.checked ? [...perms, p] : perms.filter((x) => x !== p))} />
                  <span><code className="text-xs font-semibold">{p}</code><br /><span className="text-xs text-zinc-500">{PERMISSIONS[p as Permission]}</span></span>
                </label>
              ))}
            </div>
          </div>
        ))}
        <ErrorText error={save.error} />
      </div>
    </Modal>
  );
}

export default function AdminRoles() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<any | null | undefined>(undefined);
  const { data, isLoading } = useQuery({ queryKey: ['admin', 'roles'], queryFn: () => api.get<any[]>('/admin/roles') });
  const del = useMutation({ mutationFn: (id: string) => api.del(`/admin/roles/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'roles'] }) });
  const allPerms = PERMISSION_GROUPS.flatMap((g) => g.perms);

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Roles & permissions</h1>
          <p className="text-sm text-zinc-500">Roles are sets of permissions. Grant them on hierarchy units from the Hierarchy page.</p>
        </div>
        <button className="btn-primary" onClick={() => setEditing(null)}><Plus size={16} /> New role</button>
      </div>
      <ErrorText error={del.error} />
      {isLoading ? <Spinner /> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left">
                <th className="sticky left-0 bg-white p-3">Role</th>
                {allPerms.map((p) => <th key={p} className="p-2 text-[10px] font-semibold text-zinc-500" style={{ writingMode: 'vertical-rl' }}>{p}</th>)}
                <th />
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((r) => (
                <tr key={r.id} className="border-b border-zinc-100 hover:bg-zinc-50">
                  <td className="sticky left-0 bg-white p-3">
                    <button className="font-semibold text-brand-500 hover:underline" onClick={() => setEditing(r)}>{r.name}</button>
                    {r.isSystem && <span className="ml-1 rounded bg-zinc-100 px-1 text-[10px] text-zinc-500">system</span>}
                    <div className="text-xs text-zinc-500">{r.description} · {r._count.grants} grant{r._count.grants === 1 ? '' : 's'}</div>
                  </td>
                  {allPerms.map((p) => <td key={p} className="p-2 text-center">{r.permissions.includes(p) || r.permissions.includes('admin.all') ? <span className={r.permissions.includes(p) ? 'text-green-700' : 'text-zinc-300'}>●</span> : ''}</td>)}
                  <td className="p-2">{!r.isSystem && <button className="rounded p-1 text-zinc-400 hover:text-red-600" onClick={() => confirm(`Delete role ${r.name}?`) && del.mutate(r.id)}><Trash2 size={14} /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing !== undefined && <RoleEditor role={editing ?? undefined} onClose={() => setEditing(undefined)} />}
    </div>
  );
}
