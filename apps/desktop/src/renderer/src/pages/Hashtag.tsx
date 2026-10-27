import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PostFeed } from '@/components/PostFeed';

export default function Hashtag() {
  const { tag } = useParams();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['hashtag', tag, 'meta'], queryFn: () => api.get(`/posts/hashtag/${tag}?limit=1`) });
  const follow = useMutation({ mutationFn: () => api.post(`/posts/hashtag/${tag}/follow`), onSuccess: () => qc.invalidateQueries({ queryKey: ['hashtag', tag, 'meta'] }) });
  return (
    <div className="mx-auto max-w-[640px] space-y-2 px-4 py-5">
      <div className="card flex items-center justify-between p-5">
        <div>
          <h1 className="text-2xl font-semibold">#{tag}</h1>
          <div className="muted">{data?.followers ?? 0} followers · {data?.postCount ?? 0} posts</div>
        </div>
        <button className={data?.following ? 'btn-outline' : 'btn-primary'} onClick={() => follow.mutate()}>{data?.following ? 'Following' : '+ Follow'}</button>
      </div>
      <PostFeed queryKey={['hashtag', tag]} path={`/posts/hashtag/${tag}`} />
    </div>
  );
}
