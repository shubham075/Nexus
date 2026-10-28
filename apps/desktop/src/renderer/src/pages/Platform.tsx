import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ErrorText, Spinner, Tabs } from '@/components/ui';

/** Platform admin console (multi mode, SOT §14.2): suspend or restore organizations and accounts. */

interface OrgRow { id: string; slug: string; name: string; createdAt: string; suspendedAt: string | null; memberCount: number }
interface UserRow { id: string; name: string; email: string; isActive: boolean; isSuperAdmin: boolean; emailVerifiedAt: string | null }

export default function Platform() {
  const [tab, setTab] = useState<'orgs' | 'users'>('orgs');
  const [q, setQ] = useState('');
  const me = useAuth((s) => s.me!);
  const qc = useQueryClient();
  const orgs = useQuery({ queryKey: ['platform', 'orgs', q], queryFn: () => api.get<{ items: OrgRow[] }>(`/platform/orgs${qs({ q })}`), enabled: tab === 'orgs' });
  const users = useQuery({ queryKey: ['platform', 'users', q], queryFn: () => api.get<{ items: UserRow[] }>(`/platform/users${qs({ q })}`), enabled: tab === 'users' });
  const suspend = useMutation({
    mutationFn: (v: { kind: 'orgs' | 'users'; id: string; suspended: boolean }) => api.post(`/platform/${v.kind}/${v.id}/suspend`, { suspended: v.suspended }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform'] }),
  });
  const list = tab === 'orgs' ? orgs : users;

  return (
    <div className="mx-auto max-w-[900px] px-4 py-5">
      <section className="card overflow-hidden">
        <div className="flex items-center gap-3 border-b border-zinc-200 p-4">
          <h1 className="text-lg font-semibold">Platform admin</h1>
          <input className="input ml-auto max-w-[260px]" placeholder={tab === 'orgs' ? 'Search organizations' : 'Search people'} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Tabs value={tab} onChange={setTab} tabs={[{ value: 'orgs', label: 'Organizations' }, { value: 'users', label: 'People' }]} />
        <ErrorText error={list.error || suspend.error} />
        {list.isLoading && <Spinner />}
        <div className="divide-y divide-zinc-100">
          {tab === 'orgs' &&
            orgs.data?.items.map((o) => (
              <Row
                key={o.id}
                title={o.name}
                sub={`${o.slug} · ${o.memberCount} member${o.memberCount === 1 ? '' : 's'} · since ${new Date(o.createdAt).toLocaleDateString()}`}
                suspended={!!o.suspendedAt}
                onToggle={() => suspend.mutate({ kind: 'orgs', id: o.id, suspended: !o.suspendedAt })}
              />
            ))}
          {tab === 'users' &&
            users.data?.items.map((u) => (
              <Row
                key={u.id}
                title={u.name}
                sub={`${u.email}${u.emailVerifiedAt ? '' : ' · unverified'}${u.isSuperAdmin ? ' · platform admin' : ''}`}
                suspended={!u.isActive}
                onToggle={u.id === me.id ? undefined : () => suspend.mutate({ kind: 'users', id: u.id, suspended: u.isActive })}
              />
            ))}
        </div>
      </section>
    </div>
  );
}

function Row({ title, sub, suspended, onToggle }: { title: string; sub: string; suspended: boolean; onToggle?: () => void }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{title}</div>
        <div className="truncate text-xs text-zinc-500">{sub}</div>
      </div>
      {suspended && <span className="chip text-red-700">Suspended</span>}
      {onToggle && (
        <button className={suspended ? 'btn-outline' : 'btn-ghost text-red-700'} onClick={onToggle}>
          {suspended ? 'Restore' : 'Suspend'}
        </button>
      )}
    </div>
  );
}
