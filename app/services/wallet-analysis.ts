import { wallets } from "../lib/mock-data";

export interface WalletAnalysisService {
  getQualifiedWallets(): Promise<typeof wallets>;
}

export class MockWalletAnalysisService implements WalletAnalysisService {
  async getQualifiedWallets() {
    return wallets.filter(w => w.roi30d >= 60 && w.realizedProfitUsd > 0 && w.trades30d >= 20 && w.ageDays >= 90);
  }
}

export function createWalletAnalysisService(): WalletAnalysisService {
  // HELIUS_API_KEYが設定されたらオンチェーン分析実装へ差し替える。
  return new MockWalletAnalysisService();
}
