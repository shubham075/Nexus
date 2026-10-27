import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquareText, UserPlus, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { ago } from '@/lib/format';
import { Avatar, Empty, Tabs, UserLine } from '@/components/ui';

export default function Network() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'grow' | 'connections' | 'sent'>('grow');
  const [sent, setSent] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const inv = useQuery({ queryKey: ['network', 'invitations'], queryFn: () => api.get('/network/invitations') });
  const conns = useQuery({ queryKey: ['network', 'connections'], queryFn: () => api.get<any[]>('/network/connections') });
  const sugg = useQuery({ queryKey: ['network', 'suggestions'], queryFn: () => api.get<any[]>('/network/suggestions') });
  const stats = useQuery({ queryKey: ['network', 'stats'], queryFn: () => api.get('/network/stats') });
  const refresh = () => qc.invalidateQueries({ queryKey: ['network'] });

  const accept = useMutation({ mutationFn: (id: string) => api.post(`/network/invitations/${id}/accept`), onSuccess: refresh });
  const ignore = useMutation({ mutationFn: (id: string) => api.post(`/network/invitations/${id}/ignore`), onSuccess: refresh });
  const withdraw = useMutation({ mutationFn: (id: string) => api.del(`/network/invitations/${id}`), onSuccess: refresh });
  const connect = useMutation({ mutationFn: (userId: string) => api.post('/network/connect', { userId }), onSuccess: (_d, id) => { setSent((s) => [...s, id]); refresh(); } });
  const message = useMutation({ mutationFn: (userId: string) => api.post('/conversations', { userIds: [userId] }), onSuccess: (c) => navigate(`/messaging/${c.id}`) });

  return (
    <div className="mx-auto grid max-w-[1130px] grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)] gap-5 px-4 py-5">
      <aside className="card self-start p-4">
        <h2 className="mb-3 font-semibold">Manage my network</h2>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="flex items-center gap-2"><Users size={16} /> Connections</span><b>{stats.data?.connections ?? 0}</b></div>
          <div className="flex justify-between"><span>Followers</span><b>{stats.data?.followers ?? 0}</b></div>
          <div className="flex justify-between"><span>Following</span><b>{stats.data?.following ?? 0}</b></div>
        </div>
        <Link to="/groups" className="link mt-4 block text-sm">Groups</Link>
        <Link to="/events" className="link mt-1 block text-sm">Events</Link>
        <Link to="/org" className="link mt-1 block text-sm">Org chart</Link>
      </aside>

      <section className="space-y-2">
        <div className="card">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'grow', label: 'Grow' },
              { value: 'connections', label: `Connections (${conns.data?.length ?? 0})` },
              { value: 'sent', label: `Sent (${inv.data?.sent.length ?? 0})` },
            ]}
          />
        </div>

        {tab === 'grow' && (
          <>
            <div className="card">
              <div className="border-b border-zinc-200 px-4 py-3 font-semibold">Invitations ({inv.data?.received.length ?? 0})</div>
              {inv.data?.received.length ? (
                inv.data.received.map((i: any) => (
                  <div key={i.id} className="border-b border-zinc-100 px-4 py-3 last:border-0">
                    <UserLine
                      user={i.requester}
                      size={56}
                      sub={ago(i.createdAt) + ' ago'}
                      right={
                        <div className="flex gap-2">
                          <button className="btn-ghost" onClick={() => ignore.mutate(i.id)}>Ignore</button>
                          <button className="btn-outline" onClick={() => accept.mutate(i.id)}>Accept</button>
                        </div>
                      }
                    />
                    {i.message && <div className="ml-[68px] mt-2 rounded-lg bg-zinc-50 p-2 text-sm">“{i.message}”</div>}
                  </div>
                ))
              ) : (
                <div className="px-4 py-3 text-sm text-zinc-500">No pending invitations</div>
              )}
            </div>

            <div className="card p-4">
              <h3 className="mb-3 font-semibold">People you may know</h3>
              <div className="grid grid-cols-3 gap-3">
                {(sugg.data ?? []).map((s) => (
                  <div key={s.user.id} className="flex flex-col items-center overflow-hidden rounded-lg border border-zinc-200 pb-3 text-center">
                    <div className="h-14 w-full bg-gradient-to-br from-zinc-200 to-zinc-50" />
                    <Link to={`/profile/${s.user.id}`} className="-mt-9 rounded-full border-2 border-white"><Avatar user={s.user} size={72} /></Link>
                    <Link to={`/profile/${s.user.id}`} className="mt-2 px-2 font-semibold hover:underline">{s.user.name}</Link>
                    <div className="line-clamp-2 h-8 px-3 text-xs text-zinc-500">{s.user.headline}</div>
                    <div className="mt-1 px-2 text-xs text-zinc-500">{s.mutual ? `${s.mutual} mutual` : s.reason}</div>
                    <button className="btn-outline mt-3 w-[85%] py-1" disabled={sent.includes(s.user.id)} onClick={() => connect.mutate(s.user.id)}>
                      <UserPlus size={14} /> {sent.includes(s.user.id) ? 'Pending' : 'Connect'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {tab === 'connections' && (
          <div className="card">
            <div className="border-b border-zinc-200 p-3"><input className="input" placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            {(conns.data ?? []).filter((c) => c.name.toLowerCase().includes(q.toLowerCase())).map((c) => (
              <div key={c.id} className="border-b border-zinc-100 px-4 py-3 last:border-0">
                <UserLine
                  user={c}
                  size={56}
                  sub={c.connectedAt && `Connected ${ago(c.connectedAt)} ago`}
                  right={<button className="btn-outline" onClick={() => message.mutate(c.id)}><MessageSquareText size={14} /> Message</button>}
                />
              </div>
            ))}
            {!conns.data?.length && <Empty icon={<Users size={40} />} title="No connections yet">Connect with colleagues from the Grow tab.</Empty>}
          </div>
        )}

        {tab === 'sent' && (
          <div className="card">
            {(inv.data?.sent ?? []).map((i: any) => (
              <div key={i.id} className="border-b border-zinc-100 px-4 py-3 last:border-0">
                <UserLine user={i.addressee} size={56} sub={`Sent ${ago(i.createdAt)} ago`} right={<button className="btn-ghost" onClick={() => withdraw.mutate(i.id)}>Withdraw</button>} />
              </div>
            ))}
            {!inv.data?.sent.length && <Empty title="No sent invitations" />}
          </div>
        )}
      </section>
    </div>
  );
}
