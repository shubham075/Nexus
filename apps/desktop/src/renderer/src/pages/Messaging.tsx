import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquareText, Paperclip, PenSquare, Send, FileText } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth, useCan } from '@/lib/auth';
import { ago, dateLong } from '@/lib/format';
import { emitSocket, onSocket } from '@/lib/socket';
import { Avatar, Empty, Modal, Spinner } from '@/components/ui';

function convTitle(c: any) {
  return c.title || c.members.map((m: any) => m.name).join(', ') || 'Just you';
}

function NewConversation({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<any[]>([]);
  const [title, setTitle] = useState('');
  const { data = [] } = useQuery({ queryKey: ['users', 'search', q], queryFn: () => api.get<any[]>(`/users?q=${encodeURIComponent(q)}`) });
  const me = useAuth((s) => s.me!);
  const create = useMutation({
    mutationFn: () => api.post('/conversations', { userIds: picked.map((p) => p.id), title: picked.length > 1 ? title || null : null }),
    onSuccess: (c) => { onClose(); navigate(`/messaging/${c.id}`); },
  });
  return (
    <Modal title="New message" onClose={onClose} footer={<button className="btn-primary" disabled={!picked.length} onClick={() => create.mutate()}>Start conversation</button>}>
      <div className="mb-2 flex flex-wrap gap-1">
        {picked.map((p) => <button key={p.id} className="chip chip-active" onClick={() => setPicked(picked.filter((x) => x.id !== p.id))}>{p.name} ✕</button>)}
      </div>
      <input className="input" autoFocus placeholder="Type a name" value={q} onChange={(e) => setQ(e.target.value)} />
      {picked.length > 1 && <input className="input mt-2" placeholder="Group name (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />}
      <div className="mt-2 space-y-1">
        {data.filter((u) => u.id !== me.id && !picked.some((p) => p.id === u.id)).map((u) => (
          <button key={u.id} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-zinc-100" onClick={() => setPicked([...picked, u])}>
            <Avatar user={u} size={32} />
            <div><div className="text-sm font-semibold">{u.name}</div><div className="text-xs text-zinc-500">{u.headline}</div></div>
          </button>
        ))}
      </div>
    </Modal>
  );
}

function Thread({ id }: { id: string }) {
  const me = useAuth((s) => s.me!);
  const canSend = useCan('message.send');
  const qc = useQueryClient();
  const bottom = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [body, setBody] = useState('');
  const [typing, setTyping] = useState<string | null>(null);
  const lastTyped = useRef(0);
  const conv = useQuery({ queryKey: ['conversation', id], queryFn: () => api.get(`/conversations/${id}`) });
  const msgs = useQuery({ queryKey: ['messages', id], queryFn: () => api.get(`/conversations/${id}/messages?limit=50`) });

  const markRead = () => api.post(`/conversations/${id}/read`).then(() => qc.invalidateQueries({ queryKey: ['conversations'] }));
  useEffect(() => { markRead(); }, [id, msgs.data?.items.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [msgs.data]);
  useEffect(
    () =>
      onSocket('typing', (t) => {
        if (t.conversationId !== id) return;
        setTyping(t.userId);
        setTimeout(() => setTyping(null), 2500);
      }),
    [id],
  );

  const send = useMutation({
    mutationFn: (attachment?: { url: string; name: string; mime: string }) => api.post(`/conversations/${id}/messages`, { body, attachment }),
    onSuccess: () => { setBody(''); qc.invalidateQueries({ queryKey: ['messages', id] }); },
  });

  async function attach(files: FileList | null) {
    if (!files?.[0]) return;
    const [m] = await api.upload([files[0]]);
    send.mutate({ url: m.url, name: m.fileName, mime: m.mimeType });
  }

  if (!conv.data || !msgs.data) return <Spinner />;
  const others = conv.data.members.filter((m: any) => m.id !== me.id);
  const readState: { userId: string; lastReadAt: string }[] = msgs.data.readState;
  const lastMine = [...msgs.data.items].reverse().find((m: any) => m.senderId === me.id);
  const seenBy = lastMine ? readState.filter((r) => r.userId !== me.id && new Date(r.lastReadAt) >= new Date(lastMine.createdAt)) : [];
  const typingUser = others.find((o: any) => o.id === typing);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-zinc-200 px-4 py-2">
        {!conv.data.isGroup && others[0] && <Avatar user={others[0]} size={36} online={others[0].online} />}
        <div>
          <div className="font-semibold">{convTitle({ ...conv.data, members: others })}</div>
          <div className="text-xs text-zinc-500">{conv.data.isGroup ? `${conv.data.members.length} members` : others[0]?.online ? 'Active now' : others[0]?.headline}</div>
        </div>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {msgs.data.items.map((m: any, i: number) => {
          const prev = msgs.data.items[i - 1];
          const grouped = prev && prev.senderId === m.senderId && +new Date(m.createdAt) - +new Date(prev.createdAt) < 5 * 60e3;
          return (
            <div key={m.id} className={`flex gap-2 ${grouped ? '-mt-2' : ''}`}>
              <div className="w-10 shrink-0">{!grouped && <Avatar user={m.sender} size={36} />}</div>
              <div className="min-w-0 flex-1">
                {!grouped && (
                  <div className="text-sm">
                    <span className="font-semibold">{m.sender.name}</span>
                    <span className="ml-2 text-xs text-zinc-500" title={dateLong(m.createdAt)}>{new Date(m.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                  </div>
                )}
                {m.body && <div className="whitespace-pre-wrap break-words text-sm">{m.body}</div>}
                {m.attachmentUrl && (
                  m.attachmentMime?.startsWith('image/') ? (
                    <a href={m.attachmentUrl} target="_blank" rel="noreferrer"><img src={m.attachmentUrl} className="mt-1 max-h-64 rounded-lg border" /></a>
                  ) : (
                    <a href={m.attachmentUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm hover:bg-zinc-50"><FileText size={16} /> {m.attachmentName}</a>
                  )
                )}
              </div>
            </div>
          );
        })}
        {seenBy.length > 0 && <div className="text-right text-xs text-zinc-500">Seen</div>}
        {typingUser && <div className="text-xs italic text-zinc-500">{typingUser.name} is typing…</div>}
        <div ref={bottom} />
      </div>
      {canSend ? (
        <div className="border-t border-zinc-200 p-3">
          <textarea
            className="input resize-none"
            rows={3}
            autoFocus
            placeholder="Write a message…  (Enter to send, Shift+Enter for new line)"
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              if (Date.now() - lastTyped.current > 1500) { lastTyped.current = Date.now(); emitSocket('typing', { conversationId: id }); }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (body.trim()) send.mutate(undefined); }
            }}
          />
          <div className="mt-2 flex items-center justify-between">
            <button className="btn-ghost px-2" title="Attach file" onClick={() => fileRef.current?.click()}><Paperclip size={18} /></button>
            <input ref={fileRef} type="file" hidden accept="image/*,application/pdf,video/mp4" onChange={(e) => attach(e.target.files)} />
            <button className="btn-primary" disabled={!body.trim() || send.isPending} onClick={() => send.mutate(undefined)}><Send size={14} /> Send</button>
          </div>
        </div>
      ) : (
        <div className="border-t border-zinc-200 p-3 text-center text-sm text-zinc-500">Your role does not allow sending messages.</div>
      )}
    </div>
  );
}

export default function Messaging() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [newOpen, setNewOpen] = useState(false);
  const [q, setQ] = useState('');
  const { data, isLoading } = useQuery({ queryKey: ['conversations'], queryFn: () => api.get<any[]>('/conversations') });

  useEffect(() => {
    if (!id && data?.length) navigate(`/messaging/${data[0].id}`, { replace: true });
  }, [id, data, navigate]);

  const list = (data ?? []).filter((c) => convTitle(c).toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="mx-auto h-full max-w-[1130px] px-4 py-5">
      <div className="card grid h-full grid-cols-[340px_minmax(0,1fr)] overflow-hidden">
        <div className="flex flex-col border-r border-zinc-200">
          <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2">
            <h1 className="font-semibold">Messaging</h1>
            <button className="rounded-full p-2 hover:bg-zinc-100" title="New message" onClick={() => setNewOpen(true)}><PenSquare size={18} /></button>
          </div>
          <div className="border-b border-zinc-200 p-2"><input className="input" placeholder="Search messages" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <div className="flex-1 overflow-y-auto">
            {isLoading && <Spinner />}
            {list.map((c) => (
              <button key={c.id} onClick={() => navigate(`/messaging/${c.id}`)} className={`flex w-full gap-3 border-l-4 px-3 py-3 text-left hover:bg-zinc-50 ${c.id === id ? 'border-zinc-900 bg-zinc-50' : 'border-transparent'}`}>
                {c.members[0] ? <Avatar user={c.members[0]} size={48} online={!c.isGroup && c.members[0].online} /> : <Avatar user={{ name: '?' }} size={48} />}
                <div className="min-w-0 flex-1">
                  <div className="flex justify-between gap-2">
                    <span className={`truncate text-sm ${c.unread ? 'font-bold' : 'font-semibold'}`}>{convTitle(c)}</span>
                    {c.lastMessage && <span className="shrink-0 text-xs text-zinc-500">{ago(c.lastMessage.createdAt)}</span>}
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className={`truncate text-xs ${c.unread ? 'font-semibold text-zinc-800' : 'text-zinc-500'}`}>
                      {c.lastMessage ? `${c.lastMessage.sender.name.split(' ')[0]}: ${c.lastMessage.body || 'Attachment'}` : 'No messages yet'}
                    </span>
                    {c.unread > 0 && <span className="rounded-full bg-zinc-900 px-1.5 text-surface text-[11px] font-semibold text-white">{c.unread}</span>}
                  </div>
                </div>
              </button>
            ))}
            {!isLoading && !list.length && <Empty icon={<MessageSquareText size={36} />} title="No conversations">Start one with the pen icon.</Empty>}
          </div>
        </div>
        <div className="h-full min-h-0">{id ? <Thread key={id} id={id} /> : <Empty icon={<MessageSquareText size={48} />} title="Select a conversation" />}</div>
      </div>
      {newOpen && <NewConversation onClose={() => setNewOpen(false)} />}
    </div>
  );
}
