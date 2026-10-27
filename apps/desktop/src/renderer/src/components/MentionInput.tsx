import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Avatar } from './ui';

const TOKEN = /@\[([^\]]+)\]\(([a-z0-9]+)\)/g;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Textarea with "@" people autocomplete. The user sees "@Rahul Verma"; the value passed to
 * onChange stores mentions as @[Name](userId), which the server extracts (SOT §5.3).
 */
export function MentionInput({
  value,
  onChange,
  placeholder,
  rows = 3,
  autoFocus,
  className = '',
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  autoFocus?: boolean;
  className?: string;
  onSubmit?: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  // name → id for every mention known in this input (from the value + picks)
  const known = useRef(new Map<string, string>());
  for (const m of value.matchAll(TOKEN)) known.current.set(m[1], m[2]);

  const display = useMemo(() => value.replace(TOKEN, '@$1'), [value]);
  const toValue = (text: string) => {
    let out = text;
    for (const [name, id] of known.current) out = out.replace(new RegExp(`@${escape(name)}(?![\\p{L}\\p{N}_\\]])`, 'gu'), `@[${name}](${id})`);
    return out;
  };

  const { data: people = [] } = useQuery({
    queryKey: ['users', 'mention', query],
    queryFn: () => api.get<any[]>(`/users?q=${encodeURIComponent(query ?? '')}`),
    enabled: query !== null,
  });

  useEffect(() => {
    setActive(0);
  }, [query]);

  // Auto-grow single-line inputs (comments) like a chat box.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || rows > 2) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [display, rows]);

  function detect(text: string, caret: number) {
    const m = /(^|\s)@([\p{L}\p{N}_]{0,30})$/u.exec(text.slice(0, caret));
    setQuery(m ? m[2] : null);
    if (m && ref.current) {
      const r = ref.current.getBoundingClientRect();
      setPos({ left: r.left, top: r.bottom + 4 });
    }
  }

  function pick(u: { id: string; name: string }) {
    const el = ref.current!;
    const caret = el.selectionStart;
    known.current.set(u.name, u.id);
    const before = display.slice(0, caret).replace(/@([\p{L}\p{N}_]{0,30})$/u, `@${u.name} `);
    onChange(toValue(before + display.slice(caret)));
    setQuery(null);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = before.length;
    });
  }

  const list = query !== null ? people.slice(0, 6) : [];

  return (
    <>
      <textarea
        ref={ref}
        rows={rows}
        autoFocus={autoFocus}
        value={display}
        placeholder={placeholder}
        className={`block w-full resize-none bg-transparent outline-none placeholder:text-zinc-400 ${className}`}
        onBlur={() => setTimeout(() => setQuery(null), 150)}
        onChange={(e) => {
          onChange(toValue(e.target.value));
          detect(e.target.value, e.target.selectionStart);
        }}
        onKeyDown={(e) => {
          if (list.length) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % list.length); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + list.length) % list.length); return; }
            if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(list[active]); return; }
            if (e.key === 'Escape') { e.stopPropagation(); setQuery(null); return; }
          }
          if (onSubmit && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onSubmit();
        }}
      />
      {list.length > 0 && pos &&
        createPortal(
          // Portal + fixed position so the list is never clipped by a scrolling modal.
          <div className="card fixed z-[60] w-72 py-1 shadow-lg" style={{ left: pos.left, top: pos.top }}>
            {list.map((u, i) => (
              <button
                key={u.id}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); pick(u); }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left ${i === active ? 'bg-zinc-100' : ''}`}
              >
                <Avatar user={u} size={28} />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{u.name}</div>
                  <div className="truncate text-xs text-zinc-500">{u.headline}</div>
                </div>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
