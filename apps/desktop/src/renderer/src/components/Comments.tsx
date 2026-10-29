import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal } from 'lucide-react';
import type { ReactionType } from '@nexus/shared';
import { api } from '@/lib/api';
import { useAuth, useCan, useCanNetwork } from '@/lib/auth';
import { ago } from '@/lib/format';
import { Avatar, Menu, MenuItem, RichText, Spinner } from './ui';
import { MentionInput } from './MentionInput';
import { ReactionButton, ReportModal } from './PostCard';

function CommentInput({ postId, parentId, onDone, autoFocus, initial = '' }: { postId: string; parentId?: string; onDone?: () => void; autoFocus?: boolean; initial?: string }) {
  const me = useAuth((s) => s.me!);
  const qc = useQueryClient();
  const canComment = useCanNetwork('comment.create');
  const [body, setBody] = useState(initial);
  const send = useMutation({
    mutationFn: () => api.post(`/posts/${postId}/comments`, { body, parentId }),
    onSuccess: (created) => {
      setBody('');
      // show the new comment immediately, then reconcile with the server
      if (!parentId) qc.setQueryData(['comments', postId], (old: any[] | undefined) => [...(old ?? []), created]);
      qc.invalidateQueries({ queryKey: ['comments', postId] });
      qc.invalidateQueries({ queryKey: ['feed'] });
      onDone?.();
    },
  });
  if (!canComment) return null;
  return (
    <div className="flex items-start gap-2">
      <Avatar user={me} size={parentId ? 28 : 36} />
      <div className="flex-1 rounded-2xl border border-zinc-300 px-3 py-1.5 focus-within:border-zinc-500">
        <MentionInput value={body} onChange={setBody} rows={1} autoFocus={autoFocus} placeholder={parentId ? 'Add a reply…' : 'Add a comment…'} className="text-sm" onSubmit={() => body.trim() && send.mutate()} />
        {body.trim() && (
          <div className="flex justify-end pb-1">
            <button className="btn-primary px-3 py-0.5 text-xs" onClick={() => send.mutate()} disabled={send.isPending}>{parentId ? 'Reply' : 'Comment'}</button>
          </div>
        )}
      </div>
    </div>
  );
}

function CommentItem({ c, post, isReply }: { c: any; post: any; isReply?: boolean }) {
  const me = useAuth((s) => s.me!);
  const canModerate = useCan('post.moderate');
  const qc = useQueryClient();
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(c.body);
  const [reporting, setReporting] = useState(false);
  const [myReaction, setMyReaction] = useState<ReactionType | null>(c.myReaction);
  const refresh = () => qc.invalidateQueries({ queryKey: ['comments', post.id] });
  const react = useMutation({ mutationFn: (type: ReactionType | null) => api.post(`/posts/${post.id}/comments/${c.id}/react`, { type }), onMutate: setMyReaction, onSuccess: refresh });
  const del = useMutation({ mutationFn: () => api.del(`/posts/${post.id}/comments/${c.id}`), onSuccess: refresh });
  const edit = useMutation({ mutationFn: () => api.patch(`/posts/${post.id}/comments/${c.id}`, { body: editBody }), onSuccess: () => { setEditing(false); refresh(); } });
  const mine = c.author.id === me.id;

  return (
    <div className="flex gap-2">
      <Link to={`/profile/${c.author.id}`}><Avatar user={c.author} size={isReply ? 28 : 36} /></Link>
      <div className="min-w-0 flex-1">
        <div className="rounded-lg rounded-tl-none bg-zinc-100 px-3 py-2">
          <div className="flex items-start justify-between">
            <div className="min-w-0">
              <Link to={`/profile/${c.author.id}`} className="text-sm font-semibold hover:underline">{c.author.name}</Link>
              {c.author.id === post.author.id && <span className="ml-1 rounded bg-zinc-600 px-1 text-[10px] font-semibold text-white">Author</span>}
              <div className="truncate text-xs text-zinc-500">{c.author.headline}</div>
            </div>
            <div className="flex items-center gap-1 text-xs text-zinc-500">
              {ago(c.createdAt)}{c.editedAt && ' (edited)'}
              <Menu trigger={<button className="rounded-full p-1 hover:bg-zinc-200"><MoreHorizontal size={16} /></button>}>
                {mine && <MenuItem onClick={() => setEditing(true)}>Edit</MenuItem>}
                {(mine || post.author.id === me.id || canModerate) && <MenuItem danger onClick={() => del.mutate()}>Delete</MenuItem>}
                {!mine && <MenuItem onClick={() => setReporting(true)}>Report</MenuItem>}
              </Menu>
            </div>
          </div>
          {editing ? (
            <div className="mt-1">
              <MentionInput value={editBody} onChange={setEditBody} rows={2} className="rounded border border-zinc-300 bg-white p-2 text-sm" />
              <div className="mt-1 flex gap-2">
                <button className="btn-primary px-3 py-0.5 text-xs" onClick={() => edit.mutate()}>Save</button>
                <button className="btn-ghost px-3 py-0.5 text-xs" onClick={() => setEditing(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <div className="mt-1 text-sm"><RichText text={c.body} /></div>
          )}
        </div>
        <div className="mt-1 flex items-center gap-3 px-2 text-xs text-zinc-500">
          <ReactionButton compact mine={myReaction} onReact={(t) => react.mutate(t)} />
          {c.reactionCount > 0 && <span>· {c.reactionCount}</span>}
          <span>|</span>
          <button className="font-semibold hover:underline" onClick={() => setReplying(true)}>Reply</button>
          {c.replies?.length > 0 && <span>· {c.replies.length} repl{c.replies.length > 1 ? 'ies' : 'y'}</span>}
        </div>
        {c.replies?.length > 0 && (
          <div className="mt-2 space-y-2">
            {c.replies.map((r: any) => <CommentItem key={r.id} c={r} post={post} isReply />)}
          </div>
        )}
        {replying && (
          <div className="mt-2">
            <CommentInput postId={post.id} parentId={c.id} autoFocus initial={`@[${c.author.name}](${c.author.id}) `} onDone={() => setReplying(false)} />
          </div>
        )}
      </div>
      {reporting && <ReportModal target={{ commentId: c.id }} onClose={() => setReporting(false)} />}
    </div>
  );
}

export function Comments({ post, autoFocus }: { post: any; autoFocus?: boolean }) {
  const [sort, setSort] = useState<'relevant' | 'recent'>('relevant');
  const { data, isLoading } = useQuery({ queryKey: ['comments', post.id], queryFn: () => api.get<any[]>(`/posts/${post.id}/comments`) });
  const list = [...(data ?? [])].sort((a, b) =>
    sort === 'recent' ? +new Date(b.createdAt) - +new Date(a.createdAt) : b.reactionCount + b.replies.length - (a.reactionCount + a.replies.length),
  );
  return (
    <div className="space-y-3 px-4 pb-4 pt-2">
      <CommentInput postId={post.id} autoFocus={autoFocus} />
      {isLoading ? (
        <Spinner />
      ) : (
        <>
          {list.length > 1 && (
            <select className="text-xs font-semibold text-zinc-600 outline-none" value={sort} onChange={(e) => setSort(e.target.value as 'relevant' | 'recent')}>
              <option value="relevant">Most relevant</option>
              <option value="recent">Most recent</option>
            </select>
          )}
          {list.map((c) => <CommentItem key={c.id} c={c} post={post} />)}
        </>
      )}
    </div>
  );
}
