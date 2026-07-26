import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { useMemo } from 'react';
import { TradingApp } from '@/components/trading-app';

import '@solana/wallet-adapter-react-ui/styles.css';

const queryClient = new QueryClient();

function SolanaProviders({ children }: { children: React.ReactNode }) {
  const endpoint = useMemo(
    () => import.meta.env.VITE_SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com',
    [],
  );
  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={[]} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SolanaProviders>
        <TradingApp />
      </SolanaProviders>
    </QueryClientProvider>
  );
}

export default App;
