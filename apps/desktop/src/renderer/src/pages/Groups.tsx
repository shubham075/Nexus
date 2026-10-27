import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Plus, UsersRound, Globe } from 'lucide-react';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { Empty, ErrorText, Modal, Spinner, Tabs } from '@/components/ui';
import { NodeSelect } from '@/components/NodeSelect';

export function GroupForm({ initial, onClose }: { initial?: any; onClose: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [f, setF] = useState({ name: initial?.name ?? '', description: initial?.description ?? '', rules: initial?.rules ?? '', privacy: initial?.privacy ?? 'PUBLIC', nodeId: initial?.nodeId ?? null });
  const save = useMutation({
    mutationFn: () => (initial ? api.patch(`/groups/${initial.id}`, f) : api.post('/groups', f)),
    onSuccess: (g) => { qc.invalidateQueries({ queryKey: ['groups'] }); qc.invalidateQueries({ queryKey: ['group'] }); onClose(); if (!initial) navigate(`/groups/${g.id}`); },
  });
  return (
    <Modal title={initial ? 'Edit group' : 'Create group'} onClose={onClose} footer={<button className="btn-primary" disabled={!f.name.trim()} onClick={() => save.mutate()}>{initial ? 'Save' : 'Create'}</button>}>
      <div className="space-y-3">
        <div><label className="label">Group name *</label><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div><label className="label">Description</label><textarea className="input" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
        <div><label className="label">Rules</label><textarea className="input" rows={3} value={f.rules} onChange={(e) => setF({ ...f, rules: e.target.value })} /></div>
        <div><label className="label">Linked unit (optional)</label><NodeSelect value={f.nodeId} onChange={(nodeId) => setF({ ...f, nodeId })} placeholder="None" /></div>
        <div>
          <label className="label">Privacy</label>
          <div className="flex gap-2">
            {['PUBLIC', 'PRIVATE'].map((p) => <button key={p} type="button" className={`chip ${f.privacy === p ? 'chip-active' : ''}`} onClick={() => setF({ ...f, privacy: p })}>{p === 'PUBLIC' ? 'Public — anyone can join' : 'Private — request to join'}</button>)}
          </div>
        </div>
        <ErrorText error={save.error} />
      </div>
    </Modal>
  );
}

export default function Groups() {
  const canCreate = useCan('group.create');
  const [tab, setTab] = useState<'mine' | 'discover'>('mine');
  const [creating, setCreating] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['groups', tab], queryFn: () => api.get<any[]>(`/groups${tab === 'mine' ? '?mine=true' : ''}`) });
  return (
    <div className="mx-auto max-w-[800px] space-y-2 px-4 py-5">
      <div className="card">
        <div className="flex items-center justify-between px-4 pt-3">
          <h1 className="text-xl font-semibold">Groups</h1>
          {canCreate && <button className="btn-outline" onClick={() => setCreating(true)}><Plus size={16} /> Create group</button>}
        </div>
        <Tabs value={tab} onChange={setTab} tabs={[{ value: 'mine', label: 'Your groups' }, { value: 'discover', label: 'Discover' }]} />
        {isLoading && <Spinner />}
        <div className="divide-y divide-zinc-100">
          {(data ?? []).map((g) => (
            <Link key={g.id} to={`/groups/${g.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-50">
              <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-zinc-900 text-surface"><UsersRound /></div>
              <div className="flex-1">
                <div className="font-semibold">{g.name}</div>
                <div className="muted flex items-center gap-1">{g.privacy === 'PRIVATE' ? <Lock size={12} /> : <Globe size={12} />} {g.privacy.toLowerCase()} · {g.memberCount} members{g.node && ` · ${g.node.name}`}</div>
                {g.description && <div className="line-clamp-1 text-sm text-zinc-600">{g.description}</div>}
              </div>
              {g.myRole && <span className="chip">{g.myRole === 'PENDING' ? 'Requested' : g.myRole.toLowerCase()}</span>}
            </Link>
          ))}
        </div>
        {!isLoading && !data?.length && <Empty icon={<UsersRound size={40} />} title={tab === 'mine' ? 'You have not joined any groups' : 'No groups yet'}>Groups bring together colleagues around shared interests.</Empty>}
      </div>
      {creating && <GroupForm onClose={() => setCreating(false)} />}
    </div>
  );
}
