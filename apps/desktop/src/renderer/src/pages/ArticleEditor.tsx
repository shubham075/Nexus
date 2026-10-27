import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImagePlus } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ErrorText } from '@/components/ui';

/** Minimal, safe Markdown renderer for articles: # headings, **bold**, *italic*, - lists, > quotes, links, images. */
export function Markdown({ text }: { text: string }) {
  const inline = (s: string): ReactNode[] => {
    const out: ReactNode[] = [];
    const re = /!\[([^\]]*)\]\((https?:[^)\s]+)\)|\[([^\]]+)\]\((https?:[^)\s]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`/g;
    let last = 0;
    let m: RegExpExecArray | null;
    let k = 0;
    while ((m = re.exec(s))) {
      if (m.index > last) out.push(s.slice(last, m.index));
      if (m[2]) out.push(<img key={k++} src={m[2]} alt={m[1]} className="my-3 max-h-96 rounded" />);
      else if (m[4]) out.push(<a key={k++} href={m[4]} target="_blank" rel="noreferrer" className="link">{m[3]}</a>);
      else if (m[5]) out.push(<strong key={k++}>{m[5]}</strong>);
      else if (m[6]) out.push(<em key={k++}>{m[6]}</em>);
      else if (m[7]) out.push(<code key={k++} className="rounded bg-zinc-100 px-1">{m[7]}</code>);
      last = m.index + m[0].length;
    }
    if (last < s.length) out.push(s.slice(last));
    return out;
  };
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="space-y-4 text-[16px] leading-7">
      {blocks.map((b, i) => {
        const lines = b.split('\n');
        if (/^#{1,3} /.test(b)) {
          const level = b.match(/^#+/)![0].length;
          const cls = level === 1 ? 'text-2xl font-bold' : level === 2 ? 'text-xl font-semibold' : 'text-lg font-semibold';
          return <div key={i} className={cls}>{inline(b.replace(/^#+ /, ''))}</div>;
        }
        if (lines.every((l) => /^[-*] /.test(l))) return <ul key={i} className="list-disc pl-6">{lines.map((l, j) => <li key={j}>{inline(l.slice(2))}</li>)}</ul>;
        if (lines.every((l) => /^\d+\. /.test(l))) return <ol key={i} className="list-decimal pl-6">{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\d+\. /, ''))}</li>)}</ol>;
        if (lines.every((l) => l.startsWith('> '))) return <blockquote key={i} className="border-l-4 border-zinc-300 pl-4 italic text-zinc-600">{inline(lines.map((l) => l.slice(2)).join(' '))}</blockquote>;
        return <p key={i}>{lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}{inline(l)}</Fragment>)}</p>;
      })}
    </div>
  );
}

export default function ArticleEditor() {
  const { id } = useParams();
  const me = useAuth((s) => s.me!);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [cover, setCover] = useState<string | null>(null);
  const [newsletterId, setNewsletterId] = useState<string>('');
  const [preview, setPreview] = useState(false);
  const existing = useQuery({ queryKey: ['article', id], queryFn: () => api.get(`/articles/${id}`), enabled: !!id });
  const newsletters = useQuery({ queryKey: ['newsletters'], queryFn: () => api.get<any[]>('/articles/newsletters/all') });

  useEffect(() => {
    if (existing.data) {
      setTitle(existing.data.title);
      setBody(existing.data.body);
      setCover(existing.data.coverUrl);
      setNewsletterId(existing.data.newsletter?.id ?? '');
    }
  }, [existing.data]);

  const publish = useMutation({
    mutationFn: () => {
      const payload = { title, body, coverUrl: cover, newsletterId: newsletterId || null };
      return id ? api.patch(`/articles/${id}`, payload) : api.post('/articles', payload);
    },
    onSuccess: (a) => { qc.invalidateQueries({ queryKey: ['articles'] }); qc.invalidateQueries({ queryKey: ['feed'] }); qc.invalidateQueries({ queryKey: ['article', a.id] }); navigate(`/articles/${a.id}`); },
  });

  async function insertImage(files: FileList | null) {
    if (!files?.[0]) return;
    const [m] = await api.upload([files[0]]);
    setBody((b) => `${b}\n\n![](${m.url})\n\n`);
  }

  const mine = (newsletters.data ?? []).filter((n) => n.owner.id === me.id);

  return (
    <div className="mx-auto max-w-[820px] px-4 py-5">
      <div className="card">
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2">
          <div className="flex gap-2">
            <button className={`chip ${!preview ? 'chip-active' : ''}`} onClick={() => setPreview(false)}>Write</button>
            <button className={`chip ${preview ? 'chip-active' : ''}`} onClick={() => setPreview(true)}>Preview</button>
          </div>
          <div className="flex items-center gap-2">
            {mine.length > 0 && (
              <select className="input w-52 py-1" value={newsletterId} onChange={(e) => setNewsletterId(e.target.value)}>
                <option value="">Standalone article</option>
                {mine.map((n) => <option key={n.id} value={n.id}>Newsletter: {n.title}</option>)}
              </select>
            )}
            <button className="btn-primary" disabled={!title.trim() || !body.trim() || publish.isPending} onClick={() => publish.mutate()}>{id ? 'Update' : 'Publish'}</button>
          </div>
        </div>
        <label className="block cursor-pointer border-b border-zinc-200 bg-zinc-50 text-center text-sm text-zinc-500">
          {cover ? <img src={cover} className="max-h-72 w-full object-cover" /> : <div className="flex flex-col items-center py-12"><ImagePlus size={32} /> Add a cover image</div>}
          <input type="file" hidden accept="image/*" onChange={async (e) => { if (e.target.files?.[0]) setCover((await api.upload([e.target.files[0]]))[0].url); }} />
        </label>
        <div className="p-8">
          <ErrorText error={publish.error} />
          {preview ? (
            <>
              <h1 className="mb-6 text-3xl font-bold">{title || 'Untitled'}</h1>
              <Markdown text={body} />
            </>
          ) : (
            <>
              <input className="mb-4 w-full text-3xl font-bold outline-none placeholder:text-zinc-400" placeholder="Headline" value={title} onChange={(e) => setTitle(e.target.value)} />
              <textarea className="min-h-[420px] w-full resize-y text-[16px] leading-7 outline-none" placeholder="Write here. Markdown supported: # Heading, **bold**, *italic*, - list, > quote, [link](https://…)" value={body} onChange={(e) => setBody(e.target.value)} />
              <label className="btn-ghost cursor-pointer"><ImagePlus size={16} /> Insert image<input type="file" hidden accept="image/*" onChange={(e) => insertImage(e.target.files)} /></label>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
