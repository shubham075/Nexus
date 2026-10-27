import { create } from 'zustand';

interface Toast {
  id: number;
  text: string;
  tone: 'error' | 'info';
}

let next = 1;

/** Minimal global toasts; fed by React Query's cache-level error handlers (see main.tsx). */
export const useToasts = create<{ toasts: Toast[]; push: (text: string, tone?: Toast['tone']) => void; dismiss: (id: number) => void }>((set, get) => ({
  toasts: [],
  push: (text, tone = 'error') => {
    if (get().toasts.some((t) => t.text === text)) return; // de-dupe bursts (e.g. server restarting)
    const id = next++;
    set((s) => ({ toasts: [...s.toasts.slice(-2), { id, text, tone }] }));
    setTimeout(() => get().dismiss(id), 5000);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = (text: string, tone?: Toast['tone']) => useToasts.getState().push(text, tone);
