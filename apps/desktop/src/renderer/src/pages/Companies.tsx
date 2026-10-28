import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Building2, Plus } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Empty, ErrorText, Modal, Spinner } from '@/components/ui';

/** Company directory, my companies, create a company and accept an invite (SOT §14, multi mode). */

export interface CompanyLite {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  industry: string | null;
  about?: string | null;
  followerCount?: number;
  myStatus?: 'ACTIVE' | 'PENDING';
  isAdmin?: boolean;
}

export function CompanyLogo({ c, size = 48 }: { c: { name: string; logoUrl: string | null }; size?: number }) {
  return c.logoUrl ? (
    <img src={c.logoUrl} alt="" className="shrink-0 rounded-lg border border-zinc-200 bg-surface object-cover" style={{ width: size, height: size }} />
  ) : (
    <div className="flex shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500" style={{ width: size, height: size }}>
      <Building2 size={size / 2} />
    </div>
  );
}

function CompanyRow({ c, right }: { c: CompanyLite; right?: React.ReactNode }) {
  return (
    <Link to={`/companies/${c.slug}`} className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-50">
      <CompanyLogo c={c} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold">{c.name}</div>
        <div className="truncate text-sm text-zinc-600">
          {[c.industry, c.followerCount !== undefined ? `${c.followerCount} follower${c.followerCount === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')}
        </div>
      </div>
      {right}
    </Link>
  );
}

export default function Companies() {
  const navigate = useNavigate();
  const location = useLocation();
  const refresh = useAuth((s) => s.refresh);
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [invite, setInvite] = useState(() => new URLSearchParams(location.search).get('token') ?? '');

  const mine = useQuery({ queryKey: ['companies', 'mine'], queryFn: () => api.get<CompanyLite[]>('/companies/mine') });
  const all = useQuery({
    queryKey: ['companies', 'list', q],
    queryFn: () => api.get<{ items: CompanyLite[] }>(`/companies${qs({ q: q.trim() || undefined })}`),
  });
  const accept = useMutation({
    mutationFn: () => api.post<CompanyLite>('/companies/invites/accept', { token: invite.trim() }),
    onSuccess: async (c) => {
      await refresh();
      navigate(`/companies/${c.slug}`);
    },
  });

  return (
    <div className="mx-auto grid max-w-[1000px] grid-cols-1 gap-5 px-4 py-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <section className="card overflow-hidden">
        <div className="flex items-center gap-3 border-b border-zinc-200 p-4">
          <h1 className="text-lg font-semibold">Companies</h1>
          <input className="input ml-auto max-w-[260px]" placeholder="Search companies" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {all.isLoading ? (
          <Spinner />
        ) : all.data?.items.length ? (
          <div className="divide-y divide-zinc-100">{all.data.items.map((c) => <CompanyRow key={c.id} c={c} />)}</div>
        ) : (
          <Empty icon={<Building2 size={32} />} title="No companies found" />
        )}
      </section>

      <aside className="space-y-4">
        <section className="card p-4">
          <button className="btn-primary w-full" onClick={() => setCreating(true)}>
            <Plus size={16} /> Create a company
          </button>
          <p className="mt-2 text-xs text-zinc-500">You become its admin and can claim its email domain.</p>
        </section>

        <section className="card overflow-hidden">
          <h2 className="border-b border-zinc-200 px-4 py-3 text-sm font-semibold">My companies</h2>
          {mine.data?.length ? (
            <div className="divide-y divide-zinc-100">
              {mine.data.map((c) => (
                <CompanyRow key={c.id} c={c} right={c.myStatus === 'PENDING' ? <span className="text-xs text-zinc-500">Pending</span> : c.isAdmin ? <span className="text-xs text-zinc-500">Admin</span> : null} />
              ))}
            </div>
          ) : (
            <p className="px-4 py-3 text-sm text-zinc-500">You haven't joined a company yet.</p>
          )}
        </section>

        <section className="card p-4">
          <h2 className="text-sm font-semibold">Have an invitation?</h2>
          <form
            className="mt-2 space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              accept.mutate();
            }}
          >
            <input className="input" placeholder="Paste the invitation link" value={invite} onChange={(e) => setInvite(e.target.value)} required />
            <ErrorText error={accept.error} />
            <button className="btn-outline w-full" disabled={accept.isPending}>Accept invitation</button>
          </form>
        </section>
      </aside>

      {creating && <CreateCompany onClose={() => setCreating(false)} />}
    </div>
  );
}

function CreateCompany({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const refresh = useAuth((s) => s.refresh);
  const [form, setForm] = useState({ name: '', website: '', industry: '', about: '' });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });
  const create = useMutation({
    mutationFn: () => api.post<CompanyLite>('/companies', form),
    onSuccess: async (c) => {
      await refresh();
      navigate(`/companies/${c.slug}/settings`);
    },
  });
  return (
    <Modal
      title="Create a company"
      onClose={onClose}
      footer={
        <button className="btn-primary" disabled={!form.name.trim() || create.isPending} onClick={() => create.mutate()}>
          {create.isPending ? 'Creating…' : 'Create'}
        </button>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="label">Name</label>
          <input className="input" value={form.name} onChange={set('name')} autoFocus />
        </div>
        <div>
          <label className="label">Website</label>
          <input className="input" placeholder="acme.com" value={form.website} onChange={set('website')} />
        </div>
        <div>
          <label className="label">Industry</label>
          <input className="input" value={form.industry} onChange={set('industry')} />
        </div>
        <div>
          <label className="label">About</label>
          <textarea className="input min-h-[90px]" value={form.about} onChange={set('about')} />
        </div>
        <ErrorText error={create.error} />
      </div>
    </Modal>
  );
}
