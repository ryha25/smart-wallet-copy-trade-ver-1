export interface MarketDataService {
  getTokenPrice(tokenMint: string): Promise<{ usd: number; sol: number }>;
  getTokenMetrics(tokenMint: string): Promise<{ liquidityUsd: number; marketCapUsd: number }>;
}

export class MockMarketDataService implements MarketDataService {
  async getTokenPrice() { return { usd: 1.24, sol: 0.0068 }; }
  async getTokenMetrics() { return { liquidityUsd: 850_000, marketCapUsd: 12_400_000 }; }
}

export function createMarketDataService(): MarketDataService {
  // BIRDEYE_API_KEY / JUPITER_API_KEYが設定されたら実装クラスへ差し替える。
  return new MockMarketDataService();
}
