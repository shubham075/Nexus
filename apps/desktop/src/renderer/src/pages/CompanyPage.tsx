import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Briefcase, Check, Globe, Settings } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ErrorText, Spinner } from '@/components/ui';
import { CompanyLogo } from './Companies';
import { jobPlace, label } from './Jobs';

/** Company page (SOT D20): about, follow, join by verified domain or request approval. */

export interface Company {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  coverUrl: string | null;
  about: string | null;
  website: string | null;
  industry: string | null;
  size: string | null;
  joinPolicy: 'AUTO' | 'APPROVAL' | 'INVITE';
  followerCount: number;
  memberCount: number;
  isFollowing: boolean;
  myStatus: 'ACTIVE' | 'PENDING' | null;
  isAdmin: boolean;
  canJoin: 'AUTO' | 'APPROVAL' | null;
}

export default function CompanyPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const refresh = useAuth((s) => s.refresh);
  const key = ['company', id];
  const { data: c, isLoading, error } = useQuery({ queryKey: key, queryFn: () => api.get<Company>(`/companies/${id}`) });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['company'] });
  const follow = useMutation({
    mutationFn: () => (c!.isFollowing ? api.del(`/companies/${c!.id}/follow`) : api.post(`/companies/${c!.id}/follow`)),
    onSuccess: invalidate,
  });
  const join = useMutation({
    mutationFn: () => api.post<{ status: string }>(`/companies/${c!.id}/join`),
    onSuccess: async () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ['companies'] });
      await refresh();
    },
  });

  if (isLoading) return <Spinner />;
  if (!c) return <div className="mx-auto max-w-[900px] p-5"><ErrorText error={error} /></div>;

  return (
    <div className="mx-auto max-w-[900px] space-y-3 px-4 py-5">
      <section className="card overflow-hidden">
        <div
          className="h-40 bg-gradient-to-br from-zinc-200 via-zinc-100 to-zinc-50"
          style={c.coverUrl ? { backgroundImage: `url(${c.coverUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
        />
        <div className="px-6 pb-5">
          <div className="-mt-10 rounded-xl border-4 border-surface bg-surface inline-block">
            <CompanyLogo c={c} size={88} />
          </div>
          <h1 className="mt-2 text-2xl font-semibold">{c.name}</h1>
          <div className="mt-1 text-sm text-zinc-600">
            {[c.industry, c.size && `${c.size} employees`, `${c.followerCount} follower${c.followerCount === 1 ? '' : 's'}`, `${c.memberCount} member${c.memberCount === 1 ? '' : 's'} on Nexus`]
              .filter(Boolean)
              .join(' · ')}
          </div>
          {c.website && (
            <a href={c.website} target="_blank" rel="noreferrer" className="link mt-1 inline-flex items-center gap-1 text-sm">
              <Globe size={14} /> {c.website.replace(/^https?:\/\//, '')}
            </a>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button className={c.isFollowing ? 'btn-outline' : 'btn-primary'} disabled={follow.isPending} onClick={() => follow.mutate()}>
              {c.isFollowing ? <><Check size={16} /> Following</> : '+ Follow'}
            </button>
            {c.myStatus === 'ACTIVE' && <span className="chip"><Check size={12} /> Member</span>}
            {c.myStatus === 'PENDING' && <span className="chip">Request pending</span>}
            {c.canJoin && (
              <button className="btn-outline" disabled={join.isPending} onClick={() => join.mutate()}>
                {c.canJoin === 'AUTO' ? 'Join company' : 'Request to join'}
              </button>
            )}
            {c.isAdmin && (
              <Link to={`/companies/${c.slug}/settings`} className="btn-ghost ml-auto">
                <Settings size={16} /> Company settings
              </Link>
            )}
          </div>
          <ErrorText error={follow.error || join.error} />
        </div>
      </section>

      <section className="card p-6">
        <h2 className="text-lg font-semibold">About</h2>
        <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-700">{c.about || 'No description yet.'}</p>
      </section>

      <CompanyJobs orgId={c.id} />
    </div>
  );
}

/** Public jobs (2d): anyone signed in can see and apply. */
function CompanyJobs({ orgId }: { orgId: string }) {
  const { data } = useQuery({ queryKey: ['jobs', 'company', orgId], queryFn: () => api.get<any[]>(`/jobs?public=true&orgId=${orgId}`) });
  if (!data?.length) return null;
  return (
    <section className="card p-6">
      <h2 className="text-lg font-semibold">Open jobs</h2>
      <div className="mt-2 divide-y divide-zinc-100">
        {data.map((j) => (
          <Link key={j.id} to={`/jobs/${j.id}`} className="flex items-center gap-3 py-3 hover:bg-zinc-50">
            <Briefcase size={18} className="text-zinc-500" />
            <div className="flex-1">
              <div className="font-semibold text-brand-500">{j.title}</div>
              <div className="muted">{jobPlace(j)} · {j.location ? `${j.location} · ` : ''}{label(j.workplace)}</div>
            </div>
            {j.myApplication && <span className="chip">{label(j.myApplication)}</span>}
          </Link>
        ))}
      </div>
    </section>
  );
}
