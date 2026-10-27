import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Flag } from 'lucide-react';
import { api } from '@/lib/api';
import { ago } from '@/lib/format';
import { Empty, ErrorText, RichText, Spinner, Tabs, UserLine } from '@/components/ui';

export default function AdminReports() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<'OPEN' | 'ACTIONED' | 'DISMISSED'>('OPEN');
  const { data, isLoading } = useQuery({ queryKey: ['admin', 'reports', status], queryFn: () => api.get<any[]>(`/reports?status=${status}`) });
  const resolve = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) => api.post(`/reports/${id}/resolve`, { action }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'reports'] }),
  });
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold">Moderation queue</h1>
      <p className="mb-4 text-sm text-zinc-500">You only see reports about people inside your moderation scope in the hierarchy.</p>
      <div className="card">
        <Tabs value={status} onChange={setStatus} tabs={[{ value: 'OPEN', label: 'Open' }, { value: 'ACTIONED', label: 'Actioned' }, { value: 'DISMISSED', label: 'Dismissed' }]} />
        <ErrorText error={resolve.error} />
        {isLoading && <Spinner />}
        <div className="divide-y divide-zinc-100">
          {(data ?? []).map((r) => {
            const content = r.post ?? r.comment;
            return (
              <div key={r.id} className="space-y-2 p-4">
                <div className="flex items-center justify-between text-xs text-zinc-500">
                  <span><b className="text-red-600">{r.reason.toLowerCase()}</b> · reported by {r.reporter.name} {ago(r.createdAt)} ago</span>
                  {r.reviewer && <span>Resolved by {r.reviewer.name}: {r.resolution}</span>}
                </div>
                {r.details && <div className="text-sm italic text-zinc-600">“{r.details}”</div>}
                {content ? (
                  <div className="rounded-lg border border-zinc-200 p-3">
                    <UserLine user={content.author} size={32} sub={r.comment ? 'Comment' : 'Post'} />
                    <div className="mt-2 text-sm"><RichText text={content.body} clamp /></div>
                    <Link className="link mt-1 inline-block text-xs" to={`/post/${r.post?.id ?? r.comment?.postId}`}>Open in context</Link>
                  </div>
                ) : (
                  <div className="muted">Content was removed.</div>
                )}
                {status === 'OPEN' && (
                  <div className="flex gap-2">
                    <button className="btn-ghost py-1" onClick={() => resolve.mutate({ id: r.id, action: 'DISMISS' })}>Dismiss</button>
                    <button className="btn-outline py-1" onClick={() => resolve.mutate({ id: r.id, action: 'WARN' })}>Warn author</button>
                    <button className="btn-outline py-1" onClick={() => resolve.mutate({ id: r.id, action: 'HIDE' })}>Hide</button>
                    <button className="btn-danger py-1" onClick={() => confirm('Delete permanently?') && resolve.mutate({ id: r.id, action: 'DELETE' })}>Delete</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {!isLoading && !data?.length && <Empty icon={<Flag size={36} />} title="Nothing to review" />}
      </div>
    </div>
  );
}
