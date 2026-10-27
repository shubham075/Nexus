import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, MapPin, Video, Link as LinkIcon } from 'lucide-react';
import { api } from '@/lib/api';
import { dateLong } from '@/lib/format';
import { Modal, Spinner, UserLine } from '@/components/ui';
import { EventForm } from './Events';

function InviteModal({ eventId, onClose }: { eventId: string; onClose: () => void }) {
  const { data = [] } = useQuery({ queryKey: ['network', 'connections'], queryFn: () => api.get<any[]>('/network/connections') });
  const [picked, setPicked] = useState<string[]>([]);
  const send = useMutation({ mutationFn: () => api.post(`/events/${eventId}/invite`, { userIds: picked }), onSuccess: onClose });
  return (
    <Modal title="Invite connections" onClose={onClose} footer={<button className="btn-primary" disabled={!picked.length} onClick={() => send.mutate()}>Invite {picked.length || ''}</button>}>
      <div className="space-y-2">
        {data.map((c) => (
          <label key={c.id} className="flex items-center gap-3">
            <input type="checkbox" className="accent-zinc-900" checked={picked.includes(c.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, c.id] : picked.filter((x) => x !== c.id))} />
            <UserLine user={c} size={32} />
          </label>
        ))}
      </div>
    </Modal>
  );
}

export default function EventPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [modal, setModal] = useState<null | 'edit' | 'invite'>(null);
  const { data: e } = useQuery({ queryKey: ['event', id], queryFn: () => api.get(`/events/${id}`) });
  const rsvp = useMutation({ mutationFn: (status: string) => api.post(`/events/${id}/rsvp`, { status }), onSuccess: () => qc.invalidateQueries({ queryKey: ['event', id] }) });
  const del = useMutation({ mutationFn: () => api.del(`/events/${id}`), onSuccess: () => navigate('/events') });
  if (!e) return <Spinner />;
  const going = e.rsvps.filter((r: any) => r.status === 'GOING');
  const interested = e.rsvps.filter((r: any) => r.status === 'INTERESTED');

  return (
    <div className="mx-auto grid max-w-[1000px] grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-5 px-4 py-5">
      <div className="card overflow-hidden">
        {e.coverUrl ? <img src={e.coverUrl} className="h-60 w-full object-cover" /> : <div className="flex h-48 items-center justify-center bg-gradient-to-br from-zinc-200 to-zinc-100 text-zinc-500"><CalendarDays size={56} /></div>}
        <div className="p-6">
          <div className="text-sm font-semibold text-red-700">{dateLong(e.startsAt)}{e.endsAt && ` – ${dateLong(e.endsAt)}`}</div>
          <h1 className="mt-1 text-2xl font-semibold">{e.title}</h1>
          <div className="mt-1 text-sm text-zinc-600">Event by <b>{e.organizer.name}</b>{e.node && ` · ${e.node.name}`}</div>
          <div className="mt-2 flex items-center gap-2 text-sm text-zinc-600">
            {e.isOnline ? <Video size={16} /> : <MapPin size={16} />} {e.isOnline ? 'Online' : e.location}
            {e.link && <a href={e.link} target="_blank" rel="noreferrer" className="link flex items-center gap-1"><LinkIcon size={14} /> Join link</a>}
          </div>
          <div className="mt-4 flex gap-2">
            <button className={e.myRsvp === 'GOING' ? 'btn-primary' : 'btn-outline'} onClick={() => rsvp.mutate('GOING')}>{e.myRsvp === 'GOING' ? '✓ Attending' : 'Attend'}</button>
            <button className={e.myRsvp === 'INTERESTED' ? 'btn-primary' : 'btn-outline'} onClick={() => rsvp.mutate('INTERESTED')}>Interested</button>
            {e.myRsvp && <button className="btn-ghost" onClick={() => rsvp.mutate('NOT_GOING')}>Can't go</button>}
            <button className="btn-ghost" onClick={() => setModal('invite')}>Invite</button>
            {e.canEdit && <button className="btn-ghost" onClick={() => setModal('edit')}>Edit</button>}
            {e.canEdit && <button className="btn-ghost text-red-600" onClick={() => confirm('Delete event?') && del.mutate()}>Delete</button>}
          </div>
          <h2 className="mt-6 font-semibold">Details</h2>
          <p className="mt-1 whitespace-pre-wrap text-sm">{e.description || 'No description.'}</p>
        </div>
      </div>
      <aside className="card self-start p-4">
        <h3 className="font-semibold">Attendees · {going.length}</h3>
        <div className="mt-3 space-y-3">{going.map((r: any) => <UserLine key={r.userId} user={r.user} size={32} />)}</div>
        {interested.length > 0 && <><h3 className="mt-5 font-semibold">Interested · {interested.length}</h3><div className="mt-3 space-y-3">{interested.map((r: any) => <UserLine key={r.userId} user={r.user} size={32} />)}</div></>}
      </aside>
      {modal === 'edit' && <EventForm initial={e} onClose={() => setModal(null)} />}
      {modal === 'invite' && <InviteModal eventId={e.id} onClose={() => setModal(null)} />}
    </div>
  );
}
