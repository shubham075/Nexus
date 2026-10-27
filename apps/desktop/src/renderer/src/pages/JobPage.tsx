import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark, Briefcase } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ago } from '@/lib/format';
import { ErrorText, Modal, Spinner, UserLine } from '@/components/ui';
import { JobForm, label } from './Jobs';

const STATUSES = ['APPLIED', 'REVIEWING', 'INTERVIEW', 'OFFER', 'REJECTED', 'HIRED'];

function Applicants({ jobId }: { jobId: string }) {
  const qc = useQueryClient();
  const { data = [] } = useQuery({ queryKey: ['job', jobId, 'applications'], queryFn: () => api.get<any[]>(`/jobs/${jobId}/applications`) });
  const set = useMutation({ mutationFn: ({ id, status }: { id: string; status: string }) => api.patch(`/jobs/${jobId}/applications/${id}`, { status }), onSuccess: () => qc.invalidateQueries({ queryKey: ['job', jobId] }) });
  return (
    <div className="card p-5">
      <h2 className="mb-3 text-lg font-semibold">Applicants ({data.length})</h2>
      <div className="space-y-4">
        {data.map((a) => (
          <div key={a.id} className="rounded-lg border border-zinc-200 p-3">
            <UserLine
              user={a.user}
              sub={`${a.user.email} · applied ${ago(a.createdAt)} ago`}
              right={<select className="input w-36 py-1" value={a.status} onChange={(e) => set.mutate({ id: a.id, status: e.target.value })}>{STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>}
            />
            {a.note && <p className="mt-2 whitespace-pre-wrap rounded bg-zinc-50 p-2 text-sm">{a.note}</p>}
          </div>
        ))}
        {!data.length && <div className="muted">No applicants yet.</div>}
      </div>
    </div>
  );
}

export default function JobPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const me = useAuth((s) => s.me!);
  const [modal, setModal] = useState<null | 'apply' | 'edit'>(null);
  const [note, setNote] = useState('');
  const { data: j } = useQuery({ queryKey: ['job', id], queryFn: () => api.get(`/jobs/${id}`) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['job', id] }); qc.invalidateQueries({ queryKey: ['jobs'] }); };
  const apply = useMutation({ mutationFn: () => api.post(`/jobs/${id}/apply`, { note }), onSuccess: () => { setModal(null); refresh(); } });
  const save = useMutation({ mutationFn: () => api.post(`/jobs/${id}/save`), onSuccess: refresh });
  const toggle = useMutation({ mutationFn: () => api.patch(`/jobs/${id}`, { status: j.status === 'OPEN' ? 'CLOSED' : 'OPEN' }), onSuccess: refresh });
  if (!j) return <Spinner />;

  return (
    <div className="mx-auto max-w-[860px] space-y-2 px-4 py-5">
      <div className="card p-6">
        <div className="flex gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded bg-sky-100 text-sky-700"><Briefcase size={28} /></div>
          <div className="flex-1">
            <h1 className="text-2xl font-semibold">{j.title}</h1>
            <div className="text-sm">{j.node?.name ?? 'Company-wide'} · {j.location}</div>
            <div className="muted">Posted {ago(j.createdAt)} ago by {j.poster.name} · {j.applicantCount} applicants</div>
            <div className="mt-2 flex flex-wrap gap-1">
              <span className="chip">{label(j.workplace)}</span>
              <span className="chip">{label(j.employment)}</span>
              {j.status === 'CLOSED' && <span className="chip border-red-300 text-red-600">Closed</span>}
            </div>
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          {j.myApplication ? (
            <button className="btn-primary" disabled>Applied · {label(j.myApplication.status)}</button>
          ) : (
            j.status === 'OPEN' && j.poster.id !== me.id && <button className="btn-primary" onClick={() => setModal('apply')}>Easy Apply</button>
          )}
          <button className="btn-outline" onClick={() => save.mutate()}><Bookmark size={16} fill={j.saved ? 'currentColor' : 'none'} /> {j.saved ? 'Saved' : 'Save'}</button>
          {j.canManage && <button className="btn-ghost" onClick={() => setModal('edit')}>Edit</button>}
          {j.canManage && <button className="btn-ghost" onClick={() => toggle.mutate()}>{j.status === 'OPEN' ? 'Close job' : 'Reopen job'}</button>}
        </div>
        {j.skills.length > 0 && (
          <div className="mt-5">
            <h2 className="font-semibold">Skills</h2>
            <div className="mt-1 flex flex-wrap gap-1">{j.skills.map((s: string) => <span key={s} className="chip">{s}</span>)}</div>
          </div>
        )}
        <h2 className="mt-5 font-semibold">About the job</h2>
        <p className="mt-1 whitespace-pre-wrap text-sm leading-6">{j.description}</p>
      </div>
      {j.canManage && <Applicants jobId={j.id} />}
      {modal === 'apply' && (
        <Modal title={`Apply to ${j.title}`} onClose={() => setModal(null)} footer={<button className="btn-primary" onClick={() => apply.mutate()} disabled={apply.isPending}>Submit application</button>}>
          <p className="mb-2 text-sm text-zinc-600">Your Nexus profile will be shared with the hiring team.</p>
          <label className="label">Note to the hiring team</label>
          <textarea className="input" rows={6} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why are you interested in this role?" />
          <ErrorText error={apply.error} />
        </Modal>
      )}
      {modal === 'edit' && <JobForm initial={j} onClose={() => setModal(null)} />}
    </div>
  );
}
