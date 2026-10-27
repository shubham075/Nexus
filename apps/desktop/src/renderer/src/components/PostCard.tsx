import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark, CalendarDays, Copy, EyeOff, Flag, MessageCircle, MoreHorizontal, Pencil, Pin, Repeat2, Send, ThumbsUp, Trash2, Briefcase, FileText } from 'lucide-react';
import { REACTION_META, REACTION_TYPES, type ReactionType } from '@nexus/shared';
import { api } from '@/lib/api';
import { useAuth, useCan } from '@/lib/auth';
import { ago, dateLong, plainText } from '@/lib/format';
import { Avatar, Menu, MenuItem, Modal, RichText, Tabs, UserLine, ErrorText } from './ui';
import { Comments } from './Comments';
import { ComposerModal, CELEBRATION_META } from './Composer';
import { MentionInput } from './MentionInput';

export type Post = any;

/** Patch a post everywhere it is cached (feed pages, hashtag pages, group feeds, single post). */
export function usePostCache() {
  const qc = useQueryClient();
  return (updated: Post) => {
    qc.setQueriesData({ predicate: (q) => ['feed', 'hashtag', 'group-posts', 'user-posts'].includes(q.queryKey[0] as string) }, (old: any) =>
      old?.pages ? { ...old, pages: old.pages.map((p: any) => ({ ...p, items: p.items.map((x: Post) => (x.id === updated.id ? updated : x)) })) } : old,
    );
    qc.setQueryData(['post', updated.id], updated);
  };
}

export function ReactionButton({ mine, onReact, compact }: { mine: ReactionType | null; onReact: (t: ReactionType | null) => void; compact?: boolean }) {
  const [hover, setHover] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const meta = mine ? REACTION_META[mine] : null;
  const delay = (open: boolean, ms: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setHover(open), ms);
  };
  return (
    <div className={`relative ${compact ? '' : 'flex-1'}`} onMouseEnter={() => delay(true, 350)} onMouseLeave={() => delay(false, 250)}>
      {hover && (
        // pb-2 keeps the hover area contiguous between the button and the picker
        <div className="absolute bottom-full left-0 z-20 pb-2">
          <div className="flex gap-1 rounded-full border border-zinc-200 bg-surface px-2 py-1 shadow-lg">
            {REACTION_TYPES.map((t) => (
              <button key={t} title={REACTION_META[t].label} className="text-2xl transition hover:-translate-y-1 hover:scale-125" onClick={() => { onReact(t); setHover(false); }}>
                {REACTION_META[t].emoji}
              </button>
            ))}
          </div>
        </div>
      )}
      {compact ? (
        <button className="text-xs font-semibold hover:underline" style={{ color: meta?.color }} onClick={() => onReact(mine ? null : 'LIKE')}>
          {meta ? meta.label : 'Like'}
        </button>
      ) : (
        <button className="action w-full" style={{ color: meta?.color }} onClick={() => onReact(mine ? null : 'LIKE')}>
          {meta ? <span className="text-lg leading-none">{meta.emoji}</span> : <ThumbsUp size={18} />} {meta ? meta.label : 'Like'}
        </button>
      )}
    </div>
  );
}

function MediaGrid({ media }: { media: any[] }) {
  const images = media.filter((m) => m.mimeType.startsWith('image/'));
  const others = media.filter((m) => !m.mimeType.startsWith('image/'));
  return (
    <div>
      {images.length > 0 && (
        <div className={`grid gap-0.5 ${images.length === 1 ? '' : 'grid-cols-2'}`}>
          {images.slice(0, 4).map((m, i) => (
            <a key={m.id ?? m.url} href={m.url} target="_blank" rel="noreferrer" className="relative block">
              <img src={m.url} className={`w-full object-cover ${images.length === 1 ? 'max-h-[520px]' : 'h-56'}`} />
              {i === 3 && images.length > 4 && <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-2xl font-semibold text-white">+{images.length - 4}</span>}
            </a>
          ))}
        </div>
      )}
      {others.map((m) =>
        m.mimeType.startsWith('video/') ? (
          <video key={m.id ?? m.url} src={m.url} controls className="max-h-[520px] w-full bg-black" />
        ) : (
          <div key={m.id ?? m.url} className="mx-4 my-2 overflow-hidden rounded-lg border border-zinc-200">
            <div className="flex items-center gap-2 bg-zinc-50 px-3 py-2 text-sm font-semibold"><FileText size={16} /> {m.fileName ?? 'Document'}</div>
            <iframe src={m.url} className="h-[460px] w-full" />
          </div>
        ),
      )}
    </div>
  );
}

function Poll({ post, onUpdate }: { post: Post; onUpdate: (p: Post) => void }) {
  const poll = post.poll;
  const ended = new Date(poll.endsAt) < new Date();
  const showResults = ended || !!poll.myVote;
  const vote = useMutation({ mutationFn: (optionId: string) => api.post(`/posts/${post.id}/vote`, { optionId }), onSuccess: onUpdate });
  return (
    <div className="mx-4 mb-2 rounded-lg border border-zinc-200 p-4">
      <div className="mb-3 font-semibold">{poll.question}</div>
      <div className="space-y-2">
        {poll.options.map((o: any) => {
          const pct = poll.totalVotes ? Math.round((o.votes / poll.totalVotes) * 100) : 0;
          return showResults ? (
            <button key={o.id} disabled={ended} onClick={() => vote.mutate(o.id)} className="relative block w-full overflow-hidden rounded-md border border-zinc-200 text-left">
              <div className={`absolute inset-y-0 left-0 ${poll.myVote === o.id ? 'bg-green-100' : 'bg-zinc-100'}`} style={{ width: `${pct}%` }} />
              <div className="relative flex justify-between px-3 py-2 text-sm font-semibold">
                <span>{o.text} {poll.myVote === o.id && '✓'}</span>
                <span>{pct}%</span>
              </div>
            </button>
          ) : (
            <button key={o.id} onClick={() => vote.mutate(o.id)} className="btn-outline w-full">
              {o.text}
            </button>
          );
        })}
      </div>
      <div className="muted mt-2">
        {poll.totalVotes} vote{poll.totalVotes === 1 ? '' : 's'} · {ended ? 'Poll closed' : `${ago(poll.endsAt).replace(/^/, '')} left`}
      </div>
    </div>
  );
}

/** Compact rendering of a post inside a repost. */
export function PostEmbed({ post }: { post: Post }) {
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200">
      <div className="p-3">
        <UserLine user={post.author} size={32} sub={ago(post.createdAt)} />
        {post.body && <div className="mt-2 text-sm"><RichText text={post.body} clamp /></div>}
      </div>
      {post.media?.length > 0 && <MediaGrid media={post.media.slice(0, 1)} />}
      {post.article && <ArticleCard article={post.article} />}
    </div>
  );
}

function ArticleCard({ article }: { article: any }) {
  return (
    <Link to={`/articles/${article.id}`} className="block border-y border-zinc-200 bg-zinc-50 hover:bg-zinc-100">
      {article.coverUrl && <img src={article.coverUrl} className="max-h-72 w-full object-cover" />}
      <div className="px-4 py-3">
        <div className="font-semibold">{article.title}</div>
        {article.body && <div className="muted line-clamp-2">{article.body.slice(0, 200)}</div>}
      </div>
    </Link>
  );
}

function ReportModal({ target, onClose }: { target: { postId?: string; commentId?: string; targetUserId?: string }; onClose: () => void }) {
  const [reason, setReason] = useState('SPAM');
  const [details, setDetails] = useState('');
  const [done, setDone] = useState(false);
  const send = useMutation({ mutationFn: () => api.post('/reports', { ...target, reason, details }), onSuccess: () => setDone(true) });
  return (
    <Modal title="Report" onClose={onClose} footer={done ? <button className="btn-primary" onClick={onClose}>Done</button> : <button className="btn-primary" onClick={() => send.mutate()} disabled={send.isPending}>Submit report</button>}>
      {done ? (
        <p>Thanks — our moderators will review this.</p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-zinc-600">Why are you reporting this?</p>
          <div className="flex flex-wrap gap-2">
            {['SPAM', 'HARASSMENT', 'HATE', 'MISINFORMATION', 'CONFIDENTIAL', 'INAPPROPRIATE', 'OTHER'].map((r) => (
              <button key={r} className={`chip ${reason === r ? 'chip-active' : ''}`} onClick={() => setReason(r)}>{r.toLowerCase().replace('_', ' ')}</button>
            ))}
          </div>
          <textarea className="input" rows={3} placeholder="Add details (optional)" value={details} onChange={(e) => setDetails(e.target.value)} />
          <ErrorText error={send.error} />
        </div>
      )}
    </Modal>
  );
}
export { ReportModal };

function ReactionsModal({ post, onClose }: { post: Post; onClose: () => void }) {
  const [tab, setTab] = useState<string>('ALL');
  const { data = [] } = useQuery({ queryKey: ['reactions', post.id], queryFn: () => api.get<any[]>(`/posts/${post.id}/reactions`) });
  const list = tab === 'ALL' ? data : data.filter((r) => r.type === tab);
  return (
    <Modal title="Reactions" onClose={onClose}>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[{ value: 'ALL', label: `All ${data.length}` }, ...post.topReactions.map((r: any) => ({ value: r.type, label: `${REACTION_META[r.type as ReactionType].emoji} ${r.count}` }))]}
      />
      <div className="mt-3 space-y-3">
        {list.map((r: any) => (
          <UserLine key={r.user.id} user={r.user} right={<span className="text-xl">{REACTION_META[r.type as ReactionType].emoji}</span>} />
        ))}
      </div>
    </Modal>
  );
}

function SendModal({ post, onClose }: { post: Post; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [sent, setSent] = useState<string[]>([]);
  const { data: people = [] } = useQuery({ queryKey: ['network', 'connections'], queryFn: () => api.get<any[]>('/network/connections') });
  const list = people.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));
  async function send(userId: string) {
    const { id } = await api.post('/conversations', { userIds: [userId] });
    await api.post(`/conversations/${id}/messages`, { body: `Check out this post: nexus://post/${post.id}\n\n${plainText(post.body).slice(0, 200)}` });
    setSent((s) => [...s, userId]);
  }
  return (
    <Modal title="Send in a message" onClose={onClose}>
      <input className="input mb-3" placeholder="Search connections" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="space-y-3">
        {list.map((p) => (
          <UserLine key={p.id} user={p} right={<button className="btn-outline py-1" disabled={sent.includes(p.id)} onClick={() => send(p.id)}>{sent.includes(p.id) ? 'Sent' : 'Send'}</button>} />
        ))}
        {!list.length && <div className="muted">No connections found.</div>}
      </div>
    </Modal>
  );
}

export function PostCard({ post, defaultShowComments = false }: { post: Post; defaultShowComments?: boolean }) {
  const me = useAuth((s) => s.me!);
  const qc = useQueryClient();
  const update = usePostCache();
  const canPin = useCan('post.pin');
  const canModerate = useCan('post.moderate');
  const [showComments, setShowComments] = useState(defaultShowComments);
  const [modal, setModal] = useState<null | 'repost' | 'report' | 'reactions' | 'send' | 'edit'>(null);
  const [editBody, setEditBody] = useState(post.body);
  const [removed, setRemoved] = useState(false);
  const mine = post.author.id === me.id;

  const react = useMutation({
    mutationFn: (type: ReactionType | null) => api.post(`/posts/${post.id}/react`, { type }),
    onMutate: (type) => update({ ...post, myReaction: type }),
    onSuccess: update,
  });
  const save = useMutation({ mutationFn: () => api.post(`/posts/${post.id}/save`), onSuccess: (r) => { update({ ...post, saved: r.saved }); qc.invalidateQueries({ queryKey: ['saved'] }); } });
  const del = useMutation({ mutationFn: () => api.del(`/posts/${post.id}`), onSuccess: () => { setRemoved(true); qc.invalidateQueries({ queryKey: ['feed'] }); } });
  const pin = useMutation({ mutationFn: () => api.post(`/posts/${post.id}/pin`), onSuccess: (r) => { update({ ...post, isPinned: r.pinned }); qc.invalidateQueries({ queryKey: ['feed'] }); } });
  const hide = useMutation({ mutationFn: () => api.post(`/posts/${post.id}/hide`), onSuccess: () => setRemoved(true) });
  const repost = useMutation({ mutationFn: () => api.post('/posts', { repostOfId: post.repostOf?.id ?? post.id }), onSuccess: () => qc.invalidateQueries({ queryKey: ['feed'] }) });
  const edit = useMutation({ mutationFn: () => api.patch(`/posts/${post.id}`, { body: editBody }), onSuccess: (p) => { update(p); setModal(null); } });

  if (removed) return null;
  const isPlainRepost = post.kind === 'REPOST' && !post.body;
  const reactionTotal = post._count.reactions;
  const celebration = post.celebration && CELEBRATION_META[post.celebration];

  return (
    <article className="card">
      {post.isPinned && <div className="flex items-center gap-1 border-b border-zinc-100 px-4 py-2 text-xs font-semibold text-zinc-500"><Pin size={12} /> Pinned announcement</div>}
      {isPlainRepost && (
        <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-2 text-xs text-zinc-500">
          <Avatar user={post.author} size={20} /> <Link to={`/profile/${post.author.id}`} className="font-semibold text-zinc-800 hover:underline">{post.author.name}</Link> reposted this
        </div>
      )}
      {post.group && <div className="border-b border-zinc-100 px-4 py-2 text-xs text-zinc-500">Posted in <Link className="link" to={`/groups/${post.group.id}`}>{post.group.name}</Link></div>}

      {!isPlainRepost && (
        <div className="px-4 pt-3">
          <UserLine
            user={post.author}
            sub={<span title={dateLong(post.createdAt)}><Link to={`/post/${post.id}`} className="hover:underline">{ago(post.createdAt)}</Link>{post.editedAt && ' · Edited'} · {post.group ? 'Group' : 'Company'}</span>}
            right={
              <Menu trigger={<button className="rounded-full p-1.5 hover:bg-zinc-100"><MoreHorizontal size={20} /></button>}>
                <MenuItem icon={<Bookmark size={16} />} onClick={() => save.mutate()}>{post.saved ? 'Unsave' : 'Save'}</MenuItem>
                <MenuItem icon={<Copy size={16} />} onClick={() => navigator.clipboard.writeText(`nexus://post/${post.id}`)}>Copy link to post</MenuItem>
                {mine && <MenuItem icon={<Pencil size={16} />} onClick={() => { setEditBody(post.body); setModal('edit'); }}>Edit post</MenuItem>}
                {canPin && <MenuItem icon={<Pin size={16} />} onClick={() => pin.mutate()}>{post.isPinned ? 'Unpin from feed' : 'Pin to top of feed'}</MenuItem>}
                {!mine && canModerate && <MenuItem icon={<EyeOff size={16} />} onClick={() => hide.mutate()}>Hide (moderator)</MenuItem>}
                {(mine || canModerate) && <MenuItem danger icon={<Trash2 size={16} />} onClick={() => confirm('Delete this post?') && del.mutate()}>Delete post</MenuItem>}
                {!mine && <MenuItem icon={<Flag size={16} />} onClick={() => setModal('report')}>Report post</MenuItem>}
              </Menu>
            }
          />
        </div>
      )}

      {celebration && (
        <div className="mx-4 mt-3 rounded-lg bg-gradient-to-r from-amber-50 to-rose-50 py-6 text-center">
          <div className="text-5xl">{celebration.emoji}</div>
          <div className="mt-1 font-semibold">{celebration.label}</div>
        </div>
      )}
      {!isPlainRepost && post.body && <div className="px-4 py-3 text-sm"><RichText text={post.body} clamp /></div>}
      {!post.body && !isPlainRepost && <div className="h-3" />}

      {post.media?.length > 0 && <MediaGrid media={post.media} />}
      {post.poll && <Poll post={post} onUpdate={update} />}
      {post.article && <ArticleCard article={post.article} />}
      {post.event && (
        <Link to={`/events/${post.event.id}`} className="mx-4 mb-2 flex items-center gap-3 rounded-lg border border-zinc-200 p-3 hover:bg-zinc-50">
          <div className="flex h-12 w-12 items-center justify-center rounded bg-violet-100 text-violet-700"><CalendarDays /></div>
          <div><div className="font-semibold">{post.event.title}</div><div className="muted">{dateLong(post.event.startsAt)} · {post.event.isOnline ? 'Online' : post.event.location}</div></div>
        </Link>
      )}
      {post.job && (
        <Link to={`/jobs/${post.job.id}`} className="mx-4 mb-2 flex items-center gap-3 rounded-lg border border-zinc-200 p-3 hover:bg-zinc-50">
          <div className="flex h-12 w-12 items-center justify-center rounded bg-sky-100 text-sky-700"><Briefcase /></div>
          <div><div className="font-semibold">{post.job.title}</div><div className="muted">{post.job.location} · {post.job.workplace.toLowerCase()} · {post.job.status === 'OPEN' ? 'Actively recruiting' : 'Closed'}</div></div>
        </Link>
      )}
      {post.repostOf && <div className="px-4 py-2"><PostEmbed post={post.repostOf} /></div>}

      {(reactionTotal > 0 || post._count.comments > 0 || post._count.reposts > 0) && (
        <div className="mx-4 flex items-center justify-between border-b border-zinc-100 py-2 text-xs text-zinc-500">
          <button className="flex items-center gap-1 hover:text-brand-500 hover:underline" onClick={() => reactionTotal && setModal('reactions')}>
            <span className="flex -space-x-1">{post.topReactions.slice(0, 3).map((r: any) => <span key={r.type}>{REACTION_META[r.type as ReactionType].emoji}</span>)}</span>
            {reactionTotal > 0 && reactionTotal}
          </button>
          <div className="flex gap-2">
            {post._count.comments > 0 && <button className="hover:text-brand-500 hover:underline" onClick={() => setShowComments(true)}>{post._count.comments} comment{post._count.comments > 1 ? 's' : ''}</button>}
            {post._count.reposts > 0 && <span>{post._count.reposts} repost{post._count.reposts > 1 ? 's' : ''}</span>}
          </div>
        </div>
      )}

      <div className="flex px-2 py-1">
        <ReactionButton mine={post.myReaction} onReact={(t) => react.mutate(t)} />
        <button className="action" onClick={() => setShowComments(true)}><MessageCircle size={18} /> Comment</button>
        <Menu align="left" trigger={<button className="action w-full"><Repeat2 size={18} /> Repost</button>}>
          <MenuItem icon={<Pencil size={16} />} onClick={() => setModal('repost')}>Repost with your thoughts</MenuItem>
          <MenuItem icon={<Repeat2 size={16} />} onClick={() => repost.mutate()}>Repost</MenuItem>
        </Menu>
        <button className="action" onClick={() => setModal('send')}><Send size={18} /> Send</button>
      </div>

      {showComments && <Comments post={post} autoFocus={!defaultShowComments} />}

      {modal === 'repost' && <ComposerModal repostOf={post.repostOf ?? post} onClose={() => setModal(null)} />}
      {modal === 'report' && <ReportModal target={{ postId: post.id }} onClose={() => setModal(null)} />}
      {modal === 'reactions' && <ReactionsModal post={post} onClose={() => setModal(null)} />}
      {modal === 'send' && <SendModal post={post} onClose={() => setModal(null)} />}
      {modal === 'edit' && (
        <Modal title="Edit post" onClose={() => setModal(null)} footer={<button className="btn-primary" onClick={() => edit.mutate()} disabled={edit.isPending}>Save</button>}>
          <MentionInput value={editBody} onChange={setEditBody} rows={6} autoFocus />
          <ErrorText error={edit.error} />
        </Modal>
      )}
    </article>
  );
}
