import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Briefcase, CalendarDays, Hash, Network as OrgIcon, UsersRound } from 'lucide-react';
import { api } from '@/lib/api';
import { dateLong } from '@/lib/format';
import { Empty, Spinner, UserLine } from '@/components/ui';
import { PostCard } from '@/components/PostCard';

const TYPES = ['all', 'people', 'posts', 'groups', 'events', 'jobs', 'hashtags', 'units'] as const;

export default function Search() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const type = params.get('type') ?? 'all';
  const { data, isLoading } = useQuery({ queryKey: ['search', q, type], queryFn: () => api.get(`/search?q=${encodeURIComponent(q)}&type=${type}`), enabled: !!q });
  const nothing = data && Object.values(data).every((v: any) => !v.length);

  const block = (title: string, show: boolean, children: React.ReactNode) =>
    show && <section className="card p-4"><h2 className="mb-3 text-lg font-semibold">{title}</h2><div className="space-y-3">{children}</div></section>;

  return (
    <div className="mx-auto max-w-[760px] space-y-2 px-4 py-5">
      <div className="card flex flex-wrap gap-2 p-3">
        {TYPES.map((t) => (
          <button key={t} className={`chip capitalize ${type === t ? 'chip-active' : ''}`} onClick={() => setParams({ q, type: t })}>{t}</button>
        ))}
      </div>
      {isLoading && <Spinner />}
      {nothing && <div className="card"><Empty title={`No results for “${q}”`}>Try different keywords.</Empty></div>}
      {data && (
        <>
          {block('People', data.people.length > 0, data.people.map((u: any) => <UserLine key={u.id} user={u} size={48} sub={u.memberships[0]?.node.name} />))}
          {block('Units', data.units.length > 0, data.units.map((n: any) => (
            <Link key={n.id} to={`/org?node=${n.id}`} className="flex items-center gap-3 hover:underline"><OrgIcon size={18} /> <span className="font-semibold">{n.name}</span><span className="muted">{n.type.toLowerCase()} · {n._count.memberships} members</span></Link>
          )))}
          {block('Jobs', data.jobs.length > 0, data.jobs.map((j: any) => (
            <Link key={j.id} to={`/jobs/${j.id}`} className="flex items-center gap-3"><Briefcase size={18} /><div><div className="font-semibold hover:underline">{j.title}</div><div className="muted">{j.node?.name} · {j.location}</div></div></Link>
          )))}
          {block('Groups', data.groups.length > 0, data.groups.map((g: any) => (
            <Link key={g.id} to={`/groups/${g.id}`} className="flex items-center gap-3"><UsersRound size={18} /><div><div className="font-semibold hover:underline">{g.name}</div><div className="muted">{g._count.members} members</div></div></Link>
          )))}
          {block('Events', data.events.length > 0, data.events.map((e: any) => (
            <Link key={e.id} to={`/events/${e.id}`} className="flex items-center gap-3"><CalendarDays size={18} /><div><div className="font-semibold hover:underline">{e.title}</div><div className="muted">{dateLong(e.startsAt)}</div></div></Link>
          )))}
          {block('Hashtags', data.hashtags.length > 0, data.hashtags.map((h: any) => (
            <Link key={h.id} to={`/hashtag/${h.tag}`} className="flex items-center gap-2"><Hash size={16} /><span className="font-semibold hover:underline">{h.tag}</span><span className="muted">{h._count.posts} posts</span></Link>
          )))}
          {data.posts.length > 0 && <h2 className="px-1 pt-2 text-lg font-semibold">Posts</h2>}
          {data.posts.map((p: any) => <PostCard key={p.id} post={p} />)}
        </>
      )}
    </div>
  );
}
