import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './lib/webBridge';
import App from './App';
import { toast } from './lib/toast';
import './index.css';
import './lib/theme';

const queryClient = new QueryClient({
  // Every failed load or action surfaces as a toast instead of a silent spinner/no-op.
  queryCache: new QueryCache({ onError: (err: any) => err?.status !== 401 && toast(err.message ?? 'Something went wrong') }),
  mutationCache: new MutationCache({ onError: (err: any) => err?.status !== 401 && toast(err.message ?? 'Something went wrong') }),
  // Retry network blips (e.g. API restart) with backoff; never retry auth/permission errors.
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      retry: (count, err: any) => ![401, 403, 404].includes(err?.status) && count < 3,
      retryDelay: (n) => Math.min(500 * 2 ** n, 4000),
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <App />
      </HashRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
