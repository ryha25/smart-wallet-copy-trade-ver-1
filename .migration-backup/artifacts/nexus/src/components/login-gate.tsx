"use client";

import { FormEvent, useEffect, useState } from "react";
import { LockKeyhole, LogOut } from "lucide-react";

type AuthState =
  | { status: "loading" }
  | { status: "guest"; configurationError?: string | null }
  | { status: "authenticated"; username: string };

async function readJson(response: Response) {
  const raw = await response.text();
  try {
    return raw ? JSON.parse(raw) as Record<string, unknown> : {};
  } catch {
    return { error: `サーバー応答をJSONとして解析できません（HTTP ${response.status}）`, details: raw.slice(0, 500) };
  }
}

export function LoginGate({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = useState<AuthState>({ status: "loading" });
  const [username, setUsername] = useState("");
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void fetch("/api/auth/session", { cache: "no-store", credentials: "include" })
      .then(async response => {
        const payload = await readJson(response);
        setAuth(response.ok
          ? { status: "authenticated", username: String(payload.username ?? "") }
          : { status: "guest", configurationError: payload.configurationError ? String(payload.configurationError) : null });
      })
      .catch(sessionError => {
        setAuth({ status: "guest" });
        setError(sessionError instanceof Error ? sessionError.message : "認証状態を確認できません");
      });
  }, []);

  const login = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (Array.from(passcode).length !== 6) {
      setError("パスコードは6文字で入力してください");
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, passcode }),
        credentials: "include",
      });
      const payload = await readJson(response);
      if (!response.ok) throw new Error(String(payload.error ?? "ログインできません"));
      setPasscode("");
      setAuth({ status: "authenticated", username: String(payload.username ?? username) });
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "ログインできません");
    } finally {
      setSubmitting(false);
    }
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" }).catch(() => undefined);
    setAuth({ status: "guest" });
  };

  if (auth.status === "loading") {
    return <div className="flex min-h-screen items-center justify-center bg-[#070b0d] text-sm text-[#7f9299]">認証情報を確認しています…</div>;
  }

  if (auth.status === "guest") {
    return (
      <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#070b0d] p-5">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_15%,rgba(28,231,164,0.13),transparent_36%)]" />
        <form onSubmit={login} className="relative w-full max-w-md rounded-3xl border border-white/10 bg-[#0d1417]/95 p-7 shadow-2xl shadow-black/50">
          <div className="mb-7 flex items-center gap-4">
            <img src="/next-trade-icon.png" alt="NEXT-TRADE" className="h-14 w-14 rounded-2xl object-contain" />
            <div>
              <h1 className="font-bold tracking-[.12em] text-white">NEXT-TRADE</h1>
              <p className="mt-1 text-xs text-[#6f838a]">SMART WALLET COPY</p>
            </div>
          </div>
          <div className="mb-6 flex items-center gap-2 text-sm font-semibold text-white"><LockKeyhole size={17} className="text-[#38e7ae]" />ログイン</div>
          <label className="mb-4 block">
            <span className="mb-2 block text-xs text-[#8b9ca2]">ユーザー名</span>
            <input value={username} onChange={event => setUsername(event.target.value)} autoComplete="username" required className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-base text-white outline-none focus:border-[#38e7ae]/60" />
          </label>
          <label className="mb-5 block">
            <span className="mb-2 block text-xs text-[#8b9ca2]">6文字のパスコード</span>
            <input type="password" value={passcode} onChange={event => setPasscode(event.target.value)} autoComplete="current-password" minLength={6} maxLength={6} required inputMode="numeric" className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-base tracking-[.35em] text-white outline-none focus:border-[#38e7ae]/60" />
          </label>
          {auth.configurationError && <p className="mb-4 whitespace-pre-wrap rounded-xl border border-amber-400/20 bg-amber-400/10 p-3 text-xs text-amber-200">{auth.configurationError}</p>}
          {error && <p className="mb-4 whitespace-pre-wrap rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-xs text-rose-200">{error}</p>}
          <button disabled={submitting} className="w-full rounded-xl bg-[#38e7ae] px-4 py-3 font-semibold text-[#03100c] transition hover:bg-[#55f0bd] disabled:opacity-50">
            {submitting ? "ログイン中…" : "ログイン"}
          </button>
          <p className="mt-5 text-center text-[10px] leading-relaxed text-[#53666d]">秘密鍵・シードフレーズは入力しないでください</p>
        </form>
      </main>
    );
  }

  return (
    <>
      <button onClick={logout} className="fixed bottom-4 right-4 z-50 flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#0b1114]/90 px-3 py-2 text-[10px] text-[#839299] shadow-lg backdrop-blur hover:text-white">
        <LogOut size={13} />ログアウト
      </button>
      {children}
    </>
  );
}
