import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, MapPin, Plus, Video } from 'lucide-react';
import { format } from 'date-fns';
import { IMAGE_ACCEPT } from '@nexus/shared';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { Empty, ErrorText, Modal, Spinner, Tabs } from '@/components/ui';
import { NodeSelect } from '@/components/NodeSelect';

const toLocal = (d?: string | Date | null) => (d ? format(new Date(d), "yyyy-MM-dd'T'HH:mm") : '');

export function EventForm({ initial, onClose }: { initial?: any; onClose: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [f, setF] = useState({
    title: initial?.title ?? '', description: initial?.description ?? '', startsAt: toLocal(initial?.startsAt), endsAt: toLocal(initial?.endsAt),
    isOnline: initial?.isOnline ?? true, location: initial?.location ?? '', link: initial?.link ?? '', nodeId: initial?.nodeId ?? null,
  });
  const [cover, setCover] = useState<string | null>(initial?.coverUrl ?? null);
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, endsAt: f.endsAt || null, link: f.link || null, coverUrl: cover, startsAt: new Date(f.startsAt).toISOString() };
      return initial ? api.patch(`/events/${initial.id}`, body) : api.post('/events', body);
    },
    onSuccess: (e) => { qc.invalidateQueries({ queryKey: ['events'] }); qc.invalidateQueries({ queryKey: ['event'] }); qc.invalidateQueries({ queryKey: ['feed'] }); onClose(); if (!initial) navigate(`/events/${e.id}`); },
  });
  return (
    <Modal title={initial ? 'Edit event' : 'Create an event'} onClose={onClose} footer={<button className="btn-primary" disabled={!f.title || !f.startsAt} onClick={() => save.mutate()}>{initial ? 'Save' : 'Create'}</button>}>
      <div className="space-y-3">
        <label className="block cursor-pointer overflow-hidden rounded-lg border border-dashed border-zinc-300 text-center text-sm text-zinc-500">
          {cover ? <img src={cover} className="h-36 w-full object-cover" /> : <div className="py-8">Upload cover image</div>}
          <input type="file" hidden accept={IMAGE_ACCEPT} onChange={async (e) => { if (e.target.files?.[0]) setCover((await api.upload([e.target.files[0]]))[0].url); }} />
        </label>
        <div className="flex gap-2">
          <button type="button" className={`chip ${f.isOnline ? 'chip-active' : ''}`} onClick={() => setF({ ...f, isOnline: true })}>Online</button>
          <button type="button" className={`chip ${!f.isOnline ? 'chip-active' : ''}`} onClick={() => setF({ ...f, isOnline: false })}>In person</button>
        </div>
        <div><label className="label">Event name *</label><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Starts *</label><input type="datetime-local" className="input" value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} /></div>
          <div><label className="label">Ends</label><input type="datetime-local" className="input" value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} /></div>
        </div>
        {f.isOnline ? (
          <div><label className="label">Meeting link</label><input className="input" placeholder="https://" value={f.link} onChange={(e) => setF({ ...f, link: e.target.value })} /></div>
        ) : (
          <div><label className="label">Address / room</label><input className="input" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></div>
        )}
        <div><label className="label">Organising unit</label><NodeSelect value={f.nodeId} onChange={(nodeId) => setF({ ...f, nodeId })} placeholder="Whole company" /></div>
        <div><label className="label">Description</label><textarea className="input" rows={4} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
        <ErrorText error={save.error} />
      </div>
    </Modal>
  );
}

export default function Events() {
  const canCreate = useCan('event.create');
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['events', tab], queryFn: () => api.get<any[]>(`/events?past=${tab === 'past'}`) });
  const rsvp = useMutation({ mutationFn: ({ id, status }: { id: string; status: string }) => api.post(`/events/${id}/rsvp`, { status }), onSuccess: () => qc.invalidateQueries({ queryKey: ['events'] }) });
  return (
    <div className="mx-auto max-w-[860px] space-y-2 px-4 py-5">
      <div className="card">
        <div className="flex items-center justify-between px-4 pt-3">
          <h1 className="text-xl font-semibold">Events</h1>
          {canCreate && <button className="btn-outline" onClick={() => setParams({ new: '1' })}><Plus size={16} /> Create event</button>}
        </div>
        <Tabs value={tab} onChange={setTab} tabs={[{ value: 'upcoming', label: 'Upcoming' }, { value: 'past', label: 'Past' }]} />
        {isLoading && <Spinner />}
        <div className="grid grid-cols-2 gap-3 p-4">
          {(data ?? []).map((e) => (
            <div key={e.id} className="overflow-hidden rounded-lg border border-zinc-200">
              <Link to={`/events/${e.id}`}>
                {e.coverUrl ? <img src={e.coverUrl} className="h-28 w-full object-cover" /> : <div className="flex h-28 items-center justify-center bg-gradient-to-br from-zinc-200 to-zinc-100 text-zinc-500"><CalendarDays size={36} /></div>}
              </Link>
              <div className="p-3">
                <div className="text-xs font-semibold text-red-700">{format(new Date(e.startsAt), 'EEE, MMM d · h:mm a')}</div>
                <Link to={`/events/${e.id}`} className="font-semibold hover:underline">{e.title}</Link>
                <div className="muted flex items-center gap-1">{e.isOnline ? <Video size={12} /> : <MapPin size={12} />} {e.isOnline ? 'Online' : e.location} · {e.goingCount} going</div>
                {tab === 'upcoming' && (
                  <button className={`mt-2 w-full ${e.myRsvp === 'GOING' ? 'btn-primary' : 'btn-outline'} py-1`} onClick={() => rsvp.mutate({ id: e.id, status: e.myRsvp === 'GOING' ? 'NOT_GOING' : 'GOING' })}>
                    {e.myRsvp === 'GOING' ? '✓ Attending' : 'Attend'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        {!isLoading && !data?.length && <Empty icon={<CalendarDays size={40} />} title="No events" />}
      </div>
      {params.get('new') && canCreate && <EventForm onClose={() => setParams({})} />}
    </div>
  );
}
