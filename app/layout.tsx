import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "NEXUS — Smart Wallet Copy Trade",
  description: "Solanaの実ウォレットを分析し、仮想資金でコピー取引を検証する日本語ダッシュボード",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
