import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark, CalendarDays, Hash, Network as OrgIcon, UserPlus, UsersRound } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Avatar, UserLine } from '@/components/ui';
import { ComposerBox } from '@/components/Composer';
import { PostFeed } from '@/components/PostFeed';

export function ProfileCard() {
  const me = useAuth((s) => s.me!);
  const { data: stats } = useQuery({ queryKey: ['network', 'stats'], queryFn: () => api.get('/network/stats') });
  const { data: views } = useQuery({ queryKey: ['profile-views'], queryFn: () => api.get('/users/me/profile-views') });
  const primary = me.memberships.find((m) => m.isPrimary) ?? me.memberships[0];
  return (
    <div className="card overflow-hidden">
      <div className="h-14 bg-gradient-to-br from-zinc-200 via-zinc-100 to-zinc-50" style={me.coverUrl ? { backgroundImage: `url(${me.coverUrl})`, backgroundSize: 'cover' } : undefined} />
      <div className="-mt-9 flex flex-col items-center border-b border-zinc-200 px-3 pb-4 text-center">
        <Link to={`/profile/${me.id}`} className="rounded-full border-2 border-white"><Avatar user={me} size={72} /></Link>
        <Link to={`/profile/${me.id}`} className="mt-2 font-semibold hover:underline">{me.name}</Link>
        <div className="text-xs text-zinc-500">{me.headline}</div>
        {primary && <div className="mt-1 text-xs text-zinc-500">{primary.node.name}</div>}
      </div>
      <div className="space-y-1 border-b border-zinc-200 py-3 text-xs font-semibold">
        <Link to="/network" className="flex justify-between px-3 py-0.5 hover:bg-zinc-100"><span className="text-zinc-500">Connections</span><span className="text-brand-500">{stats?.connections ?? 0}</span></Link>
        <div className="flex justify-between px-3 py-0.5"><span className="text-zinc-500">Profile viewers this week</span><span className="text-brand-500">{views?.thisWeek ?? 0}</span></div>
      </div>
      <div className="py-2 text-xs font-semibold text-zinc-700">
        <Link to="/saved" className="flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-100"><Bookmark size={14} /> Saved items</Link>
        <Link to="/groups" className="flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-100"><UsersRound size={14} /> Groups</Link>
        <Link to="/events" className="flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-100"><CalendarDays size={14} /> Events</Link>
        <Link to="/org" className="flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-100"><OrgIcon size={14} /> Org chart</Link>
      </div>
    </div>
  );
}

function Trending() {
  const { data = [] } = useQuery({ queryKey: ['trending'], queryFn: () => api.get<any[]>('/posts/trending') });
  return (
    <div className="card p-3">
      <h3 className="mb-2 font-semibold">Trending at the company</h3>
      {data.length === 0 && <div className="muted">No hashtags yet this week.</div>}
      {data.map((t) => (
        <Link key={t.tag} to={`/hashtag/${t.tag}`} className="flex items-center gap-2 rounded px-1 py-1.5 hover:bg-zinc-100">
          <Hash size={14} className="text-zinc-500" />
          <div>
            <div className="text-sm font-semibold">{t.tag}</div>
            <div className="muted">{t.count} post{t.count === 1 ? '' : 's'}</div>
          </div>
        </Link>
      ))}
    </div>
  );
}

export function Suggestions({ limit = 4 }: { limit?: number }) {
  const qc = useQueryClient();
  const [sent, setSent] = useState<string[]>([]);
  const { data = [] } = useQuery({ queryKey: ['network', 'suggestions'], queryFn: () => api.get<any[]>('/network/suggestions') });
  const connect = useMutation({
    mutationFn: (userId: string) => api.post('/network/connect', { userId }),
    onSuccess: (_d, userId) => { setSent((s) => [...s, userId]); qc.invalidateQueries({ queryKey: ['network', 'invitations'] }); },
  });
  return (
    <div className="card p-3">
      <h3 className="mb-3 font-semibold">People you may know</h3>
      <div className="space-y-4">
        {data.slice(0, limit).map((s) => (
          <div key={s.user.id}>
            <UserLine user={s.user} sub={s.mutual ? `${s.mutual} mutual connection${s.mutual > 1 ? 's' : ''}` : s.reason} />
            <button className="btn-outline ml-[52px] mt-1 border-zinc-500 py-0.5 text-zinc-600" disabled={sent.includes(s.user.id)} onClick={() => connect.mutate(s.user.id)}>
              <UserPlus size={14} /> {sent.includes(s.user.id) ? 'Pending' : 'Connect'}
            </button>
          </div>
        ))}
        {!data.length && <div className="muted">You're connected with everyone we know of 🎉</div>}
      </div>
      <Link to="/network" className="mt-3 block text-sm font-semibold text-zinc-500 hover:text-brand-500">View all recommendations →</Link>
    </div>
  );
}

export default function Feed() {
  const [filter, setFilter] = useState<'all' | 'network'>('all');
  return (
    <div className="mx-auto grid max-w-[1180px] grid-cols-1 gap-5 lg:grid-cols-[225px_minmax(0,1fr)] xl:grid-cols-[225px_minmax(0,1fr)_300px] px-4 py-5">
      <aside className="sticky top-5 hidden self-start lg:block"><ProfileCard /></aside>
      <section className="space-y-2">
        <ComposerBox />
        <div className="flex items-center gap-2 py-1 text-xs text-zinc-500">
          <div className="h-px flex-1 bg-zinc-300" />
          Sort by:
          <select className="bg-transparent font-semibold text-zinc-800 outline-none" value={filter} onChange={(e) => setFilter(e.target.value as 'all' | 'network')}>
            <option value="all">Top — whole company</option>
            <option value="network">My network</option>
          </select>
        </div>
        <PostFeed queryKey={['feed', filter]} path={`/posts/feed?filter=${filter}`} empty="Be the first to share something with your colleagues." />
      </section>
      <aside className="hidden space-y-2 xl:block">
        <Trending />
        <Suggestions />
      </aside>
    </div>
  );
}
