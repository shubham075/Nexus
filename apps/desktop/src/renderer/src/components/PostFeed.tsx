import { useEffect, useRef } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Newspaper } from 'lucide-react';
import { api } from '@/lib/api';
import { PostCard } from './PostCard';
import { Empty, Spinner } from './ui';

/** Infinite list of posts from any paged endpoint returning { items, nextCursor }. */
export function PostFeed({ queryKey, path, empty }: { queryKey: unknown[]; path: string; empty?: string }) {
  const sentinel = useRef<HTMLDivElement>(null);
  const q = useInfiniteQuery({
    queryKey,
    initialPageParam: '' as string,
    queryFn: ({ pageParam }) => api.get(`${path}${path.includes('?') ? '&' : '?'}cursor=${pageParam}`),
    getNextPageParam: (last: any) => last.nextCursor ?? undefined,
  });

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => e[0].isIntersecting && q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage());
    io.observe(el);
    return () => io.disconnect();
  }, [q]);

  if (q.isLoading) return <Spinner />;
  if (q.error) return <div className="card p-4 text-sm text-red-600">{(q.error as Error).message}</div>;
  const posts = q.data!.pages.flatMap((p: any) => p.items);
  if (!posts.length) return <div className="card"><Empty icon={<Newspaper size={40} />} title="Nothing here yet">{empty}</Empty></div>;
  return (
    <div className="space-y-2">
      {posts.map((p: any) => <PostCard key={p.id} post={p} />)}
      <div ref={sentinel} />
      {q.isFetchingNextPage && <Spinner />}
      {!q.hasNextPage && posts.length > 5 && <div className="py-4 text-center text-xs text-zinc-500">You're all caught up ✨</div>}
    </div>
  );
}
