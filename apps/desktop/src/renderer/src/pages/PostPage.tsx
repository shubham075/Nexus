import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PostCard } from '@/components/PostCard';
import { Spinner } from '@/components/ui';
import { ProfileCard } from './Feed';

export default function PostPage() {
  const { id } = useParams();
  const { data, error } = useQuery({ queryKey: ['post', id], queryFn: () => api.get(`/posts/${id}`) });
  return (
    <div className="mx-auto grid max-w-[1180px] grid-cols-1 gap-5 lg:grid-cols-[225px_minmax(0,1fr)] xl:grid-cols-[225px_minmax(0,1fr)_300px] px-4 py-5">
      <aside className="hidden lg:block"><ProfileCard /></aside>
      <section>{error ? <div className="card p-6">This post is no longer available.</div> : data ? <PostCard post={data} defaultShowComments /> : <Spinner />}</section>
    </div>
  );
}
