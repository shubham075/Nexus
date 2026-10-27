import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dateLong } from '@/lib/format';
import { Spinner, UserLine } from '@/components/ui';
import { Markdown } from './ArticleEditor';

export default function ArticlePage() {
  const { id } = useParams();
  const me = useAuth((s) => s.me!);
  const navigate = useNavigate();
  const { data: a } = useQuery({ queryKey: ['article', id], queryFn: () => api.get(`/articles/${id}`) });
  const del = useMutation({ mutationFn: () => api.del(`/articles/${id}`), onSuccess: () => navigate('/articles') });
  if (!a) return <Spinner />;
  return (
    <div className="mx-auto max-w-[760px] px-4 py-5">
      <article className="card overflow-hidden">
        {a.coverUrl && <img src={a.coverUrl} className="max-h-80 w-full object-cover" />}
        <div className="p-8">
          {a.newsletter && <div className="mb-2 text-sm font-semibold text-orange-700">{a.newsletter.title}</div>}
          <h1 className="text-3xl font-bold leading-tight">{a.title}</h1>
          <div className="my-5"><UserLine user={a.author} sub={`Published ${dateLong(a.publishedAt)}`} /></div>
          <Markdown text={a.body} />
          <div className="mt-8 flex gap-2 border-t border-zinc-200 pt-4">
            {a.post && <Link to={`/post/${a.post.id}`} className="btn-outline">React & comment</Link>}
            {a.author.id === me.id && <Link to={`/articles/${a.id}/edit`} className="btn-ghost">Edit</Link>}
            {a.author.id === me.id && <button className="btn-ghost text-red-600" onClick={() => confirm('Delete article?') && del.mutate()}>Delete</button>}
          </div>
        </div>
      </article>
    </div>
  );
}
