import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { ago } from '@/lib/format';
import { Avatar, Empty, Spinner } from '@/components/ui';
import { ProfileCard } from './Feed';

export default function Notifications() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const q = useInfiniteQuery({
    queryKey: ['notifications', 'list', unreadOnly],
    initialPageParam: '',
    queryFn: ({ pageParam }) => api.get(`/notifications?cursor=${pageParam}&unread=${unreadOnly}`),
    getNextPageParam: (l: any) => l.nextCursor ?? undefined,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['notifications'] });
  const readAll = useMutation({ mutationFn: () => api.post('/notifications/read-all'), onSuccess: refresh });
  const del = useMutation({ mutationFn: (id: string) => api.del(`/notifications/${id}`), onSuccess: refresh });

  async function open(n: any) {
    if (!n.readAt) await api.post(`/notifications/${n.id}/read`);
    refresh();
    if (n.link) navigate(n.link);
  }

  const items = q.data?.pages.flatMap((p: any) => p.items) ?? [];
  return (
    <div className="mx-auto grid max-w-[1000px] grid-cols-1 lg:grid-cols-[225px_minmax(0,1fr)] gap-5 px-4 py-5">
      <aside><ProfileCard /></aside>
      <section className="card self-start">
        <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3">
          <button className={`chip ${!unreadOnly ? 'chip-active' : ''}`} onClick={() => setUnreadOnly(false)}>All</button>
          <button className={`chip ${unreadOnly ? 'chip-active' : ''}`} onClick={() => setUnreadOnly(true)}>Unread</button>
          <button className="link ml-auto text-sm" onClick={() => readAll.mutate()}>Mark all as read</button>
        </div>
        {q.isLoading && <Spinner />}
        {items.map((n: any) => (
          <div key={n.id} className={`group flex cursor-pointer items-start gap-3 border-b border-zinc-100 px-4 py-3 hover:bg-zinc-50 ${n.readAt ? '' : 'bg-sky-50'}`} onClick={() => open(n)}>
            {n.actor ? <Avatar user={n.actor} size={48} /> : <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-100 text-brand-500"><Bell size={20} /></div>}
            <div className="flex-1 text-sm">{n.text}</div>
            <div className="flex flex-col items-end gap-1">
              <span className="text-xs text-zinc-500">{ago(n.createdAt)}</span>
              <button className="invisible rounded p-1 text-zinc-400 hover:text-red-600 group-hover:visible" onClick={(e) => { e.stopPropagation(); del.mutate(n.id); }}><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
        {!q.isLoading && !items.length && <Empty icon={<Bell size={40} />} title="You're all caught up" />}
        {q.hasNextPage && <button className="w-full py-3 text-sm font-semibold text-zinc-600 hover:bg-zinc-50" onClick={() => q.fetchNextPage()}>Show more</button>}
      </section>
    </div>
  );
}
