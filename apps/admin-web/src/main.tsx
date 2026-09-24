import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/styles/globals.css';
import { App } from '@/app/App';
import { AppProviders, createQueryClient } from '@/app/providers';

const queryClient = createQueryClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProviders client={queryClient}>
      <App />
    </AppProviders>
  </StrictMode>,
);
