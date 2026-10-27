import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Briefcase, Camera, ChevronRight, GraduationCap, MapPin, MessageSquareText, Pencil, Plus, Trash2, UserCheck, UserPlus } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { monthYear } from '@/lib/format';
import { Avatar, ErrorText, Modal, Spinner, UserLine } from '@/components/ui';
import { PostFeed } from '@/components/PostFeed';
import { Suggestions } from './Feed';

const DEGREE = ['', '1st', '2nd', '3rd+'];

function EditIntro({ user, onClose }: { user: any; onClose: () => void }) {
  const { refresh } = useAuth();
  const qc = useQueryClient();
  const [f, setF] = useState({ name: user.name, headline: user.headline ?? '', about: user.about ?? '', location: user.location ?? '', pronouns: user.pronouns ?? '', openTo: (user.openTo ?? []).join(', ') });
  const save = useMutation({
    mutationFn: () => api.patch('/users/me', { ...f, openTo: f.openTo.split(',').map((s: string) => s.trim()).filter(Boolean) }),
    onSuccess: async () => { await refresh(); qc.invalidateQueries({ queryKey: ['profile'] }); onClose(); },
  });
  const field = (k: keyof typeof f, label: string, area = false) => (
    <div>
      <label className="label">{label}</label>
      {area ? <textarea className="input" rows={5} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /> : <input className="input" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />}
    </div>
  );
  return (
    <Modal title="Edit intro" onClose={onClose} footer={<button className="btn-primary" onClick={() => save.mutate()}>Save</button>}>
      <div className="space-y-3">
        {field('name', 'Name *')}
        {field('pronouns', 'Pronouns')}
        {field('headline', 'Headline')}
        {field('location', 'Location')}
        {field('about', 'About', true)}
        {field('openTo', 'Open to (comma separated, e.g. Mentoring, Internal mobility)')}
        <ErrorText error={save.error} />
      </div>
    </Modal>
  );
}

function ExperienceModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ title: '', company: '', location: '', startDate: '', endDate: '', description: '' });
  const save = useMutation({
    mutationFn: () => api.post('/users/me/experiences', { ...f, endDate: f.endDate || null }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['profile'] }); onClose(); },
  });
  return (
    <Modal title="Add experience" onClose={onClose} footer={<button className="btn-primary" onClick={() => save.mutate()}>Save</button>}>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><label className="label">Title *</label><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
        <div className="col-span-2"><label className="label">Company *</label><input className="input" value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} /></div>
        <div className="col-span-2"><label className="label">Location</label><input className="input" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></div>
        <div><label className="label">Start date *</label><input type="month" className="input" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></div>
        <div><label className="label">End date (blank = present)</label><input type="month" className="input" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></div>
        <div className="col-span-2"><label className="label">Description</label><textarea className="input" rows={4} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
      </div>
      <ErrorText error={save.error} />
    </Modal>
  );
}

function EducationModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ school: '', degree: '', field: '', startDate: '', endDate: '' });
  const save = useMutation({
    mutationFn: () => api.post('/users/me/educations', { ...f, startDate: f.startDate || null, endDate: f.endDate || null }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['profile'] }); onClose(); },
  });
  return (
    <Modal title="Add education" onClose={onClose} footer={<button className="btn-primary" onClick={() => save.mutate()}>Save</button>}>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><label className="label">School *</label><input className="input" value={f.school} onChange={(e) => setF({ ...f, school: e.target.value })} /></div>
        <div><label className="label">Degree</label><input className="input" value={f.degree} onChange={(e) => setF({ ...f, degree: e.target.value })} /></div>
        <div><label className="label">Field of study</label><input className="input" value={f.field} onChange={(e) => setF({ ...f, field: e.target.value })} /></div>
        <div><label className="label">Start</label><input type="month" className="input" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></div>
        <div><label className="label">End</label><input type="month" className="input" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></div>
      </div>
      <ErrorText error={save.error} />
    </Modal>
  );
}

function Section({ title, onAdd, children }: { title: string; onAdd?: () => void; children: React.ReactNode }) {
  return (
    <section className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{title}</h2>
        {onAdd && <button className="rounded-full p-1.5 hover:bg-zinc-100" onClick={onAdd}><Plus size={20} /></button>}
      </div>
      {children}
    </section>
  );
}

export default function Profile() {
  const { id } = useParams();
  const me = useAuth((s) => s.me!);
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [modal, setModal] = useState<null | 'intro' | 'exp' | 'edu'>(null);
  const [skill, setSkill] = useState('');
  const [tab, setTab] = useState<'about' | 'activity'>('about');
  const { data: u, isLoading } = useQuery({ queryKey: ['profile', id], queryFn: () => api.get(`/users/${id}`) });
  const isMe = u?.id === me.id;
  const invalidate = () => qc.invalidateQueries({ queryKey: ['profile', id] });

  const connect = useMutation({ mutationFn: () => api.post('/network/connect', { userId: u.id }), onSuccess: invalidate });
  const accept = useMutation({ mutationFn: () => api.post(`/network/invitations/${u.pendingConnection.id}/accept`), onSuccess: invalidate });
  const follow = useMutation({ mutationFn: () => api.post(`/network/follow/${u.id}`), onSuccess: invalidate });
  const removeConn = useMutation({ mutationFn: () => api.del(`/network/connections/${u.id}`), onSuccess: invalidate });
  const endorse = useMutation({ mutationFn: (skillId: string) => api.post(`/users/skills/${skillId}/endorse`), onSuccess: invalidate });
  const addSkill = useMutation({ mutationFn: () => api.post('/users/me/skills', { name: skill }), onSuccess: () => { setSkill(''); invalidate(); } });
  const delSkill = useMutation({ mutationFn: (sid: string) => api.del(`/users/me/skills/${sid}`), onSuccess: invalidate });
  const delExp = useMutation({ mutationFn: (eid: string) => api.del(`/users/me/experiences/${eid}`), onSuccess: invalidate });
  const delEdu = useMutation({ mutationFn: (eid: string) => api.del(`/users/me/educations/${eid}`), onSuccess: invalidate });
  const message = useMutation({ mutationFn: () => api.post('/conversations', { userIds: [u.id] }), onSuccess: (c) => navigate(`/messaging/${c.id}`) });

  async function uploadImage(kind: 'avatarUrl' | 'coverUrl', files: FileList | null) {
    if (!files?.[0]) return;
    const [m] = await api.upload([files[0]]);
    await api.patch('/users/me', { [kind]: m.url });
    await refresh();
    invalidate();
  }

  if (isLoading || !u) return <Spinner />;

  return (
    <div className="mx-auto grid max-w-[1130px] grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-5 px-4 py-5">
      <div className="space-y-2">
        <section className="card overflow-hidden">
          <div className="relative h-48 bg-gradient-to-br from-zinc-200 via-zinc-100 to-zinc-50" style={u.coverUrl ? { backgroundImage: `url(${u.coverUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}>
            {isMe && (
              <label className="absolute right-4 top-4 cursor-pointer rounded-full bg-white p-2 text-brand-500 shadow" title="Change cover">
                <Camera size={18} />
                <input type="file" hidden accept="image/*" onChange={(e) => uploadImage('coverUrl', e.target.files)} />
              </label>
            )}
          </div>
          <div className="px-6 pb-5">
            <div className="-mt-20 flex items-end justify-between">
              <label className={`rounded-full border-4 border-white ${isMe ? 'cursor-pointer' : ''}`} title={isMe ? 'Change photo' : undefined}>
                <Avatar user={u} size={152} />
                {isMe && <input type="file" hidden accept="image/*" onChange={(e) => uploadImage('avatarUrl', e.target.files)} />}
              </label>
              {isMe && <button className="rounded-full p-2 hover:bg-zinc-100" onClick={() => setModal('intro')}><Pencil size={20} /></button>}
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <h1 className="text-2xl font-semibold">{u.name}</h1>
              {u.pronouns && <span className="text-sm text-zinc-500">({u.pronouns})</span>}
              {!isMe && u.degree > 0 && <span className="text-sm text-zinc-500">· {DEGREE[u.degree]}</span>}
            </div>
            <div className="text-base">{u.headline}</div>
            <div className="mt-1 flex items-center gap-1 text-sm text-zinc-500">
              {u.location && <><MapPin size={14} /> {u.location} · </>}
              <Link to={`/profile/${u.id}`} className="link">{u.connections} connection{u.connections === 1 ? '' : 's'}</Link>
              <span>· {u._count.followers} followers</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {u.memberships.map((m: any) => (
                <Link key={m.node.id} to={`/org?node=${m.node.id}`} className="chip">
                  {m.title ? `${m.title} · ` : ''}{m.node.name}{m.isPrimary ? ' ★' : ''}
                </Link>
              ))}
            </div>
            {!isMe && (
              <div className="mt-4 flex gap-2">
                {u.degree === 1 ? (
                  <button className="btn-primary" onClick={() => message.mutate()}><MessageSquareText size={16} /> Message</button>
                ) : u.pendingConnection?.outgoing ? (
                  <button className="btn-outline" disabled>Pending</button>
                ) : u.pendingConnection ? (
                  <button className="btn-primary" onClick={() => accept.mutate()}><UserCheck size={16} /> Accept invitation</button>
                ) : (
                  <button className="btn-primary" onClick={() => connect.mutate()}><UserPlus size={16} /> Connect</button>
                )}
                {u.degree !== 1 && <button className="btn-outline" onClick={() => message.mutate()}>Message</button>}
                <button className="btn-outline" onClick={() => follow.mutate()}>{u.isFollowing ? 'Following' : '+ Follow'}</button>
                {u.degree === 1 && <button className="btn-ghost" onClick={() => confirm('Remove connection?') && removeConn.mutate()}>Remove connection</button>}
              </div>
            )}
            {u.openTo?.length > 0 && (
              <div className="mt-4 rounded-lg bg-[#dde7f1] p-3 text-sm">
                <span className="font-semibold">Open to: </span>{u.openTo.join(', ')}
              </div>
            )}
          </div>
        </section>

        <div className="card flex">
          {(['about', 'activity'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`flex-1 border-b-2 py-3 text-sm font-semibold capitalize ${tab === t ? 'border-zinc-900 text-zinc-900' : 'border-transparent text-zinc-500'}`}>{t}</button>
          ))}
        </div>

        {tab === 'activity' ? (
          <PostFeed queryKey={['user-posts', u.id]} path={`/posts/by/${u.id}`} empty={isMe ? 'Posts you share will show up here.' : `${u.name} hasn't posted yet.`} />
        ) : (
          <>
            {(u.about || isMe) && (
              <Section title="About">
                <p className="whitespace-pre-wrap text-sm">{u.about || <span className="text-zinc-500">Tell colleagues about yourself.</span>}</p>
              </Section>
            )}

            <Section title="Organisation">
              <div className="space-y-2">
                {u.orgPaths.map((p: any[], i: number) => (
                  <div key={i} className="flex flex-wrap items-center gap-1 text-sm">
                    {p.map((n, j) => (
                      <span key={n.id} className="flex items-center gap-1">
                        {j > 0 && <ChevronRight size={14} className="text-zinc-400" />}
                        <Link to={`/org?node=${n.id}`} className={j === p.length - 1 ? 'font-semibold' : 'text-zinc-600 hover:underline'}>{n.name}</Link>
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            </Section>

            <Section title="Experience" onAdd={isMe ? () => setModal('exp') : undefined}>
              <div className="divide-y divide-zinc-100">
                {u.experiences.map((e: any) => (
                  <div key={e.id} className="flex gap-3 py-3">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-zinc-100"><Briefcase size={20} className="text-zinc-500" /></div>
                    <div className="flex-1">
                      <div className="font-semibold">{e.title}</div>
                      <div className="text-sm">{e.company}</div>
                      <div className="muted">{monthYear(e.startDate)} – {e.endDate ? monthYear(e.endDate) : 'Present'}{e.location && ` · ${e.location}`}</div>
                      {e.description && <p className="mt-1 whitespace-pre-wrap text-sm">{e.description}</p>}
                    </div>
                    {isMe && <button className="self-start rounded p-1 text-zinc-400 hover:text-red-600" onClick={() => delExp.mutate(e.id)}><Trash2 size={16} /></button>}
                  </div>
                ))}
                {!u.experiences.length && <div className="muted">No experience added.</div>}
              </div>
            </Section>

            <Section title="Education" onAdd={isMe ? () => setModal('edu') : undefined}>
              {u.educations.map((e: any) => (
                <div key={e.id} className="flex gap-3 py-2">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-zinc-100"><GraduationCap size={20} className="text-zinc-500" /></div>
                  <div className="flex-1">
                    <div className="font-semibold">{e.school}</div>
                    <div className="text-sm">{[e.degree, e.field].filter(Boolean).join(', ')}</div>
                    {e.startDate && <div className="muted">{monthYear(e.startDate)} – {e.endDate ? monthYear(e.endDate) : 'Present'}</div>}
                  </div>
                  {isMe && <button className="self-start rounded p-1 text-zinc-400 hover:text-red-600" onClick={() => delEdu.mutate(e.id)}><Trash2 size={16} /></button>}
                </div>
              ))}
              {!u.educations.length && <div className="muted">No education added.</div>}
            </Section>

            <Section title="Skills">
              <div className="divide-y divide-zinc-100">
                {u.skills.map((s: any) => (
                  <div key={s.id} className="flex items-center justify-between py-2">
                    <div>
                      <div className="font-semibold">{s.name}</div>
                      <div className="muted">{s.endorsements} endorsement{s.endorsements === 1 ? '' : 's'}</div>
                    </div>
                    {isMe ? (
                      <button className="rounded p-1 text-zinc-400 hover:text-red-600" onClick={() => delSkill.mutate(s.id)}><Trash2 size={16} /></button>
                    ) : (
                      <button className={s.endorsedByMe ? 'btn-primary py-1' : 'btn-outline py-1'} onClick={() => endorse.mutate(s.id)}>{s.endorsedByMe ? '✓ Endorsed' : 'Endorse'}</button>
                    )}
                  </div>
                ))}
              </div>
              {isMe && (
                <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); skill.trim() && addSkill.mutate(); }}>
                  <input className="input" placeholder="Add a skill" value={skill} onChange={(e) => setSkill(e.target.value)} />
                  <button className="btn-outline">Add</button>
                </form>
              )}
            </Section>
          </>
        )}
      </div>

      <aside className="space-y-2">
        {isMe && <ProfileViewers />}
        <Suggestions limit={5} />
      </aside>

      {modal === 'intro' && <EditIntro user={u} onClose={() => setModal(null)} />}
      {modal === 'exp' && <ExperienceModal onClose={() => setModal(null)} />}
      {modal === 'edu' && <EducationModal onClose={() => setModal(null)} />}
    </div>
  );
}

function ProfileViewers() {
  const { data } = useQuery({ queryKey: ['profile-views'], queryFn: () => api.get('/users/me/profile-views') });
  return (
    <div className="card p-3">
      <h3 className="font-semibold">Who viewed your profile</h3>
      <div className="muted mb-3">{data?.thisWeek ?? 0} this week · {data?.total ?? 0} total</div>
      <div className="space-y-3">
        {(data?.views ?? []).slice(0, 5).map((v: any) => <UserLine key={v.id} user={v.viewer} size={32} />)}
      </div>
    </div>
  );
}
