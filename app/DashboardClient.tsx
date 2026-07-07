"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  deleteBackupFile,
  deleteDatabase,
  listBackupsForDatabase,
  logout,
  registerDatabase,
  triggerManualBackup,
  updateDatabaseSettings,
} from "./actions";

interface BackupFile {
  url: string;
  pathname: string;
  size: number;
  uploadedAt: string | Date;
}

interface DatabaseTarget {
  id: number;
  name: string;
  encryptedUrl: string;
  interval: "3_DAYS" | "1_WEEK" | "1_MONTH" | "1_YEAR" | "CUSTOM";
  customDays: number | null;
  maxFiles: number;
  lastSuccessAt: string | null;
  lastStatus: "SUCCESS" | "FAILED" | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

interface DashboardClientProps {
  initialDatabases: DatabaseTarget[];
  initialBackups: BackupFile[];
}

function formatBytes(bytes: number, decimals = 2) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / k ** i).toFixed(dm))} ${sizes[i]}`;
}

export default function DashboardClient({
  initialDatabases,
  initialBackups,
}: DashboardClientProps) {
  const router = useRouter();
  const [databases, _setDatabases] =
    useState<DatabaseTarget[]>(initialDatabases);
  const [selectedDb, setSelectedDb] = useState<DatabaseTarget | null>(
    initialDatabases.length > 0 ? initialDatabases[0] : null,
  );
  const [backups, setBackups] = useState<BackupFile[]>(initialBackups);
  const [isRegistering, setIsRegistering] = useState(
    initialDatabases.length === 0,
  );

  // Form State for Active Database Settings / Registration
  const [name, setName] = useState(selectedDb?.name || "");
  const [url, setUrl] = useState(""); // Leave blank to denote unchanged connection string
  const [interval, setIntervalVal] = useState(selectedDb?.interval || "1_WEEK");
  const [customDays, setCustomDays] = useState(selectedDb?.customDays || 3);
  const [maxFiles, setMaxFiles] = useState(selectedDb?.maxFiles || 10);

  // Transitions
  const [isBackupPending, startBackupTransition] = useTransition();
  const [isSettingsPending, startSettingsTransition] = useTransition();
  const [isLoadingBackups, startLoadingBackups] = useTransition();
  const [deletingUrls, setDeletingUrls] = useState<Record<string, boolean>>({});
  const [isLoggingOut, startLogoutTransition] = useTransition();

  // Notification Toast State
  const [notification, setNotification] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const showNotification = (type: "success" | "error", message: string) => {
    setNotification({ type, message });
    setTimeout(() => {
      setNotification(null);
    }, 5000);
  };

  // Select a database from the sidebar
  const handleSelectDatabase = (dbRecord: DatabaseTarget) => {
    setSelectedDb(dbRecord);
    setIsRegistering(false);

    // Reset form states
    setName(dbRecord.name);
    setUrl(""); // Keep blank to denote unchanged
    setIntervalVal(dbRecord.interval);
    setCustomDays(dbRecord.customDays || 3);
    setMaxFiles(dbRecord.maxFiles);

    // Fetch its backups
    startLoadingBackups(async () => {
      const res = await listBackupsForDatabase(dbRecord.id);
      if (res.success && res.backups) {
        setBackups(res.backups);
      } else {
        setBackups([]);
        showNotification("error", `Gagal memuat backups: ${res.error}`);
      }
    });
  };

  // Toggle to database registration form
  const handleStartRegistering = () => {
    setIsRegistering(true);
    setSelectedDb(null);
    setName("");
    setUrl("");
    setIntervalVal("1_WEEK");
    setCustomDays(3);
    setMaxFiles(10);
    setBackups([]);
  };

  // Submit new database target
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !url) {
      showNotification("error", "Nama dan connection string wajib diisi");
      return;
    }

    startSettingsTransition(async () => {
      const res = await registerDatabase({
        name,
        url,
        interval,
        customDays: interval === "CUSTOM" ? Number(customDays) : null,
        maxFiles: Number(maxFiles),
      });

      if (res.success && res.database) {
        showNotification("success", `Database "${name}" berhasil didaftarkan!`);
        setName("");
        setUrl("");
        router.refresh();

        // Slightly delay local state reload
        setTimeout(async () => {
          window.location.reload(); // Force full reload to reset lists cleanly
        }, 1000);
      } else {
        showNotification("error", `Gagal mendaftarkan database: ${res.error}`);
      }
    });
  };

  // Save changes of active database settings
  const handleSaveChanges = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDb) return;

    startSettingsTransition(async () => {
      const res = await updateDatabaseSettings(selectedDb.id, {
        name,
        url: url.trim() !== "" ? url : undefined,
        interval,
        customDays: interval === "CUSTOM" ? Number(customDays) : null,
        maxFiles: Number(maxFiles),
      });

      if (res.success) {
        showNotification("success", "Pengaturan berhasil diperbarui!");
        router.refresh();

        // Refresh local database targets list
        setTimeout(async () => {
          window.location.reload();
        }, 1000);
      } else {
        showNotification("error", `Gagal memperbarui: ${res.error}`);
      }
    });
  };

  // Delete database target
  const handleDeleteDatabase = async () => {
    if (!selectedDb) return;
    if (
      !confirm(
        `Apakah Anda yakin ingin menghapus database target "${selectedDb.name}"?\n\nTindakan ini juga akan MENGHAPUS SEMUA file backup terkait di Vercel Blob!`,
      )
    ) {
      return;
    }

    startSettingsTransition(async () => {
      const res = await deleteDatabase(selectedDb.id);
      if (res.success) {
        showNotification(
          "success",
          `Database "${selectedDb.name}" telah dihapus.`,
        );
        window.location.reload();
      } else {
        showNotification("error", `Gagal menghapus: ${res.error}`);
      }
    });
  };

  // Trigger manual backup override
  const handleTriggerBackup = () => {
    if (!selectedDb) return;

    startBackupTransition(async () => {
      const res = await triggerManualBackup(selectedDb.id);
      if (res.success) {
        showNotification(
          "success",
          `Backup berhasil! File diupload: ${res.path} (${formatBytes(res.sizeBytes || 0)})`,
        );
        router.refresh();

        // Reload backup files list
        setTimeout(async () => {
          const listRes = await listBackupsForDatabase(selectedDb.id);
          if (listRes.success && listRes.backups) {
            setBackups(listRes.backups);
          }
          // Reload settings to update last success timestamp
          window.location.reload();
        }, 1000);
      } else {
        showNotification("error", `Backup gagal: ${res.error}`);
      }
    });
  };

  // Delete a specific backup file
  const handleDeleteFile = async (fileUrl: string, pathname: string) => {
    const filename = pathname.split("/").pop() || "backup.sql.gz";
    if (
      !confirm(`Apakah Anda yakin ingin menghapus backup file "${filename}"?`)
    ) {
      return;
    }

    setDeletingUrls((prev) => ({ ...prev, [fileUrl]: true }));

    const res = await deleteBackupFile(fileUrl);
    if (res.success) {
      showNotification("success", "File backup berhasil dihapus.");
      setBackups((prev) => prev.filter((b) => b.url !== fileUrl));
      router.refresh();
    } else {
      showNotification("error", `Gagal menghapus file: ${res.error}`);
    }

    setDeletingUrls((prev) => ({ ...prev, [fileUrl]: false }));
  };

  // Logout
  const handleLogout = () => {
    startLogoutTransition(async () => {
      await logout();
      router.push("/login");
      router.refresh();
    });
  };

  // Calculate Next Backup Time
  const getNextBackupTime = () => {
    if (!selectedDb || !selectedDb.lastSuccessAt)
      return "Segera pada jadwal cron berikutnya";
    const lastRun = new Date(selectedDb.lastSuccessAt).getTime();
    let intervalMs = 0;
    if (selectedDb.interval === "CUSTOM") {
      const days = selectedDb.customDays || 1;
      intervalMs = days * 24 * 60 * 60 * 1000;
    } else {
      const map = {
        "3_DAYS": 3 * 24 * 60 * 60 * 1000,
        "1_WEEK": 7 * 24 * 60 * 60 * 1000,
        "1_MONTH": 30 * 24 * 60 * 60 * 1000,
        "1_YEAR": 365 * 24 * 60 * 60 * 1000,
      };
      intervalMs = map[selectedDb.interval] || map["1_WEEK"];
    }
    return new Date(lastRun + intervalMs).toLocaleString("id-ID", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-indigo-500 selection:text-white flex flex-col lg:flex-row relative">
      {/* Background glow effects */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute -top-[30%] -left-[10%] w-[60%] h-[60%] rounded-full bg-gradient-to-tr from-indigo-900/10 to-indigo-500/5 blur-[140px]" />
        <div className="absolute bottom-[10%] right-[-10%] w-[60%] h-[60%] rounded-full bg-gradient-to-br from-violet-900/10 to-purple-500/5 blur-[140px]" />
      </div>

      {/* Toast Notification */}
      {notification && (
        <div className="fixed top-6 right-6 z-50 animate-in fade-in slide-in-from-top-4 duration-300">
          <div
            className={`flex items-center gap-3 rounded-2xl border px-5 py-4 shadow-2xl backdrop-blur-md ${
              notification.type === "success"
                ? "border-emerald-500/20 bg-emerald-950/70 text-emerald-300"
                : "border-red-500/20 bg-red-950/70 text-red-300"
            }`}
          >
            {notification.type === "success" ? (
              <svg
                className="h-6 w-6 text-emerald-400 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            ) : (
              <svg
                className="h-6 w-6 text-red-400 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            )}
            <span className="text-sm font-medium">{notification.message}</span>
          </div>
        </div>
      )}

      {/* Left Sidebar: Databases List */}
      <aside className="w-full lg:w-80 shrink-0 border-b lg:border-b-0 lg:border-r border-zinc-900 bg-zinc-950/60 backdrop-blur-md p-6 flex flex-col justify-between relative z-10">
        <div>
          {/* Brand Header */}
          <div className="flex items-center gap-3 mb-8">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-600 text-white shadow-lg shadow-indigo-500/20">
              <svg
                className="h-5.5 w-5.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"
                />
              </svg>
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight text-white">
                Multi-Backup Admin
              </h1>
              <p className="text-xxs text-zinc-500 uppercase tracking-widest font-semibold mt-0.5">
                Neon Postgres
              </p>
            </div>
          </div>

          {/* Database List */}
          <div className="space-y-1.5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 px-3 mb-3">
              Target Database
            </h2>

            {databases.length === 0 ? (
              <div className="text-xs text-zinc-500 px-3 py-4 border border-dashed border-zinc-800 rounded-xl text-center">
                Belum ada database terdaftar
              </div>
            ) : (
              databases.map((dbTarget) => {
                const isActive = selectedDb?.id === dbTarget.id;
                return (
                  <button
                    key={dbTarget.id}
                    onClick={() => handleSelectDatabase(dbTarget)}
                    className={`w-full flex items-center justify-between rounded-xl px-4 py-3 text-sm font-medium transition ${
                      isActive
                        ? "bg-indigo-600/10 text-indigo-400 border border-indigo-500/20 shadow-lg shadow-indigo-900/5"
                        : "text-zinc-400 hover:text-white hover:bg-zinc-900/50 border border-transparent"
                    }`}
                  >
                    <span className="truncate pr-2">{dbTarget.name}</span>
                    <span
                      className={`h-2 w-2 rounded-full shrink-0 ${
                        dbTarget.lastStatus === "SUCCESS"
                          ? "bg-emerald-500 shadow-md shadow-emerald-500/50 animate-pulse"
                          : dbTarget.lastStatus === "FAILED"
                            ? "bg-red-500 shadow-md shadow-red-500/50 animate-pulse"
                            : "bg-zinc-700"
                      }`}
                    />
                  </button>
                );
              })
            )}

            <button
              onClick={handleStartRegistering}
              className={`w-full flex items-center justify-center gap-2 rounded-xl border border-dashed py-3 px-4 text-xs font-bold transition mt-4 ${
                isRegistering
                  ? "border-indigo-500/40 text-indigo-400 bg-indigo-600/5"
                  : "border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-600 hover:bg-zinc-900/30"
              }`}
            >
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 4v16m8-8H4"
                />
              </svg>
              Daftarkan DB Baru
            </button>
          </div>
        </div>

        {/* Sidebar Footer Logout */}
        <button
          onClick={handleLogout}
          disabled={isLoggingOut}
          className="w-full flex items-center justify-center gap-2 rounded-xl border border-zinc-900 bg-zinc-950 hover:bg-zinc-900 py-3 px-4 text-xs font-bold text-zinc-500 hover:text-white transition duration-200 mt-8 lg:mt-0"
        >
          {isLoggingOut ? "Logging out..." : "Keluar"}
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
            />
          </svg>
        </button>
      </aside>

      {/* Right Content Panel */}
      <main className="flex-1 p-6 sm:p-8 lg:p-10 relative z-10 flex flex-col gap-8 max-w-6xl mx-auto overflow-hidden">
        {/* Case 1: Database Registration Screen */}
        {isRegistering && (
          <section className="rounded-3xl border border-zinc-900 bg-zinc-900/30 backdrop-blur-xl p-8 max-w-2xl animate-in fade-in duration-300">
            <h2 className="text-xl font-bold text-white mb-2">
              Daftarkan Database Target Baru
            </h2>
            <p className="text-sm text-zinc-400 mb-6">
              Masukkan kredensial database target. URL koneksi akan disimpan
              terenkripsi.
            </p>

            <form onSubmit={handleRegister} className="space-y-5">
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">
                  Nama Database Target
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 py-3.5 px-4 text-sm text-white placeholder-zinc-700 outline-none transition focus:border-indigo-500"
                  placeholder="Contoh: Production Client DB"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">
                  Connection String (DATABASE_URL)
                </label>
                <input
                  type="password"
                  required
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 py-3.5 px-4 text-sm text-white placeholder-zinc-700 outline-none transition focus:border-indigo-500 font-mono"
                  placeholder="postgres://user:password@host/dbname?sslmode=require"
                />
                <p className="mt-1.5 text-xxs text-zinc-500 leading-4">
                  * Kredensial akan langsung di-enkripsi di server menggunakan
                  standard AES-256-CBC sebelum masuk database.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">
                    Interval Backup
                  </label>
                  <select
                    value={interval}
                    onChange={(e) => setIntervalVal(e.target.value as any)}
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-950 py-3.5 px-4 text-sm text-white outline-none transition focus:border-indigo-500"
                  >
                    <option value="3_DAYS">Setiap 3 Hari</option>
                    <option value="1_WEEK">Setiap 1 Minggu</option>
                    <option value="1_MONTH">Setiap 1 Bulan</option>
                    <option value="1_YEAR">Setiap 1 Tahun</option>
                    <option value="CUSTOM">Kustom (Hari)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">
                    Maksimal Jumlah File Backup
                  </label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={maxFiles}
                    onChange={(e) => setMaxFiles(Number(e.target.value))}
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-950 py-3.5 px-4 text-sm text-white outline-none transition focus:border-indigo-500"
                  />
                </div>
              </div>

              {interval === "CUSTOM" && (
                <div className="animate-in slide-in-from-top-2 duration-200">
                  <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">
                    Jumlah Hari Kustom
                  </label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={customDays}
                    onChange={(e) => setCustomDays(Number(e.target.value))}
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-950 py-3.5 px-4 text-sm text-white outline-none transition focus:border-indigo-500"
                    placeholder="Contoh: 5"
                  />
                </div>
              )}

              <button
                type="submit"
                disabled={isSettingsPending}
                className="w-full flex items-center justify-center rounded-xl bg-indigo-600 py-4 px-4 text-sm font-bold text-white shadow-lg shadow-indigo-900/30 outline-none transition hover:bg-indigo-500 active:scale-[0.98] disabled:opacity-50"
              >
                {isSettingsPending ? "Mendaftarkan..." : "Daftarkan Database"}
              </button>
            </form>
          </section>
        )}

        {/* Case 2: Active Database Target Detail View */}
        {selectedDb && !isRegistering && (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-8 items-start">
            {/* Left Content (2 cols): Details and backups list */}
            <div className="xl:col-span-2 flex flex-col gap-8">
              {/* Header Details */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-zinc-900/10 border border-zinc-900 p-6 rounded-3xl">
                <div>
                  <h2 className="text-xl font-bold text-white">
                    {selectedDb.name}
                  </h2>
                  <p className="text-xs text-zinc-500 mt-1">
                    ID Target: DB-{selectedDb.id} • Dibuat:{" "}
                    {new Date(selectedDb.createdAt).toLocaleDateString()}
                  </p>
                </div>

                <button
                  onClick={handleTriggerBackup}
                  disabled={isBackupPending || isLoadingBackups}
                  className="flex items-center justify-center gap-2 rounded-2xl bg-indigo-600/10 hover:bg-indigo-600 border border-indigo-500/20 hover:border-indigo-500 text-indigo-400 hover:text-white px-5 py-3 text-sm font-bold transition shadow-lg disabled:opacity-50"
                >
                  {isBackupPending ? (
                    <>
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
                      <span>Memproses Backup...</span>
                    </>
                  ) : (
                    <>
                      <svg
                        className="h-4.5 w-4.5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 8H17"
                        />
                      </svg>
                      <span>Backup Sekarang</span>
                    </>
                  )}
                </button>
              </div>

              {/* Backups List Card */}
              <section className="rounded-3xl border border-zinc-900 bg-zinc-900/30 backdrop-blur-xl p-6 min-h-[300px] flex flex-col">
                <div className="flex items-center justify-between mb-6 pb-4 border-b border-zinc-900">
                  <div>
                    <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-400">
                      File Backup di Vercel Blob
                    </h3>
                    <p className="text-xs text-zinc-500 mt-1">
                      Menampilkan file terkompresi (.sql.gz)
                    </p>
                  </div>
                  <span className="rounded-lg bg-zinc-900 px-3 py-1 text-xs font-semibold text-indigo-400 border border-zinc-800">
                    {backups.length} file
                  </span>
                </div>

                {isLoadingBackups ? (
                  <div className="flex-1 flex items-center justify-center py-16">
                    <svg
                      className="h-8 w-8 animate-spin text-indigo-500"
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
                  </div>
                ) : backups.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center py-16 text-center">
                    <div className="h-14 w-14 text-zinc-700 mb-3 bg-zinc-900/50 rounded-2xl flex items-center justify-center border border-zinc-800">
                      <svg
                        className="h-7 w-7"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={1.5}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                        />
                      </svg>
                    </div>
                    <h4 className="text-sm font-bold text-zinc-300">
                      Belum ada file backup
                    </h4>
                    <p className="text-xs text-zinc-500 mt-1 max-w-xs">
                      Klik tombol &ldquo;Backup Sekarang&rdquo; untuk membuat
                      backup target pertamanya.
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-zinc-900 text-xxs font-semibold text-zinc-500 uppercase tracking-wider">
                          <th className="pb-3 font-semibold">Nama File</th>
                          <th className="pb-3 font-semibold">Ukuran</th>
                          <th className="pb-3 font-semibold">Tanggal Dibuat</th>
                          <th className="pb-3 text-right font-semibold">
                            Aksi
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-900/60">
                        {backups.map((file) => {
                          const filename =
                            file.pathname.split("/").pop() || "backup.sql.gz";
                          const isDeleting = deletingUrls[file.url];

                          return (
                            <tr
                              key={file.url}
                              className="group hover:bg-zinc-900/10 transition"
                            >
                              <td className="py-3.5 pr-2 font-mono text-xxs text-white max-w-[200px] truncate">
                                <span className="flex items-center gap-2">
                                  <svg
                                    className="h-4 w-4 text-zinc-500 shrink-0"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                    strokeWidth={2}
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                                    />
                                  </svg>
                                  <span title={filename}>{filename}</span>
                                </span>
                              </td>
                              <td className="py-3.5 px-2 text-zinc-400 font-medium">
                                {formatBytes(file.size)}
                              </td>
                              <td className="py-3.5 px-2 text-zinc-400">
                                {new Date(file.uploadedAt).toLocaleString(
                                  "id-ID",
                                  {
                                    dateStyle: "medium",
                                    timeStyle: "short",
                                  },
                                )}
                              </td>
                              <td className="py-3.5 pl-2 text-right">
                                <div className="flex items-center justify-end gap-2">
                                  <a
                                    href={`/api/backup/download?url=${encodeURIComponent(file.url)}`}
                                    download={filename}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="flex h-7.5 w-7.5 items-center justify-center rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white border border-zinc-800 transition"
                                    title="Download"
                                  >
                                    <svg
                                      className="h-4 w-4"
                                      fill="none"
                                      viewBox="0 0 24 24"
                                      stroke="currentColor"
                                      strokeWidth={2}
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                                      />
                                    </svg>
                                  </a>

                                  <button
                                    onClick={() =>
                                      handleDeleteFile(file.url, file.pathname)
                                    }
                                    disabled={isDeleting}
                                    className="flex h-7.5 w-7.5 items-center justify-center rounded-lg bg-zinc-900 hover:bg-red-950/60 border border-zinc-800 hover:border-red-500/20 text-zinc-500 hover:text-red-400 transition"
                                    title="Hapus"
                                  >
                                    {isDeleting ? (
                                      <svg
                                        className="h-3.5 w-3.5 animate-spin text-red-400"
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
                                    ) : (
                                      <svg
                                        className="h-4 w-4"
                                        fill="none"
                                        viewBox="0 0 24 24"
                                        stroke="currentColor"
                                        strokeWidth={2}
                                      >
                                        <path
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                        />
                                      </svg>
                                    )}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>

            {/* Right Column: Settings & Status details */}
            <div className="xl:col-span-1 flex flex-col gap-8">
              {/* Health Status Panel */}
              <section className="rounded-3xl border border-zinc-900 bg-zinc-900/30 backdrop-blur-xl p-6">
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500 mb-4">
                  Status & Waktu
                </h3>

                <div className="space-y-4 text-sm">
                  <div className="flex justify-between py-2.5 border-b border-zinc-900">
                    <span className="text-zinc-500">Status Terakhir</span>
                    <span
                      className={`font-bold flex items-center gap-1.5 ${
                        selectedDb.lastStatus === "SUCCESS"
                          ? "text-emerald-400"
                          : selectedDb.lastStatus === "FAILED"
                            ? "text-red-400"
                            : "text-zinc-400"
                      }`}
                    >
                      <span
                        className={`inline-block h-2 w-2 rounded-full ${
                          selectedDb.lastStatus === "SUCCESS"
                            ? "bg-emerald-500"
                            : selectedDb.lastStatus === "FAILED"
                              ? "bg-red-500"
                              : "bg-zinc-700"
                        }`}
                      />
                      {selectedDb.lastStatus === "SUCCESS"
                        ? "SUKSES"
                        : selectedDb.lastStatus === "FAILED"
                          ? "GAGAL"
                          : "BELUM JALAN"}
                    </span>
                  </div>

                  <div className="py-2.5 border-b border-zinc-900">
                    <span className="block text-zinc-500 text-xs mb-0.5">
                      Waktu Sukses Terakhir
                    </span>
                    <span className="font-semibold text-white">
                      {selectedDb.lastSuccessAt
                        ? new Date(selectedDb.lastSuccessAt).toLocaleString(
                            "id-ID",
                            {
                              dateStyle: "medium",
                              timeStyle: "short",
                            },
                          )
                        : "Tidak ada data"}
                    </span>
                  </div>

                  <div className="py-2.5">
                    <span className="block text-zinc-500 text-xs mb-0.5">
                      Estimasi Jadwal Otomatis
                    </span>
                    <span className="font-semibold text-white">
                      {getNextBackupTime()}
                    </span>
                  </div>

                  {selectedDb.lastStatus === "FAILED" &&
                    selectedDb.lastError && (
                      <div className="rounded-2xl border border-red-500/20 bg-red-950/20 p-3 text-xs text-red-400 leading-5">
                        <div className="font-bold mb-1">Pesan Error:</div>
                        <div className="font-mono bg-black/40 p-2.5 rounded-lg border border-zinc-900 break-all">
                          {selectedDb.lastError}
                        </div>
                      </div>
                    )}
                </div>
              </section>

              {/* Edit Configurations Panel */}
              <section className="rounded-3xl border border-zinc-900 bg-zinc-900/30 backdrop-blur-xl p-6">
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500 mb-5">
                  Edit Konfigurasi
                </h3>

                <form onSubmit={handleSaveChanges} className="space-y-4">
                  <div>
                    <label className="block text-xxs font-bold text-zinc-400 uppercase tracking-widest mb-1.5">
                      Nama Database
                    </label>
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-950 py-2.5 px-3.5 text-xs text-white outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xxs font-bold text-zinc-400 uppercase tracking-widest mb-1.5">
                      Connection String (Ganti Baru)
                    </label>
                    <input
                      type="password"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-950 py-2.5 px-3.5 text-xs text-white placeholder-zinc-700 outline-none focus:border-indigo-500 font-mono"
                      placeholder="••••••••••••••••••••••••••••"
                    />
                    <p className="mt-1 text-xxs text-zinc-500 leading-4">
                      Biarkan kosong jika tidak ingin mengubah URL koneksi.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xxs font-bold text-zinc-400 uppercase tracking-widest mb-1.5">
                        Interval
                      </label>
                      <select
                        value={interval}
                        onChange={(e) => setIntervalVal(e.target.value as any)}
                        className="w-full rounded-xl border border-zinc-800 bg-zinc-950 py-2.5 px-3.5 text-xs text-white outline-none focus:border-indigo-500"
                      >
                        <option value="3_DAYS">3 Hari</option>
                        <option value="1_WEEK">1 Minggu</option>
                        <option value="1_MONTH">1 Bulan</option>
                        <option value="1_YEAR">1 Tahun</option>
                        <option value="CUSTOM">Kustom</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xxs font-bold text-zinc-400 uppercase tracking-widest mb-1.5">
                        Max File
                      </label>
                      <input
                        type="number"
                        min="1"
                        required
                        value={maxFiles}
                        onChange={(e) => setMaxFiles(Number(e.target.value))}
                        className="w-full rounded-xl border border-zinc-800 bg-zinc-950 py-2.5 px-3.5 text-xs text-white outline-none focus:border-indigo-500"
                      />
                    </div>
                  </div>

                  {interval === "CUSTOM" && (
                    <div className="animate-in slide-in-from-top-2 duration-200">
                      <label className="block text-xxs font-bold text-zinc-400 uppercase tracking-widest mb-1.5">
                        Jumlah Hari Kustom
                      </label>
                      <input
                        type="number"
                        min="1"
                        required
                        value={customDays}
                        onChange={(e) => setCustomDays(Number(e.target.value))}
                        className="w-full rounded-xl border border-zinc-800 bg-zinc-950 py-2.5 px-3.5 text-xs text-white outline-none focus:border-indigo-500"
                      />
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={isSettingsPending}
                    className="w-full flex items-center justify-center rounded-xl bg-indigo-600 hover:bg-indigo-500 py-3 text-xs font-bold text-white transition active:scale-[0.98] disabled:opacity-50 mt-4"
                  >
                    {isSettingsPending ? "Menyimpan..." : "Simpan Perubahan"}
                  </button>
                </form>

                {/* Delete target DB button */}
                <button
                  onClick={handleDeleteDatabase}
                  disabled={isSettingsPending}
                  className="w-full flex items-center justify-center gap-2 rounded-xl border border-red-500/20 bg-red-950/20 hover:bg-red-950/40 hover:border-red-500/40 py-3 text-xs font-bold text-red-400 transition mt-3"
                >
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                  Hapus Database Target
                </button>
              </section>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
