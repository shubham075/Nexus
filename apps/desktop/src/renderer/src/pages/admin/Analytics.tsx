import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Spinner } from '@/components/ui';

function Stat({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs font-semibold uppercase text-zinc-500">{label}</div>
      <div className="mt-1 text-3xl font-semibold tabular-nums">{value.toLocaleString()}</div>
      {sub && <div className="muted">{sub}</div>}
    </div>
  );
}

export default function AdminAnalytics() {
  const { data: d } = useQuery({ queryKey: ['admin', 'analytics'], queryFn: () => api.get('/admin/analytics') });
  if (!d) return <Spinner />;
  const max = Math.max(1, ...d.postsPerDay.map((p: any) => p.count));
  return (
    <div className="space-y-4 p-6">
      <h1 className="text-xl font-semibold">Analytics</h1>
      <div className="grid grid-cols-4 gap-3">
        <Stat label="Active employees" value={d.users} />
        <Stat label="Active today" value={d.activeDay} sub={`${d.activeWeek} this week`} />
        <Stat label="Posts" value={d.posts} sub={`${d.postsWeek} this week`} />
        <Stat label="Open reports" value={d.openReports} />
        <Stat label="Comments" value={d.comments} />
        <Stat label="Reactions" value={d.reactions} />
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_300px] gap-3">
        <div className="card p-4">
          <h2 className="mb-4 font-semibold">Posts per day · last 14 days</h2>
          <div className="flex h-48 items-end gap-2">
            {d.postsPerDay.map((p: any) => (
              <div key={p.day} className="flex flex-1 flex-col items-center gap-1" title={`${p.day}: ${p.count}`}>
                <span className="text-xs tabular-nums text-zinc-600">{p.count}</span>
                <div className="w-full max-w-10 rounded-t bg-brand-500" style={{ height: `${(p.count / max) * 150}px` }} />
                <span className="text-[10px] text-zinc-500">{p.day.slice(5)}</span>
              </div>
            ))}
            {!d.postsPerDay.length && <div className="muted">No posts in this period.</div>}
          </div>
        </div>
        <div className="card p-4">
          <h2 className="mb-3 font-semibold">Top hashtags</h2>
          {d.topHashtags.map((t: any) => (
            <div key={t.tag} className="flex justify-between py-1 text-sm"><span>#{t.tag}</span><span className="tabular-nums text-zinc-500">{t.count}</span></div>
          ))}
        </div>
      </div>
    </div>
  );
}
