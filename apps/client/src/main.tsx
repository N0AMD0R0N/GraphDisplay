import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'styled-components';
import { App } from './App';
import { useUI } from './store';
import { GlobalStyle, lightTheme } from './theme';
import { readUrl } from './urlSync';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 } },
});

// open the graph named in the address bar (the query panel restores the query from it)
const fromUrl = readUrl();
if (fromUrl.graph) useUI.setState({ graphId: fromUrl.graph });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={lightTheme}>
        <GlobalStyle />
        <App />
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
