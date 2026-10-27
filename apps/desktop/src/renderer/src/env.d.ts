/// <reference types="vite/client" />
import type { NexusBridge } from '../../preload';

declare global {
  interface Window {
    nexus: NexusBridge;
  }
}
