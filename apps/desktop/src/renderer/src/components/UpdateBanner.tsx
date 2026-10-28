import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import type { UpdateState } from '../../../main/updater';

/** Shown once an update has downloaded in the background. Installing waits for the user's click (or the next quit). */
export function UpdateBanner() {
  const [state, setState] = useState<UpdateState>({ status: 'idle' });
  const [hidden, setHidden] = useState<string | null>(null);

  useEffect(() => {
    window.nexus.update.get().then(setState);
    return window.nexus.update.onStatus(setState);
  }, []);

  if (state.status !== 'ready' || hidden === state.version) return null;

  return (
    <div className="flex items-center justify-center gap-3 border-b border-zinc-200 bg-surface px-4 py-2 text-sm text-zinc-700">
      <Download size={15} className="text-zinc-500" />
      <span>Nexus {state.version} is ready. It installs the next time you quit, or restart now.</span>
      <button className="btn-primary px-3 py-1 text-xs" onClick={() => window.nexus.update.install()}>
        Restart to update
      </button>
      <button className="rounded-full p-1 text-zinc-500 hover:bg-zinc-100" onClick={() => setHidden(state.version)} aria-label="Later">
        <X size={14} />
      </button>
    </div>
  );
}
