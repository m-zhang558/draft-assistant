import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app';
import { initialiseAppBoardStore } from '@/state';
import '@/app/styles/tokens.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found');
}

// Render immediately with the store's `status: 'loading'` shell (`App.tsx`) rather than
// awaiting the database here — the board must never paint over unhydrated state, and `App`
// already enforces that by gating on `status`. `initialiseAppBoardStore` flips the store to
// `'ready'` (or `'error'`) asynchronously; React re-renders when it does.
void initialiseAppBoardStore();

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
