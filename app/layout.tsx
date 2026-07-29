import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "NEXT-TRADE",
  description: "Solanaの実ウォレットを分析し、仮想資金でコピー取引を検証する日本語ダッシュボード",
  applicationName: "NEXT-TRADE",
  manifest: "/site.webmanifest",
  icons: {
    icon: "/icon-192.png?v=3",
    apple: "/apple-touch-icon.png?v=3",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
