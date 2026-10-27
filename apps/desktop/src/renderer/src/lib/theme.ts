import { create } from 'zustand';

export type ThemePref = 'light' | 'dark' | 'system';

const KEY = 'nexus.theme';
const media = window.matchMedia('(prefers-color-scheme: dark)');

function read(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function apply(pref: ThemePref) {
  const dark = pref === 'dark' || (pref === 'system' && media.matches);
  document.documentElement.classList.toggle('dark', dark);
}

export const useTheme = create<{ pref: ThemePref; set: (p: ThemePref) => void }>((set) => ({
  pref: read(),
  set: (pref) => {
    try {
      localStorage.setItem(KEY, pref);
    } catch {
      /* storage unavailable — theme still applies for this session */
    }
    apply(pref);
    set({ pref });
  },
}));

apply(read());
media.addEventListener('change', () => apply(useTheme.getState().pref));
