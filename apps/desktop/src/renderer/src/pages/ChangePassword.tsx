import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ErrorText } from '@/components/ui';

export default function ChangePassword({ forced }: { forced?: boolean }) {
  const { refresh, logout } = useAuth();
  const navigate = useNavigate();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);

  return (
    <div className="flex h-full items-start justify-center pt-20">
      <div className="card w-full max-w-md p-6">
        <h1 className="text-xl font-semibold">{forced ? 'Set your password' : 'Change password'}</h1>
        {forced && <p className="mt-1 text-sm text-zinc-600">Your administrator gave you a temporary password. Choose a new one to continue.</p>}
        <form
          className="mt-5 space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            if (next !== confirm) return setError(new Error('Passwords do not match'));
            try {
              await api.post('/auth/change-password', { currentPassword: cur, newPassword: next });
              setDone(true);
              await refresh();
              if (!forced) setTimeout(() => navigate(-1), 800);
            } catch (err) {
              setError(err);
            }
          }}
        >
          <div>
            <label className="label">Current password</label>
            <input className="input" type="password" value={cur} onChange={(e) => setCur(e.target.value)} required />
          </div>
          <div>
            <label className="label">New password (min 8 characters)</label>
            <input className="input" type="password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} />
          </div>
          <div>
            <label className="label">Confirm new password</label>
            <input className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </div>
          <ErrorText error={error} />
          {done && <div className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">Password updated.</div>}
          <div className="flex justify-between pt-2">
            {forced ? <button type="button" className="btn-ghost" onClick={logout}>Sign out</button> : <span />}
            <button className="btn-primary">Save password</button>
          </div>
        </form>
      </div>
    </div>
  );
}
