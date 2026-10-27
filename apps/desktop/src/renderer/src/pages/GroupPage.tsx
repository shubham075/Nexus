import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Globe, Lock, Settings, UsersRound } from 'lucide-react';
import { api } from '@/lib/api';
import { Modal, Spinner, UserLine } from '@/components/ui';
import { ComposerBox } from '@/components/Composer';
import { PostFeed } from '@/components/PostFeed';
import { GroupForm } from './Groups';

function MembersModal({ group, onClose }: { group: any; onClose: () => void }) {
  const qc = useQueryClient();
  const { data = [] } = useQuery({ queryKey: ['group', group.id, 'members'], queryFn: () => api.get<any[]>(`/groups/${group.id}/members`) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['group', group.id] });
  const setRole = useMutation({ mutationFn: ({ userId, role }: { userId: string; role: string }) => api.patch(`/groups/${group.id}/members/${userId}`, { role }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (userId: string) => api.del(`/groups/${group.id}/members/${userId}`), onSuccess: refresh });
  return (
    <Modal title={`Members of ${group.name}`} onClose={onClose}>
      <div className="space-y-3">
        {data.map((m) => (
          <UserLine
            key={m.userId}
            user={m.user}
            sub={m.role.toLowerCase()}
            right={
              group.canManage && (
                <div className="flex gap-1">
                  {m.role === 'PENDING' ? (
                    <button className="btn-primary py-1" onClick={() => setRole.mutate({ userId: m.userId, role: 'MEMBER' })}>Approve</button>
                  ) : (
                    <select className="rounded border px-1 text-xs" value={m.role} onChange={(e) => setRole.mutate({ userId: m.userId, role: e.target.value })}>
                      {['ADMIN', 'MODERATOR', 'MEMBER'].map((r) => <option key={r}>{r}</option>)}
                    </select>
                  )}
                  <button className="btn-ghost py-1 text-red-600" onClick={() => remove.mutate(m.userId)}>Remove</button>
                </div>
              )
            }
          />
        ))}
      </div>
    </Modal>
  );
}

export default function GroupPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [modal, setModal] = useState<null | 'members' | 'edit'>(null);
  const { data: g } = useQuery({ queryKey: ['group', id], queryFn: () => api.get(`/groups/${id}`) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['group', id] }); qc.invalidateQueries({ queryKey: ['groups'] }); qc.invalidateQueries({ queryKey: ['group-posts', id] }); };
  const join = useMutation({ mutationFn: () => api.post(`/groups/${id}/join`), onSuccess: refresh });
  const leave = useMutation({ mutationFn: () => api.post(`/groups/${id}/leave`), onSuccess: refresh });
  const del = useMutation({ mutationFn: () => api.del(`/groups/${id}`), onSuccess: () => navigate('/groups') });
  if (!g) return <Spinner />;
  const member = g.myRole && g.myRole !== 'PENDING';

  return (
    <div className="mx-auto grid max-w-[1000px] grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-5 px-4 py-5">
      <div className="space-y-2">
        <div className="card overflow-hidden">
          <div className="h-32 bg-gradient-to-br from-zinc-200 via-zinc-100 to-zinc-50" />
          <div className="p-5">
            <div className="-mt-14 mb-2 flex h-20 w-20 items-center justify-center rounded-xl border-4 border-surface bg-zinc-900 text-surface"><UsersRound size={36} /></div>
            <h1 className="text-2xl font-semibold">{g.name}</h1>
            <div className="muted flex items-center gap-1">{g.privacy === 'PRIVATE' ? <Lock size={12} /> : <Globe size={12} />} {g.privacy.toLowerCase()} group · {g._count.members} members{g.node && ` · ${g.node.name}`}</div>
            <div className="mt-3 flex gap-2">
              {!g.myRole && <button className="btn-primary" onClick={() => join.mutate()}>{g.privacy === 'PRIVATE' ? 'Request to join' : 'Join'}</button>}
              {g.myRole === 'PENDING' && <button className="btn-outline" disabled>Requested</button>}
              {member && <button className="btn-outline" onClick={() => leave.mutate()}>Leave</button>}
              <button className="btn-ghost" onClick={() => setModal('members')}>Members</button>
              {g.canManage && <button className="btn-ghost" onClick={() => setModal('edit')}><Settings size={16} /> Manage</button>}
              {g.canManage && <button className="btn-ghost text-red-600" onClick={() => confirm('Delete this group?') && del.mutate()}>Delete</button>}
            </div>
          </div>
        </div>
        {member && <ComposerBox groupId={g.id} />}
        <PostFeed queryKey={['group-posts', id]} path={`/groups/${id}/posts`} empty={g.privacy === 'PRIVATE' && !member ? 'Join this private group to see its posts.' : 'No posts yet — start the conversation.'} />
      </div>
      <aside className="space-y-2">
        <div className="card p-4">
          <h3 className="font-semibold">About</h3>
          <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-700">{g.description || 'No description.'}</p>
          {g.rules && (<><h3 className="mt-4 font-semibold">Rules</h3><p className="mt-1 whitespace-pre-wrap text-sm text-zinc-700">{g.rules}</p></>)}
        </div>
        <div className="card p-4">
          <h3 className="mb-3 font-semibold">Members</h3>
          <div className="space-y-3">{g.members.map((m: any) => <UserLine key={m.userId} user={m.user} size={32} sub={m.role !== 'MEMBER' ? m.role.toLowerCase() : undefined} />)}</div>
        </div>
      </aside>
      {modal === 'members' && <MembersModal group={g} onClose={() => setModal(null)} />}
      {modal === 'edit' && <GroupForm initial={g} onClose={() => setModal(null)} />}
    </div>
  );
}
