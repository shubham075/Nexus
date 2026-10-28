import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Copy, Trash2, X } from 'lucide-react';
import { IMAGE_ACCEPT } from '@nexus/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useToasts } from '@/lib/toast';
import { ErrorText, Spinner, Tabs, UserLine } from '@/components/ui';
import { CompanyLogo } from './Companies';
import type { Company } from './CompanyPage';

/** Company admin settings (SOT D22): profile, email domains (DNS TXT), join policy, requests and invites. */

type Tab = 'profile' | 'domains' | 'people';

export default function CompanySettings() {
  const { id } = useParams();
  const [tab, setTab] = useState<Tab>('profile');
  const { data: c, isLoading, error } = useQuery({ queryKey: ['company', id], queryFn: () => api.get<Company>(`/companies/${id}`) });

  if (isLoading) return <Spinner />;
  if (!c) return <div className="mx-auto max-w-[760px] p-5"><ErrorText error={error} /></div>;
  if (!c.isAdmin) return <div className="mx-auto max-w-[760px] p-5"><ErrorText error={new Error('Only company admins can change these settings.')} /></div>;

  return (
    <div className="mx-auto max-w-[760px] px-4 py-5">
      <Link to={`/companies/${c.slug}`} className="mb-3 inline-flex items-center gap-1 text-sm text-zinc-600 hover:underline">
        <ArrowLeft size={14} /> {c.name}
      </Link>
      <section className="card overflow-hidden">
        <Tabs value={tab} onChange={setTab} tabs={[{ value: 'profile', label: 'Profile' }, { value: 'domains', label: 'Domains' }, { value: 'people', label: 'Requests & invites' }]} />
        <div className="p-5">
          {tab === 'profile' && <Profile c={c} />}
          {tab === 'domains' && <Domains c={c} />}
          {tab === 'people' && <People c={c} />}
        </div>
      </section>
    </div>
  );
}

const POLICIES: { value: Company['joinPolicy']; label: string; hint: string }[] = [
  { value: 'AUTO', label: 'Automatic', hint: 'People with a verified company email join straight away.' },
  { value: 'APPROVAL', label: 'Approval', hint: 'People with a verified company email ask to join; an admin approves.' },
  { value: 'INVITE', label: 'Invite only', hint: 'Only people you invite by email can join.' },
];

function Profile({ c }: { c: Company }) {
  const qc = useQueryClient();
  const refresh = useAuth((s) => s.refresh);
  const [form, setForm] = useState({ name: c.name, website: c.website ?? '', industry: c.industry ?? '', size: c.size ?? '', about: c.about ?? '', joinPolicy: c.joinPolicy });
  useEffect(() => {
    setForm({ name: c.name, website: c.website ?? '', industry: c.industry ?? '', size: c.size ?? '', about: c.about ?? '', joinPolicy: c.joinPolicy });
  }, [c]);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch(`/companies/${c.id}`, body),
    onSuccess: async () => {
      qc.invalidateQueries({ queryKey: ['company'] });
      qc.invalidateQueries({ queryKey: ['companies'] });
      await refresh();
      useToasts.getState().push('Company updated', 'info');
    },
  });
  const upload = async (kind: 'logoUrl' | 'coverUrl', files: FileList | null) => {
    if (!files?.[0]) return;
    const [m] = await api.upload([files[0]]);
    save.mutate({ [kind]: m.url });
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(form);
      }}
    >
      <div className="flex items-center gap-4">
        <CompanyLogo c={c} size={64} />
        <label className="btn-outline cursor-pointer">
          Change logo
          <input type="file" hidden accept={IMAGE_ACCEPT} onChange={(e) => upload('logoUrl', e.target.files)} />
        </label>
        <label className="btn-outline cursor-pointer">
          Change cover
          <input type="file" hidden accept={IMAGE_ACCEPT} onChange={(e) => upload('coverUrl', e.target.files)} />
        </label>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Name</label>
          <input className="input" value={form.name} onChange={set('name')} required />
        </div>
        <div>
          <label className="label">Website</label>
          <input className="input" value={form.website} onChange={set('website')} />
        </div>
        <div>
          <label className="label">Industry</label>
          <input className="input" value={form.industry} onChange={set('industry')} />
        </div>
        <div>
          <label className="label">Size</label>
          <input className="input" placeholder="e.g. 51-200" value={form.size} onChange={set('size')} />
        </div>
      </div>
      <div>
        <label className="label">About</label>
        <textarea className="input min-h-[110px]" value={form.about} onChange={set('about')} />
      </div>
      <fieldset>
        <legend className="label">Who can join</legend>
        <div className="space-y-2">
          {POLICIES.map((p) => (
            <label key={p.value} className="flex cursor-pointer items-start gap-2 text-sm">
              <input type="radio" className="mt-1 accent-zinc-900" checked={form.joinPolicy === p.value} onChange={() => setForm({ ...form, joinPolicy: p.value })} />
              <span>
                <span className="font-medium">{p.label}</span>
                <span className="block text-xs text-zinc-500">{p.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <ErrorText error={save.error} />
      <div className="flex justify-end">
        <button className="btn-primary" disabled={save.isPending}>Save</button>
      </div>
    </form>
  );
}

interface Domain {
  id: string;
  domain: string;
  verifiedAt: string | null;
  txtName: string;
  txtValue: string;
}

function Domains({ c }: { c: Company }) {
  const qc = useQueryClient();
  const key = ['company-domains', c.id];
  const { data } = useQuery({ queryKey: key, queryFn: () => api.get<Domain[]>(`/companies/${c.id}/domains`) });
  const [domain, setDomain] = useState('');
  const invalidate = () => qc.invalidateQueries({ queryKey: key });
  const add = useMutation({ mutationFn: () => api.post(`/companies/${c.id}/domains`, { domain }), onSuccess: () => { setDomain(''); invalidate(); } });
  const verify = useMutation({ mutationFn: (d: string) => api.post(`/companies/${c.id}/domains/${d}/verify`), onSuccess: invalidate });
  const remove = useMutation({ mutationFn: (d: string) => api.del(`/companies/${c.id}/domains/${d}`), onSuccess: invalidate });
  const copy = (v: string) => navigator.clipboard.writeText(v).then(() => useToasts.getState().push('Copied', 'info'));

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-600">
        Claim your company's email domain so colleagues can join with their work email. Add the TXT record shown below at your DNS provider, then
        press Verify.
      </p>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <input className="input" placeholder="acme.com" value={domain} onChange={(e) => setDomain(e.target.value)} required />
        <button className="btn-primary shrink-0" disabled={add.isPending}>Add domain</button>
      </form>
      <ErrorText error={add.error || verify.error || remove.error} />
      <div className="divide-y divide-zinc-100 rounded-lg border border-zinc-200">
        {data?.length === 0 && <p className="p-4 text-sm text-zinc-500">No domains yet.</p>}
        {data?.map((d) => (
          <div key={d.id} className="space-y-2 p-4">
            <div className="flex items-center gap-2">
              <span className="font-medium">{d.domain}</span>
              {d.verifiedAt ? <span className="chip"><Check size={12} /> Verified</span> : <span className="chip">Not verified</span>}
              <div className="ml-auto flex gap-1">
                {!d.verifiedAt && (
                  <button className="btn-outline" disabled={verify.isPending} onClick={() => verify.mutate(d.id)}>Verify</button>
                )}
                <button className="btn-ghost" title="Remove" onClick={() => remove.mutate(d.id)}><Trash2 size={16} /></button>
              </div>
            </div>
            {!d.verifiedAt && (
              <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-md bg-zinc-50 p-3 text-xs">
                <span className="text-zinc-500">Type</span>
                <code>TXT</code>
                <span />
                <span className="text-zinc-500">Host</span>
                <code className="truncate">{d.txtName}</code>
                <button className="btn-ghost px-2 py-0.5" title="Copy" onClick={() => copy(d.txtName)}><Copy size={13} /></button>
                <span className="text-zinc-500">Value</span>
                <code className="truncate">{d.txtValue}</code>
                <button className="btn-ghost px-2 py-0.5" title="Copy" onClick={() => copy(d.txtValue)}><Copy size={13} /></button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

interface JoinRequest {
  requestedAt: string;
  user: { id: string; name: string; headline: string | null; avatarUrl: string | null; email: string };
}
interface Invite {
  id: string;
  email: string;
  createdAt: string;
  expiresAt: string;
}

function People({ c }: { c: Company }) {
  const qc = useQueryClient();
  const requests = useQuery({ queryKey: ['company-requests', c.id], queryFn: () => api.get<JoinRequest[]>(`/companies/${c.id}/requests`) });
  const invites = useQuery({ queryKey: ['company-invites', c.id], queryFn: () => api.get<Invite[]>(`/companies/${c.id}/invites`) });
  const [email, setEmail] = useState('');
  const decide = useMutation({
    mutationFn: (v: { userId: string; approve: boolean }) => api.post(`/companies/${c.id}/requests/${v.userId}`, { approve: v.approve }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['company-requests', c.id] });
      qc.invalidateQueries({ queryKey: ['company'] });
    },
  });
  const invite = useMutation({
    mutationFn: () => api.post(`/companies/${c.id}/invites`, { email }),
    onSuccess: () => {
      useToasts.getState().push(`Invitation sent to ${email}`, 'info');
      setEmail('');
      qc.invalidateQueries({ queryKey: ['company-invites', c.id] });
    },
  });
  const revoke = useMutation({
    mutationFn: (inviteId: string) => api.del(`/companies/${c.id}/invites/${inviteId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['company-invites', c.id] }),
  });

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-sm font-semibold">Join requests</h3>
        <ErrorText error={decide.error} />
        {requests.data?.length ? (
          <div className="mt-2 divide-y divide-zinc-100">
            {requests.data.map((r) => (
              <div key={r.user.id} className="py-2">
                <UserLine
                  user={r.user}
                  sub={r.user.email}
                  right={
                    <div className="flex gap-1">
                      <button className="btn-primary" onClick={() => decide.mutate({ userId: r.user.id, approve: true })}>Approve</button>
                      <button className="btn-ghost" title="Reject" onClick={() => decide.mutate({ userId: r.user.id, approve: false })}><X size={16} /></button>
                    </div>
                  }
                />
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-zinc-500">No pending requests.</p>
        )}
      </section>

      <section>
        <h3 className="text-sm font-semibold">Invite by email</h3>
        <p className="mt-1 text-xs text-zinc-500">For people outside your verified domains. The link works for 7 days and only for that address.</p>
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            invite.mutate();
          }}
        >
          <input className="input" type="email" placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <button className="btn-primary shrink-0" disabled={invite.isPending}>Send invite</button>
        </form>
        <ErrorText error={invite.error || revoke.error} />
        {!!invites.data?.length && (
          <div className="mt-3 divide-y divide-zinc-100 rounded-lg border border-zinc-200">
            {invites.data.map((i) => (
              <div key={i.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className="flex-1 truncate">{i.email}</span>
                <span className="text-xs text-zinc-500">expires {new Date(i.expiresAt).toLocaleDateString()}</span>
                <button className="btn-ghost" title="Revoke" onClick={() => revoke.mutate(i.id)}><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
