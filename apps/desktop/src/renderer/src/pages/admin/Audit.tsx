import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { dateLong } from '@/lib/format';
import { Spinner } from '@/components/ui';

export default function AdminAudit() {
  const q = useInfiniteQuery({
    queryKey: ['admin', 'audit'],
    initialPageParam: '',
    queryFn: ({ pageParam }) => api.get(`/admin/audit?cursor=${pageParam}`),
    getNextPageParam: (l: any) => l.nextCursor ?? undefined,
  });
  const rows = q.data?.pages.flatMap((p: any) => p.items) ?? [];
  return (
    <div className="p-6">
      <h1 className="mb-4 text-xl font-semibold">Audit log</h1>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs text-zinc-500"><tr><th className="p-3">When</th><th className="p-3">Who</th><th className="p-3">Action</th><th className="p-3">Details</th></tr></thead>
          <tbody>
            {rows.map((r: any) => (
              <tr key={r.id} className="border-t border-zinc-100 align-top">
                <td className="whitespace-nowrap p-3 text-xs text-zinc-500">{dateLong(r.createdAt)}</td>
                <td className="p-3">{r.actor.name}</td>
                <td className="p-3"><code className="text-xs font-semibold">{r.action}</code></td>
                <td className="max-w-md truncate p-3 font-mono text-xs text-zinc-500" title={JSON.stringify(r.meta)}>{r.meta ? JSON.stringify(r.meta) : r.target}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {q.isLoading && <Spinner />}
        {q.hasNextPage && <button className="w-full py-3 text-sm font-semibold text-zinc-600 hover:bg-zinc-50" onClick={() => q.fetchNextPage()}>Load more</button>}
      </div>
    </div>
  );
}
