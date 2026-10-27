import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import { initials } from '@/lib/format';
import { useToasts } from '@/lib/toast';

const COLORS = ['bg-[#5b6b8c]', 'bg-[#6b7f6a]', 'bg-[#8a6f5c]', 'bg-[#7a6a8f]', 'bg-[#5f7f86]', 'bg-[#8c6672]', 'bg-[#6d7480]'];

export function Avatar({ user, size = 48, online }: { user: { name: string; avatarUrl?: string | null; id?: string }; size?: number; online?: boolean }) {
  const color = COLORS[(user.id ?? user.name).split('').reduce((s, c) => s + c.charCodeAt(0), 0) % COLORS.length];
  return (
    <span className="relative inline-block shrink-0" style={{ width: size, height: size }}>
      {user.avatarUrl ? (
        <img src={user.avatarUrl} alt="" className="h-full w-full rounded-full object-cover" />
      ) : (
        <span className={`flex h-full w-full items-center justify-center rounded-full font-semibold text-white ${color}`} style={{ fontSize: size * 0.38 }}>
          {initials(user.name)}
        </span>
      )}
      {online && <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white bg-green-600" />}
    </span>
  );
}

export function UserLine({ user, sub, size = 40, right }: { user: { id: string; name: string; headline?: string | null; avatarUrl?: string | null }; sub?: ReactNode; size?: number; right?: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <Link to={`/profile/${user.id}`}>
        <Avatar user={user} size={size} />
      </Link>
      <div className="min-w-0 flex-1">
        <Link to={`/profile/${user.id}`} className="block truncate font-semibold hover:text-brand-500 hover:underline">
          {user.name}
        </Link>
        {user.headline && <div className="truncate text-xs text-zinc-500">{user.headline}</div>}
        {sub && <div className="text-xs text-zinc-500">{sub}</div>}
      </div>
      {right}
    </div>
  );
}

export function Modal({ title, onClose, children, width = 560, footer }: { title: ReactNode; onClose: () => void; children: ReactNode; width?: number; footer?: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-10" onMouseDown={onClose}>
      <div className="card w-full shadow-xl" style={{ maxWidth: width }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button className="rounded-full p-1.5 hover:bg-zinc-100" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-zinc-200 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Menu({ trigger, children, align = 'right' }: { trigger: ReactNode; children: ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  return (
    <div className="relative" ref={ref}>
      <div onClick={() => setOpen((o) => !o)}>{trigger}</div>
      {open && (
        <div className={`card absolute z-40 mt-1 min-w-[220px] py-1 shadow-lg ${align === 'right' ? 'right-0' : 'left-0'}`} onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ icon, children, onClick, danger }: { icon?: ReactNode; children: ReactNode; onClick?: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm font-semibold hover:bg-zinc-100 ${danger ? 'text-red-600' : 'text-zinc-700'}`}>
      {icon}
      {children}
    </button>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      {icon && <div className="text-zinc-400">{icon}</div>}
      <div className="font-semibold">{title}</div>
      {children && <div className="max-w-sm text-sm text-zinc-500">{children}</div>}
    </div>
  );
}

export function Toasts() {
  const { toasts, dismiss } = useToasts();
  return (
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-[70] flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto flex items-center gap-3 rounded-full bg-zinc-900 py-2 pl-4 pr-2 text-sm text-surface shadow-lg">
          {t.tone === 'error' && <span className="h-1.5 w-1.5 rounded-full bg-red-500" />}
          {t.text}
          <button className="rounded-full p-1 opacity-60 hover:opacity-100" onClick={() => dismiss(t.id)} aria-label="Dismiss"><X size={14} /></button>
        </div>
      ))}
    </div>
  );
}

export function Spinner() {
  return (
    <div className="flex justify-center p-6">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
    </div>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{(error as Error).message}</div>;
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: ReactNode }[] }) {
  return (
    <div className="flex gap-1 border-b border-zinc-200 px-2">
      {tabs.map((t) => (
        <button
          key={t.value}
          onClick={() => onChange(t.value)}
          className={`border-b-2 px-3 py-3 text-sm font-semibold ${value === t.value ? 'border-zinc-900 text-zinc-900' : 'border-transparent text-zinc-500 hover:text-zinc-800'}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input type="checkbox" className="h-4 w-4 accent-zinc-900" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/** Renders post/comment text: @mentions → profile links, #hashtags → hashtag pages, URLs → external links. */
export function RichText({ text, clamp }: { text: string; clamp?: boolean }) {
  const [expanded, setExpanded] = useState(!clamp);
  const parts: ReactNode[] = [];
  const re = /@\[([^\]]+)\]\(([a-z0-9]+)\)|#([\p{L}\p{N}_]+)|(https?:\/\/[^\s]+)/gu;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[1]) parts.push(<Link key={i++} to={`/profile/${m[2]}`} className="link">{m[1]}</Link>);
    else if (m[3]) parts.push(<Link key={i++} to={`/hashtag/${m[3].toLowerCase()}`} className="link">#{m[3]}</Link>);
    else if (m[4]) parts.push(<a key={i++} href={m[4]} target="_blank" rel="noreferrer" className="link break-all">{m[4]}</a>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  const long = text.length > 280 || text.split('\n').length > 4;
  return (
    <div>
      <div className={`whitespace-pre-wrap break-words ${!expanded && long ? 'line-clamp-3' : ''}`}>{parts}</div>
      {!expanded && long && (
        <button className="text-sm text-zinc-500 hover:text-brand-500 hover:underline" onClick={() => setExpanded(true)}>
          …see more
        </button>
      )}
    </div>
  );
}
