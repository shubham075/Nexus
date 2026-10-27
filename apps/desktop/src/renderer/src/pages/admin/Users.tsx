import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, MoreHorizontal, UserPlus } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ago } from '@/lib/format';
import { Avatar, ErrorText, Menu, MenuItem, Modal, Spinner } from '@/components/ui';
import { NodeMultiSelect } from '@/components/NodeSelect';

function TempPassword({ email, password, onClose }: { email: string; password: string; onClose: () => void }) {
  return (
    <Modal title="Temporary password" onClose={onClose} footer={<button className="btn-primary" onClick={onClose}>Done</button>}>
      <p className="text-sm">Share these sign-in details with the employee securely. This password is shown only once; they must change it at first sign-in.</p>
      <div className="mt-3 rounded-lg bg-zinc-100 p-3 font-mono text-sm">
        <div>{email}</div>
        <div className="flex items-center justify-between">{password}<button className="btn-ghost px-2 py-1" onClick={() => navigator.clipboard.writeText(password)}><Copy size={14} /></button></div>
      </div>
    </Modal>
  );
}

function InviteModal({ onClose, onInvited }: { onClose: () => void; onInvited: (r: { email: string; password: string }) => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ email: '', name: '', title: '', nodeIds: [] as string[] });
  const save = useMutation({
    mutationFn: () => api.post('/admin/users', f),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['admin', 'users'] }); qc.invalidateQueries({ queryKey: ['hierarchy'] }); onInvited({ email: r.user.email, password: r.temporaryPassword }); },
  });
  return (
    <Modal title="Invite employee" onClose={onClose} footer={<button className="btn-primary" disabled={!f.email || !f.name || !f.nodeIds.length} onClick={() => save.mutate()}>Create account</button>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Full name *</label><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div><label className="label">Work email *</label><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
        </div>
        <div><label className="label">Job title</label><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
        <div><label className="label">Units * (first selected becomes primary)</label><NodeMultiSelect value={f.nodeIds} onChange={(nodeIds) => setF({ ...f, nodeIds })} /></div>
        <ErrorText error={save.error} />
      </div>
    </Modal>
  );
}

function PermissionsModal({ user, onClose }: { user: any; onClose: () => void }) {
  const { data } = useQuery({ queryKey: ['admin', 'perms', user.id], queryFn: () => api.get(`/admin/users/${user.id}/permissions`) });
  return (
    <Modal title={`Effective permissions — ${user.name}`} onClose={onClose}>
      <p className="mb-3 text-xs text-zinc-500">Union of every role inherited from the user's units and their ancestors, plus personal grants.</p>
      {!data ? <Spinner /> : <div className="flex flex-wrap gap-1">{data.permissions.map((p: string) => <span key={p} className="chip">{p}</span>)}</div>}
    </Modal>
  );
}

export default function AdminUsers() {
  const me = useAuth((s) => s.me!);
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [inviting, setInviting] = useState(false);
  const [temp, setTemp] = useState<{ email: string; password: string } | null>(null);
  const [perms, setPerms] = useState<any>(null);
  const users = useInfiniteQuery({
    queryKey: ['admin', 'users', q],
    initialPageParam: '',
    queryFn: ({ pageParam }) => api.get(`/admin/users?q=${encodeURIComponent(q)}&cursor=${pageParam}`),
    getNextPageParam: (l: any) => l.nextCursor ?? undefined,
  });
  const update = useMutation({ mutationFn: ({ id, ...body }: any) => api.patch(`/admin/users/${id}`, body), onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }) });
  const reset = useMutation({ mutationFn: (u: any) => api.post(`/admin/users/${u.id}/reset-password`).then((r) => ({ email: u.email, password: r.temporaryPassword })), onSuccess: setTemp });
  const rows = users.data?.pages.flatMap((p: any) => p.items) ?? [];

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-xl font-semibold">Employees</h1>
        <input className="input ml-auto w-72" placeholder="Search name or email" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn-primary" onClick={() => setInviting(true)}><UserPlus size={16} /> Invite employee</button>
      </div>
      <ErrorText error={update.error ?? reset.error ?? users.error} />
      {users.error && <button className="btn-outline mb-3 mt-2" onClick={() => users.refetch()}>Retry</button>}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs text-zinc-500">
            <tr><th className="p-3">Employee</th><th className="p-3">Units</th><th className="p-3">Personal roles</th><th className="p-3">Last seen</th><th className="p-3">Status</th><th className="p-3" /></tr>
          </thead>
          <tbody>
            {rows.map((u: any) => (
              <tr key={u.id} className="border-t border-zinc-100 align-top">
                <td className="p-3">
                  <div className="flex items-center gap-2">
                    <Avatar user={u} size={32} />
                    <div><div className="font-semibold">{u.name}{u.isSuperAdmin && <span className="ml-1 rounded bg-brand-50 px-1 text-[10px] text-brand-600">super admin</span>}</div><div className="text-xs text-zinc-500">{u.email}</div></div>
                  </div>
                </td>
                <td className="p-3 text-xs">{u.memberships.map((m: any) => <div key={m.node.id}>{m.node.name}{m.isPrimary && ' ★'}{m.title && <span className="text-zinc-500"> · {m.title}</span>}</div>)}</td>
                <td className="p-3 text-xs">{u.grants.map((g: any) => <div key={g.id}>{g.role.name} <span className="text-zinc-500">@ {g.node.name}</span></div>)}</td>
                <td className="p-3 text-xs text-zinc-500">{u.lastSeenAt ? `${ago(u.lastSeenAt)} ago` : 'never'}</td>
                <td className="p-3">{u.isActive ? <span className="text-xs font-semibold text-green-700">Active</span> : <span className="text-xs font-semibold text-red-600">Deactivated</span>}</td>
                <td className="p-3 text-right">
                  <Menu trigger={<button className="rounded-full p-1.5 text-zinc-500 hover:bg-zinc-100" aria-label="Actions"><MoreHorizontal size={18} /></button>}>
                    <MenuItem onClick={() => setPerms(u)}>Effective permissions</MenuItem>
                    <MenuItem onClick={() => confirm(`Reset password for ${u.name}?`) && reset.mutate(u)}>Reset password</MenuItem>
                    {me.isSuperAdmin && u.id !== me.id && <MenuItem onClick={() => update.mutate({ id: u.id, isSuperAdmin: !u.isSuperAdmin })}>{u.isSuperAdmin ? 'Revoke super admin' : 'Make super admin'}</MenuItem>}
                    {u.id !== me.id && <MenuItem danger={u.isActive} onClick={() => update.mutate({ id: u.id, isActive: !u.isActive })}>{u.isActive ? 'Deactivate' : 'Reactivate'}</MenuItem>}
                  </Menu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {users.isLoading && <Spinner />}
        {users.hasNextPage && <button className="w-full py-3 text-sm font-semibold text-zinc-600 hover:bg-zinc-50" onClick={() => users.fetchNextPage()}>Load more</button>}
      </div>
      {inviting && <InviteModal onClose={() => setInviting(false)} onInvited={(r) => { setInviting(false); setTemp(r); }} />}
      {temp && <TempPassword {...temp} onClose={() => setTemp(null)} />}
      {perms && <PermissionsModal user={perms} onClose={() => setPerms(null)} />}
    </div>
  );
}
