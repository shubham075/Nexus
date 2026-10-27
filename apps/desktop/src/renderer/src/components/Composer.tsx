import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BarChart3, FileText, Image, PartyPopper, Trash2, X, Newspaper, CalendarPlus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { useAuth, useCan } from '@/lib/auth';
import { Avatar, ErrorText, Modal } from './ui';
import { MentionInput } from './MentionInput';
import { PostEmbed } from './PostCard';

const CELEBRATIONS = [
  { value: 'KUDOS', label: 'Give kudos', emoji: '🏆' },
  { value: 'WELCOME', label: 'Welcome a teammate', emoji: '👋' },
  { value: 'WORK_ANNIVERSARY', label: 'Work anniversary', emoji: '🎂' },
  { value: 'PROMOTION', label: 'New position', emoji: '🚀' },
  { value: 'PROJECT_LAUNCH', label: 'Project launch', emoji: '📦' },
];
export const CELEBRATION_META = Object.fromEntries(CELEBRATIONS.map((c) => [c.value, c]));

type Mode = 'text' | 'media' | 'poll' | 'celebrate';

/** The "Start a post" box at the top of the feed / groups. */
export function ComposerBox({ groupId }: { groupId?: string }) {
  const me = useAuth((s) => s.me!);
  const canPost = useCan('post.create');
  const canArticle = useCan('article.publish');
  const canEvent = useCan('event.create');
  const navigate = useNavigate();
  const [open, setOpen] = useState<Mode | null>(null);
  if (!canPost) return null;
  return (
    <div className="card p-3">
      <div className="flex gap-2">
        <Avatar user={me} size={48} />
        <button onClick={() => setOpen('text')} className="flex-1 rounded-full border border-zinc-400 px-4 text-left text-sm font-semibold text-zinc-500 hover:bg-zinc-100">
          Start a post
        </button>
      </div>
      <div className="mt-2 flex justify-around">
        <button className="action" onClick={() => setOpen('media')}><Image size={20} className="text-sky-600" /> Media</button>
        <button className="action" onClick={() => setOpen('poll')}><BarChart3 size={20} className="text-amber-600" /> Poll</button>
        <button className="action" onClick={() => setOpen('celebrate')}><PartyPopper size={20} className="text-rose-600" /> Celebrate</button>
        {!groupId && canArticle && <button className="action" onClick={() => navigate('/articles/new')}><Newspaper size={20} className="text-orange-700" /> Write article</button>}
        {!groupId && canEvent && <button className="action" onClick={() => navigate('/events?new=1')}><CalendarPlus size={20} className="text-violet-600" /> Event</button>}
      </div>
      {open && <ComposerModal initialMode={open} groupId={groupId} onClose={() => setOpen(null)} />}
    </div>
  );
}

export function ComposerModal({ initialMode = 'text', groupId, repostOf, onClose }: { initialMode?: Mode; groupId?: string; repostOf?: any; onClose: () => void }) {
  const me = useAuth((s) => s.me!);
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [body, setBody] = useState('');
  const [media, setMedia] = useState<{ url: string; mimeType: string; fileName: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [poll, setPoll] = useState({ question: '', options: ['', ''], durationDays: 7 });
  const [celebration, setCelebration] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const submit = useMutation({
    mutationFn: () =>
      api.post('/posts', {
        body,
        media,
        groupId,
        repostOfId: repostOf?.id,
        poll: mode === 'poll' ? { ...poll, options: poll.options.filter((o) => o.trim()) } : null,
        celebration: mode === 'celebrate' ? celebration : null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['feed'] });
      qc.invalidateQueries({ queryKey: ['group-posts'] });
      qc.invalidateQueries({ queryKey: ['trending'] });
      onClose();
    },
    onError: setError,
  });

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setError(null);
    try {
      const up = await api.upload([...files]);
      setMedia((m) => [...m, ...up].slice(0, 9));
      setMode('media');
    } catch (e) {
      setError(e);
    } finally {
      setUploading(false);
    }
  }

  const canSubmit =
    !submit.isPending && !uploading &&
    (mode === 'poll' ? poll.question.trim() && poll.options.filter((o) => o.trim()).length >= 2
      : mode === 'celebrate' ? !!celebration
      : body.trim() || media.length || repostOf);

  return (
    <Modal
      width={640}
      onClose={onClose}
      title={
        <div className="flex items-center gap-3">
          <Avatar user={me} size={40} />
          <div>
            <div>{me.name}</div>
            <div className="text-xs font-normal text-zinc-500">{groupId ? 'Post to group' : repostOf ? 'Repost with your thoughts' : 'Post to everyone at the company'}</div>
          </div>
        </div>
      }
      footer={
        <div className="flex w-full items-center justify-between">
          <div className="flex gap-1">
            {!repostOf && (
              <>
                <button className="btn-ghost px-2" title="Add media" onClick={() => fileRef.current?.click()}><Image size={20} /></button>
                <button className="btn-ghost px-2" title="Add document" onClick={() => fileRef.current?.click()}><FileText size={20} /></button>
                <button className={`btn-ghost px-2 ${mode === 'poll' ? 'bg-zinc-100' : ''}`} title="Create a poll" onClick={() => setMode(mode === 'poll' ? 'text' : 'poll')}><BarChart3 size={20} /></button>
                <button className={`btn-ghost px-2 ${mode === 'celebrate' ? 'bg-zinc-100' : ''}`} title="Celebrate" onClick={() => setMode(mode === 'celebrate' ? 'text' : 'celebrate')}><PartyPopper size={20} /></button>
              </>
            )}
            <input ref={fileRef} type="file" multiple hidden accept="image/*,video/mp4,video/webm,application/pdf" onChange={(e) => onFiles(e.target.files)} />
          </div>
          <button className="btn-primary" disabled={!canSubmit} onClick={() => submit.mutate()}>
            {submit.isPending ? 'Posting…' : 'Post'}
          </button>
        </div>
      }
    >
      <MentionInput
        autoFocus
        rows={mode === 'text' && !repostOf ? 6 : 3}
        value={body}
        onChange={setBody}
        placeholder="What do you want to talk about? Use @ to mention and # for hashtags"
        className="text-base"
        onSubmit={() => canSubmit && submit.mutate()}
      />

      {uploading && <div className="muted">Uploading…</div>}
      {media.length > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {media.map((m, i) => (
            <div key={m.url} className="group relative overflow-hidden rounded-md border border-zinc-200">
              {m.mimeType.startsWith('image/') ? (
                <img src={m.url} className="h-28 w-full object-cover" />
              ) : m.mimeType.startsWith('video/') ? (
                <video src={m.url} className="h-28 w-full object-cover" />
              ) : (
                <div className="flex h-28 flex-col items-center justify-center gap-1 bg-zinc-50 p-2 text-center text-xs"><FileText /> {m.fileName}</div>
              )}
              <button className="absolute right-1 top-1 rounded-full bg-black/70 p-1 text-white" onClick={() => setMedia(media.filter((_, j) => j !== i))}>
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {mode === 'poll' && (
        <div className="mt-3 space-y-2 rounded-lg border border-zinc-200 p-3">
          <div>
            <label className="label">Your question *</label>
            <input className="input" maxLength={140} value={poll.question} onChange={(e) => setPoll({ ...poll, question: e.target.value })} placeholder="E.g., How do you commute to work?" />
          </div>
          {poll.options.map((o, i) => (
            <div key={i} className="flex items-end gap-2">
              <div className="flex-1">
                <label className="label">Option {i + 1}{i < 2 ? ' *' : ''}</label>
                <input className="input" maxLength={30} value={o} onChange={(e) => setPoll({ ...poll, options: poll.options.map((x, j) => (j === i ? e.target.value : x)) })} />
              </div>
              {i >= 2 && <button className="btn-ghost px-2" onClick={() => setPoll({ ...poll, options: poll.options.filter((_, j) => j !== i) })}><Trash2 size={16} /></button>}
            </div>
          ))}
          <div className="flex items-center justify-between">
            {poll.options.length < 4 ? <button className="btn-outline py-1" onClick={() => setPoll({ ...poll, options: [...poll.options, ''] })}>+ Add option</button> : <span />}
            <select className="input w-40" value={poll.durationDays} onChange={(e) => setPoll({ ...poll, durationDays: Number(e.target.value) })}>
              {[1, 3, 7, 14].map((d) => <option key={d} value={d}>{d} day{d > 1 ? 's' : ''}</option>)}
            </select>
          </div>
        </div>
      )}

      {mode === 'celebrate' && (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {CELEBRATIONS.map((c) => (
            <button key={c.value} onClick={() => setCelebration(c.value)} className={`rounded-lg border p-3 text-center text-sm font-semibold ${celebration === c.value ? 'border-zinc-900 bg-zinc-50' : 'border-zinc-200 hover:bg-zinc-50'}`}>
              <div className="text-3xl">{c.emoji}</div>
              {c.label}
            </button>
          ))}
        </div>
      )}

      {repostOf && <div className="mt-3"><PostEmbed post={repostOf} /></div>}
      <div className="mt-3"><ErrorText error={error} /></div>
    </Modal>
  );
}
