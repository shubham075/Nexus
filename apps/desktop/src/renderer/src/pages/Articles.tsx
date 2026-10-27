import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Newspaper, PenLine, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { ago } from '@/lib/format';
import { Avatar, Empty, Modal, Spinner, Tabs } from '@/components/ui';

export default function Articles() {
  const canPublish = useCan('article.publish');
  const qc = useQueryClient();
  const [tab, setTab] = useState<'articles' | 'newsletters'>('articles');
  const [creating, setCreating] = useState(false);
  const [nl, setNl] = useState({ title: '', description: '' });
  const articles = useQuery({ queryKey: ['articles'], queryFn: () => api.get<any[]>('/articles') });
  const newsletters = useQuery({ queryKey: ['newsletters'], queryFn: () => api.get<any[]>('/articles/newsletters/all') });
  const sub = useMutation({ mutationFn: (id: string) => api.post(`/articles/newsletters/${id}/subscribe`), onSuccess: () => qc.invalidateQueries({ queryKey: ['newsletters'] }) });
  const createNl = useMutation({ mutationFn: () => api.post('/articles/newsletters', nl), onSuccess: () => { setCreating(false); setNl({ title: '', description: '' }); qc.invalidateQueries({ queryKey: ['newsletters'] }); } });

  return (
    <div className="mx-auto max-w-[860px] space-y-2 px-4 py-5">
      <div className="card">
        <div className="flex items-center justify-between px-4 pt-3">
          <h1 className="text-xl font-semibold">Articles & newsletters</h1>
          {canPublish && (
            <div className="flex gap-2">
              <button className="btn-outline" onClick={() => setCreating(true)}><Plus size={16} /> Newsletter</button>
              <Link to="/articles/new" className="btn-primary"><PenLine size={16} /> Write article</Link>
            </div>
          )}
        </div>
        <Tabs value={tab} onChange={setTab} tabs={[{ value: 'articles', label: 'Articles' }, { value: 'newsletters', label: 'Newsletters' }]} />
        {tab === 'articles' && (
          <div className="divide-y divide-zinc-100">
            {articles.isLoading && <Spinner />}
            {(articles.data ?? []).map((a) => (
              <Link key={a.id} to={`/articles/${a.id}`} className="flex gap-4 px-4 py-4 hover:bg-zinc-50">
                <div className="flex-1">
                  <div className="flex items-center gap-2 text-xs text-zinc-500"><Avatar user={a.author} size={20} /> {a.author.name} · {ago(a.publishedAt)}{a.newsletter && ` · ${a.newsletter.title}`}</div>
                  <div className="mt-1 text-lg font-semibold">{a.title}</div>
                </div>
                {a.coverUrl && <img src={a.coverUrl} className="h-20 w-32 rounded object-cover" />}
              </Link>
            ))}
            {!articles.isLoading && !articles.data?.length && <Empty icon={<Newspaper size={40} />} title="No articles yet" />}
          </div>
        )}
        {tab === 'newsletters' && (
          <div className="divide-y divide-zinc-100">
            {(newsletters.data ?? []).map((n) => (
              <div key={n.id} className="flex items-center gap-3 px-4 py-4">
                <div className="flex h-14 w-14 items-center justify-center rounded bg-orange-100 text-orange-700"><Newspaper /></div>
                <div className="flex-1">
                  <div className="font-semibold">{n.title}</div>
                  <div className="muted">by {n.owner.name} · {n._count.subscribers} subscribers · {n._count.articles} editions</div>
                  {n.description && <div className="text-sm text-zinc-600">{n.description}</div>}
                </div>
                <button className={n.subscribed ? 'btn-outline' : 'btn-primary'} onClick={() => sub.mutate(n.id)}>{n.subscribed ? 'Subscribed' : 'Subscribe'}</button>
              </div>
            ))}
            {!newsletters.data?.length && <Empty icon={<Newspaper size={40} />} title="No newsletters yet" />}
          </div>
        )}
      </div>
      {creating && (
        <Modal title="Create newsletter" onClose={() => setCreating(false)} footer={<button className="btn-primary" disabled={!nl.title} onClick={() => createNl.mutate()}>Create</button>}>
          <div className="space-y-3">
            <div><label className="label">Title *</label><input className="input" value={nl.title} onChange={(e) => setNl({ ...nl, title: e.target.value })} /></div>
            <div><label className="label">Description</label><textarea className="input" rows={3} value={nl.description} onChange={(e) => setNl({ ...nl, description: e.target.value })} /></div>
          </div>
        </Modal>
      )}
    </div>
  );
}
