"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { login } from "../actions";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!password) {
      setError("Masukkan password terlebih dahulu");
      return;
    }

    startTransition(async () => {
      const result = await login(password);
      if (result.success) {
        router.push("/");
        router.refresh();
      } else {
        setError(result.error || "Password salah");
      }
    });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-4 py-12 sm:px-6 lg:px-8 font-sans antialiased selection:bg-indigo-500 selection:text-white">
      {/* Background Gradients */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[40%] -left-[20%] w-[80%] h-[80%] rounded-full bg-gradient-to-tr from-indigo-900/20 to-purple-900/10 blur-[120px]" />
        <div className="absolute -bottom-[40%] -right-[20%] w-[80%] h-[80%] rounded-full bg-gradient-to-br from-blue-900/20 to-indigo-900/10 blur-[120px]" />
      </div>

      <div className="relative w-full max-w-md z-10">
        {/* Card Frame */}
        <div className="rounded-3xl border border-zinc-800/80 bg-zinc-900/50 backdrop-blur-xl p-8 shadow-2xl shadow-black/80">
          <div className="flex flex-col items-center text-center mb-8">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-500/10 border border-indigo-500/20 mb-4">
              <svg
                className="h-6 w-6 text-indigo-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                />
              </svg>
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Backup Dashboard
            </h2>
            <p className="mt-2 text-sm text-zinc-400">
              Masukkan password untuk mengelola backup database Neon
            </p>
          </div>

          <form className="space-y-6" onSubmit={handleSubmit}>
            <div>
              <label
                htmlFor="password"
                className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2"
              >
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isPending}
                placeholder="••••••••"
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950/60 py-3 px-4 text-white placeholder-zinc-600 outline-none transition duration-200 focus:border-indigo-500/80 focus:bg-zinc-950 focus:ring-1 focus:ring-indigo-500/30"
              />
            </div>

            {error && (
              <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3.5 text-sm text-red-400 flex items-start gap-2.5 animate-in fade-in slide-in-from-top-1 duration-200">
                <svg
                  className="h-5 w-5 shrink-0 text-red-400 mt-0.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isPending}
              className="relative flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-700 py-3.5 text-sm font-semibold text-white shadow-lg shadow-indigo-900/30 outline-none transition duration-200 hover:from-indigo-500 hover:to-indigo-600 focus:ring-2 focus:ring-indigo-500/50 active:scale-[0.98] disabled:scale-100 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isPending ? (
                <div className="flex items-center gap-2">
                  <svg
                    className="h-5 w-5 animate-spin text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  <span>Memverifikasi...</span>
                </div>
              ) : (
                <span>Masuk Ke Dashboard</span>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
