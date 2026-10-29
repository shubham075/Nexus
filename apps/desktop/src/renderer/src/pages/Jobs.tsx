import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark, Briefcase, Globe, Plus, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth, useCan } from '@/lib/auth';
import { ago } from '@/lib/format';
import { Empty, ErrorText, Modal, Spinner, Tabs } from '@/components/ui';
import { NodeSelect } from '@/components/NodeSelect';

export function JobForm({ initial, onClose }: { initial?: any; onClose: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const multi = useAuth((s) => s.me?.tenancy === 'multi');
  const [f, setF] = useState({
    title: initial?.title ?? '', description: initial?.description ?? '', location: initial?.location ?? '',
    workplace: initial?.workplace ?? 'ONSITE', employment: initial?.employment ?? 'FULL_TIME', skills: (initial?.skills ?? []).join(', '), nodeId: initial?.nodeId ?? null,
    isPublic: initial?.isPublic ?? false,
  });
  const save = useMutation({
    mutationFn: () => {
      const { isPublic, ...rest } = f;
      const body = { ...rest, ...(multi ? { isPublic } : {}), skills: f.skills.split(',').map((s: string) => s.trim()).filter(Boolean) };
      return initial ? api.patch(`/jobs/${initial.id}`, body) : api.post('/jobs', body);
    },
    onSuccess: (j) => { qc.invalidateQueries({ queryKey: ['jobs'] }); qc.invalidateQueries({ queryKey: ['job'] }); onClose(); if (!initial) navigate(`/jobs/${j.id}`); },
  });
  return (
    <Modal title={initial ? 'Edit job' : 'Post a job'} width={680} onClose={onClose} footer={<button className="btn-primary" disabled={!f.title || !f.description} onClick={() => save.mutate()}>{initial ? 'Save' : 'Post job'}</button>}>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><label className="label">Job title *</label><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
        <div><label className="label">Hiring unit</label><NodeSelect value={f.nodeId} onChange={(nodeId) => setF({ ...f, nodeId })} placeholder="Company-wide" /></div>
        <div><label className="label">Location</label><input className="input" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></div>
        <div><label className="label">Workplace</label><select className="input" value={f.workplace} onChange={(e) => setF({ ...f, workplace: e.target.value })}>{['ONSITE', 'HYBRID', 'REMOTE'].map((w) => <option key={w}>{w}</option>)}</select></div>
        <div><label className="label">Employment</label><select className="input" value={f.employment} onChange={(e) => setF({ ...f, employment: e.target.value })}>{['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP'].map((w) => <option key={w}>{w}</option>)}</select></div>
        <div className="col-span-2"><label className="label">Skills (comma separated)</label><input className="input" value={f.skills} onChange={(e) => setF({ ...f, skills: e.target.value })} /></div>
        <div className="col-span-2"><label className="label">Description *</label><textarea className="input" rows={8} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
        {multi && (
          <label className="col-span-2 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.isPublic} onChange={(e) => setF({ ...f, isPublic: e.target.checked })} />
            Public: show on the company page and in everyone's job search (otherwise only colleagues see it)
          </label>
        )}
      </div>
      <ErrorText error={save.error} />
    </Modal>
  );
}

export const label = (s: string) => s.toLowerCase().replace('_', '-');

/** Company and hiring unit. */
export const jobPlace = (j: any) => [j.org?.name, j.node?.name ?? 'Company-wide'].filter(Boolean).join(' · ');

export default function Jobs() {
  const canPost = useCan('job.create');
  const multi = useAuth((s) => s.me?.tenancy === 'multi');
  const qc = useQueryClient();
  const [tab, setTab] = useState<'browse' | 'public' | 'saved' | 'applied' | 'posted'>('browse');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [posting, setPosting] = useState(false);
  const path = tab === 'saved' ? '/jobs?saved=true' : tab === 'posted' ? '/jobs?mine=true' : `/jobs?q=${encodeURIComponent(search)}${tab === 'public' ? '&public=true' : ''}`;
  const jobs = useQuery({ queryKey: ['jobs', tab, search], queryFn: () => api.get<any[]>(path), enabled: tab !== 'applied' });
  const apps = useQuery({ queryKey: ['jobs', 'applications'], queryFn: () => api.get<any[]>('/jobs/applications/mine'), enabled: tab === 'applied' });
  const save = useMutation({ mutationFn: (id: string) => api.post(`/jobs/${id}/save`), onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }) });

  return (
    <div className="mx-auto max-w-[860px] space-y-2 px-4 py-5">
      <div className="card">
        <div className="flex items-center gap-2 px-4 pt-3">
          <h1 className="text-xl font-semibold">{multi ? 'Jobs' : 'Internal jobs'}</h1>
          <form className="relative ml-auto w-72" onSubmit={(e) => { e.preventDefault(); setSearch(q); if (tab !== 'public') setTab('browse'); }}>
            <Search size={16} className="absolute left-3 top-2.5 text-zinc-500" />
            <input className="input pl-9" placeholder="Title, skill or location" value={q} onChange={(e) => setQ(e.target.value)} />
          </form>
          {canPost && <button className="btn-primary" onClick={() => setPosting(true)}><Plus size={16} /> Post job</button>}
        </div>
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[{ value: 'browse', label: 'Recommended' }, ...(multi ? [{ value: 'public' as const, label: 'Public jobs' }] : []), { value: 'saved', label: 'Saved' }, { value: 'applied', label: 'Applied' }, ...(canPost ? [{ value: 'posted' as const, label: 'Posted by me' }] : [])]}
        />
        {(jobs.isLoading || apps.isLoading) && <Spinner />}
        {tab !== 'applied' && (
          <div className="divide-y divide-zinc-100">
            {(jobs.data ?? []).map((j) => (
              <div key={j.id} className="flex gap-3 px-4 py-4 hover:bg-zinc-50">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded bg-sky-100 text-sky-700"><Briefcase /></div>
                <Link to={`/jobs/${j.id}`} className="flex-1">
                  <div className="font-semibold text-brand-500 hover:underline">{j.title}</div>
                  <div className="text-sm">{jobPlace(j)}{j.isPublic && <span className="muted"> · <Globe size={12} className="inline" /> Public</span>}</div>
                  <div className="muted">{j.location} ({label(j.workplace)}) · {label(j.employment)}</div>
                  <div className="muted mt-1">{ago(j.createdAt)} ago · {j.applicantCount} applicant{j.applicantCount === 1 ? '' : 's'}{j.myApplication && <b className="text-green-700"> · Applied ({label(j.myApplication)})</b>}{j.status === 'CLOSED' && <b className="text-red-600"> · Closed</b>}</div>
                </Link>
                <button className="self-start rounded-full p-2 hover:bg-zinc-200" title={j.saved ? 'Unsave' : 'Save'} onClick={() => save.mutate(j.id)}><Bookmark size={18} fill={j.saved ? 'currentColor' : 'none'} /></button>
              </div>
            ))}
            {!jobs.isLoading && !jobs.data?.length && <Empty icon={<Briefcase size={40} />} title="No jobs found" />}
          </div>
        )}
        {tab === 'applied' && (
          <div className="divide-y divide-zinc-100">
            {(apps.data ?? []).map((a) => (
              <Link key={a.id} to={`/jobs/${a.job.id}`} className="flex items-center justify-between px-4 py-4 hover:bg-zinc-50">
                <div><div className="font-semibold">{a.job.title}</div><div className="muted">{a.job.node?.name} · applied {ago(a.createdAt)} ago</div></div>
                <span className="chip">{label(a.status)}</span>
              </Link>
            ))}
            {!apps.isLoading && !apps.data?.length && <Empty title="No applications yet" />}
          </div>
        )}
      </div>
      {posting && <JobForm onClose={() => setPosting(false)} />}
    </div>
  );
}
