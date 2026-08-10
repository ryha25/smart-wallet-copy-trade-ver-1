import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { useMemo } from 'react';
import { TradingApp } from '@/components/trading-app';
import { LoginGate } from '@/components/login-gate';

import '@solana/wallet-adapter-react-ui/styles.css';

function safeRpcEndpoint(configured: string | undefined) {
  const fallback = 'https://api.mainnet-beta.solana.com';
  if (!configured) return fallback;
  try {
    const url = new URL(configured);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`Unsupported protocol: ${url.protocol}`);
    return url.toString();
  } catch (error) {
    console.error('[NEXT-TRADE][rpc.config] VITE_SOLANA_RPC_URL is invalid; using public RPC', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return fallback;
  }
}

function SolanaProviders({ children }: { children: React.ReactNode }) {
  const endpoint = useMemo(
    () => safeRpcEndpoint(import.meta.env.VITE_SOLANA_RPC_URL),
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
    <SolanaProviders>
      <LoginGate><TradingApp /></LoginGate>
    </SolanaProviders>
  );
}

export default App;
