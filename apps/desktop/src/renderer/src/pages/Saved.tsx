import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Bookmark } from 'lucide-react';
import { api } from '@/lib/api';
import { PostCard } from '@/components/PostCard';
import { Empty, Spinner } from '@/components/ui';

export default function Saved() {
  const { data, isLoading } = useQuery({ queryKey: ['saved'], queryFn: () => api.get<any[]>('/posts/saved') });
  const { data: jobs = [] } = useQuery({ queryKey: ['jobs', 'saved'], queryFn: () => api.get<any[]>('/jobs?saved=true') });
  return (
    <div className="mx-auto grid max-w-[1000px] grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)] gap-5 px-4 py-5">
      <aside className="card self-start p-3">
        <h2 className="mb-2 font-semibold">My items</h2>
        <div className="text-sm">Saved posts · {data?.length ?? 0}</div>
        <div className="mt-1 text-sm">Saved jobs · {jobs.length}</div>
        {jobs.map((j) => <Link key={j.id} to={`/jobs/${j.id}`} className="link mt-1 block text-xs">{j.title}</Link>)}
      </aside>
      <section className="space-y-2">
        <div className="card p-4"><h1 className="text-lg font-semibold">Saved posts</h1></div>
        {isLoading ? <Spinner /> : data!.length ? data!.map((p) => <PostCard key={p.id} post={p} />) : <div className="card"><Empty icon={<Bookmark size={40} />} title="No saved posts">Use the ••• menu on a post to save it for later.</Empty></div>}
      </section>
    </div>
  );
}
