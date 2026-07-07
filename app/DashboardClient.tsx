'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  triggerManualBackup,
  deleteBackup,
  updateBackupSettings,
  logout
} from './actions';

interface BackupFile {
  url: string;
  pathname: string;
  size: number;
  uploadedAt: string;
}

interface BackupSettings {
  id: number;
  interval: '3_DAYS' | '1_WEEK' | '1_MONTH' | '1_YEAR' | 'CUSTOM';
  customDays: number | null;
  maxFiles: number;
  lastSuccessAt: string | Date | null;
  lastStatus: 'SUCCESS' | 'FAILED' | null;
  lastError: string | null;
  updatedAt: string | Date;
}

interface DashboardClientProps {
  initialSettings: BackupSettings | null;
  initialBackups: BackupFile[];
}

function formatBytes(bytes: number, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export default function DashboardClient({
  initialSettings,
  initialBackups
}: DashboardClientProps) {
  const router = useRouter();
  const [settings, setSettings] = useState<BackupSettings | null>(initialSettings);
  const [backups, setBackups] = useState<BackupFile[]>(initialBackups);
  
  // Settings Form State
  const [interval, setIntervalVal] = useState(settings?.interval || '1_WEEK');
  const [customDays, setCustomDays] = useState(settings?.customDays || 3);
  const [maxFiles, setMaxFiles] = useState(settings?.maxFiles || 10);
  
  // Actions Transitions
  const [isBackupPending, startBackupTransition] = useTransition();
  const [isSettingsPending, startSettingsTransition] = useTransition();
  const [deletingUrls, setDeletingUrls] = useState<Record<string, boolean>>({});
  const [isLoggingOut, startLogoutTransition] = useTransition();

  // Notification Toast State
  const [notification, setNotification] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const showNotification = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => {
      setNotification(null);
    }, 5000);
  };

  // 1. Handle Save Settings
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    startSettingsTransition(async () => {
      const res = await updateBackupSettings({
        interval,
        customDays: interval === 'CUSTOM' ? Number(customDays) : null,
        maxFiles: Number(maxFiles)
      });

      if (res.success) {
        showNotification('success', 'Pengaturan backup berhasil diperbarui!');
        // Refresh router and state
        router.refresh();
      } else {
        showNotification('error', `Gagal menyimpan pengaturan: ${res.error}`);
      }
    });
  };

  // 2. Handle Trigger Backup
  const handleTriggerBackup = () => {
    startBackupTransition(async () => {
      const res = await triggerManualBackup();
      if (res.success) {
        showNotification(
          'success',
          `Backup manual sukses! File diupload: ${res.path} (${formatBytes(res.sizeBytes || 0)})`
        );
        // Refresh local backups list and router data
        router.refresh();
        // Slightly delay update to allow list backups reload
        setTimeout(async () => {
          const { listBackups } = await import('./actions');
          const listRes = await listBackups();
          if (listRes.success && listRes.backups) {
            setBackups(listRes.backups);
          }
          const { getBackupSettings } = await import('./actions');
          const settingsRes = await getBackupSettings();
          if (settingsRes.success && settingsRes.settings) {
            setSettings(settingsRes.settings);
          }
        }, 1000);
      } else {
        showNotification('error', `Backup gagal: ${res.error}`);
      }
    });
  };

  // 3. Handle Delete Backup
  const handleDeleteBackup = async (url: string, filename: string) => {
    if (!confirm(`Apakah Anda yakin ingin menghapus backup "${filename}"?`)) {
      return;
    }

    setDeletingUrls(prev => ({ ...prev, [url]: true }));

    const res = await deleteBackup(url);
    if (res.success) {
      showNotification('success', 'File backup berhasil dihapus.');
      setBackups(prev => prev.filter(b => b.url !== url));
      router.refresh();
    } else {
      showNotification('error', `Gagal menghapus file: ${res.error}`);
    }

    setDeletingUrls(prev => ({ ...prev, [url]: false }));
  };

  // 4. Handle Logout
  const handleLogout = () => {
    startLogoutTransition(async () => {
      await logout();
      router.push('/login');
      router.refresh();
    });
  };

  // Calculate Next Backup Time
  const getNextBackupTime = () => {
    if (!settings || !settings.lastSuccessAt) return 'Segera pada jadwal cron berikutnya';
    const lastRun = new Date(settings.lastSuccessAt).getTime();
    let intervalMs = 0;
    if (settings.interval === 'CUSTOM') {
      const days = settings.customDays || 1;
      intervalMs = days * 24 * 60 * 60 * 1000;
    } else {
      const map = {
        '3_DAYS': 3 * 24 * 60 * 60 * 1000,
        '1_WEEK': 7 * 24 * 60 * 60 * 1000,
        '1_MONTH': 30 * 24 * 60 * 60 * 1000,
        '1_YEAR': 365 * 24 * 60 * 60 * 1000,
      };
      intervalMs = map[settings.interval] || map['1_WEEK'];
    }
    return new Date(lastRun + intervalMs).toLocaleString('id-ID', {
      dateStyle: 'medium',
      timeStyle: 'short'
    });
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-indigo-500 selection:text-white pb-16">
      {/* Background radial glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[30%] -left-[10%] w-[60%] h-[60%] rounded-full bg-gradient-to-tr from-indigo-900/10 to-indigo-500/5 blur-[140px]" />
        <div className="absolute top-[20%] right-[-10%] w-[60%] h-[60%] rounded-full bg-gradient-to-br from-violet-900/10 to-purple-500/5 blur-[140px]" />
      </div>

      {/* Toast Notification */}
      {notification && (
        <div className="fixed top-6 right-6 z-50 animate-in fade-in slide-in-from-top-4 duration-300">
          <div
            className={`flex items-center gap-3 rounded-2xl border px-5 py-4 shadow-2xl backdrop-blur-md ${
              notification.type === 'success'
                ? 'border-emerald-500/20 bg-emerald-950/70 text-emerald-300'
                : 'border-red-500/20 bg-red-950/70 text-red-300'
            }`}
          >
            {notification.type === 'success' ? (
              <svg className="h-6 w-6 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ) : (
              <svg className="h-6 w-6 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
            <span className="text-sm font-medium">{notification.message}</span>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="relative border-b border-zinc-900 bg-zinc-950/80 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-600 text-white shadow-lg shadow-indigo-500/20">
              <svg className="h-5.5 w-5.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-white">Neon DB Backup</h1>
              <p className="text-xs text-zinc-400">Automated SQL database dumps over TCP</p>
            </div>
          </div>

          <button
            onClick={handleLogout}
            disabled={isLoggingOut}
            className="flex items-center gap-2 rounded-xl border border-zinc-800 hover:bg-zinc-900 px-4 py-2 text-xs font-semibold tracking-wide text-zinc-400 hover:text-white transition duration-200"
          >
            {isLoggingOut ? 'Logging out...' : 'Keluar'}
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 mt-8 grid grid-cols-1 lg:grid-cols-3 gap-8 relative z-10">
        
        {/* Left Column: Settings and Health status */}
        <div className="lg:col-span-1 flex flex-col gap-8">
          
          {/* Status Indicator Panel */}
          <section className="rounded-3xl border border-zinc-900 bg-zinc-900/30 backdrop-blur-xl p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400 mb-5">Status Backup</h2>
            
            <div className="space-y-6">
              {/* Last Backup Health */}
              <div className="flex items-center justify-between pb-4 border-b border-zinc-900">
                <span className="text-sm text-zinc-400">Backup Terakhir</span>
                <div className="flex items-center gap-2">
                  <span className={`inline-block h-2.5 w-2.5 rounded-full ${
                    settings?.lastStatus === 'SUCCESS' ? 'bg-emerald-500 shadow-md shadow-emerald-500/50 animate-pulse' :
                    settings?.lastStatus === 'FAILED' ? 'bg-red-500 shadow-md shadow-red-500/50 animate-pulse' : 'bg-zinc-600'
                  }`} />
                  <span className="text-sm font-bold">
                    {settings?.lastStatus === 'SUCCESS' ? 'Sukses' :
                     settings?.lastStatus === 'FAILED' ? 'Gagal' : 'Belum Berjalan'}
                  </span>
                </div>
              </div>

              {/* Timestamp of last success */}
              <div>
                <span className="block text-xs text-zinc-500 mb-1">Terakhir Sukses</span>
                <span className="text-sm font-semibold text-white">
                  {settings?.lastSuccessAt
                    ? new Date(settings.lastSuccessAt).toLocaleString('id-ID', {
                        dateStyle: 'medium',
                        timeStyle: 'short'
                      })
                    : 'Tidak ada data'}
                </span>
              </div>

              {/* Next automatic backup */}
              <div>
                <span className="block text-xs text-zinc-500 mb-1">Estimasi Jadwal Berikutnya</span>
                <span className="text-sm font-semibold text-white">{getNextBackupTime()}</span>
              </div>

              {/* Error messages if failure */}
              {settings?.lastStatus === 'FAILED' && settings.lastError && (
                <div className="rounded-2xl border border-red-500/20 bg-red-950/30 p-3.5 text-xs text-red-400">
                  <div className="font-bold mb-1">Error message:</div>
                  <div className="font-mono break-words leading-5 bg-black/40 p-2.5 rounded-lg border border-zinc-900">{settings.lastError}</div>
                </div>
              )}

              {/* Manual Backup trigger button */}
              <button
                onClick={handleTriggerBackup}
                disabled={isBackupPending}
                className="w-full flex items-center justify-center gap-2.5 rounded-2xl bg-indigo-600/10 hover:bg-indigo-600 border border-indigo-500/30 text-indigo-400 hover:text-white py-3.5 px-4 text-sm font-bold tracking-wide outline-none transition duration-200 focus:ring-2 focus:ring-indigo-500/50 active:scale-[0.98] disabled:scale-100 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-indigo-900/5"
              >
                {isBackupPending ? (
                  <>
                    <svg className="h-5 w-5 animate-spin text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <span>Memproses Backup...</span>
                  </>
                ) : (
                  <>
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 8H17" />
                    </svg>
                    <span>Backup Sekarang</span>
                  </>
                )}
              </button>
            </div>
          </section>

          {/* Schedule Settings Panel */}
          <section className="rounded-3xl border border-zinc-900 bg-zinc-900/30 backdrop-blur-xl p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400 mb-5">Pengaturan Jadwal</h2>

            <form onSubmit={handleSaveSettings} className="space-y-5">
              {/* Interval Selection */}
              <div>
                <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2.5">
                  Interval Backup
                </label>
                <select
                  value={interval}
                  onChange={(e) => setIntervalVal(e.target.value as any)}
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 py-3 px-4 text-sm text-white outline-none transition duration-200 focus:border-indigo-500/80"
                >
                  <option value="3_DAYS">Setiap 3 Hari</option>
                  <option value="1_WEEK">Setiap 1 Minggu</option>
                  <option value="1_MONTH">Setiap 1 Bulan</option>
                  <option value="1_YEAR">Setiap 1 Tahun</option>
                  <option value="CUSTOM">Kustom (Hari)</option>
                </select>
              </div>

              {/* Custom days input (shown only if CUSTOM) */}
              {interval === 'CUSTOM' && (
                <div className="animate-in slide-in-from-top-2 duration-200">
                  <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                    Jumlah Hari Kustom
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={customDays}
                    onChange={(e) => setCustomDays(Number(e.target.value))}
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-950 py-3 px-4 text-sm text-white outline-none transition duration-200 focus:border-indigo-500/80"
                    placeholder="Contoh: 5"
                    required
                  />
                </div>
              )}

              {/* Max Files (Retention Policy) */}
              <div>
                <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                  Maksimal Jumlah File Backup
                </label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={maxFiles}
                  onChange={(e) => setMaxFiles(Number(e.target.value))}
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 py-3 px-4 text-sm text-white outline-none transition duration-200 focus:border-indigo-500/80"
                  placeholder="Contoh: 10"
                  required
                />
                <p className="mt-1.5 text-xs text-zinc-500">
                  File paling lama akan dihapus otomatis jika melebihi batas ini.
                </p>
              </div>

              {/* Submit button */}
              <button
                type="submit"
                disabled={isSettingsPending}
                className="w-full flex items-center justify-center rounded-xl bg-indigo-600 py-3 px-4 text-sm font-bold text-white shadow-lg shadow-indigo-900/30 outline-none transition duration-200 hover:bg-indigo-500 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSettingsPending ? 'Menyimpan...' : 'Simpan Pengaturan'}
              </button>
            </form>
          </section>

        </div>

        {/* Right Column: List of backups */}
        <div className="lg:col-span-2">
          
          <section className="rounded-3xl border border-zinc-900 bg-zinc-900/30 backdrop-blur-xl p-6 min-h-[400px] flex flex-col">
            <div className="flex items-center justify-between mb-6 pb-4 border-b border-zinc-900">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">File Backup di Vercel Blob</h2>
                <p className="text-xs text-zinc-500 mt-1">Menampilkan file kompresi (.sql.gz)</p>
              </div>
              <span className="rounded-lg bg-zinc-900 px-3 py-1 text-xs font-semibold text-indigo-400 border border-zinc-800">
                {backups.length} file
              </span>
            </div>

            {backups.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center py-20 text-center">
                <div className="h-16 w-16 text-zinc-700 mb-4 bg-zinc-900/50 rounded-2xl flex items-center justify-center border border-zinc-800">
                  <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                </div>
                <h3 className="text-base font-bold text-zinc-300">Belum ada file backup</h3>
                <p className="text-sm text-zinc-500 mt-1 max-w-xs">
                  Mulai dengan mengeklik tombol &ldquo;Backup Sekarang&rdquo; untuk membuat backup database pertama Anda.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-zinc-900 text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                      <th className="pb-3 font-semibold">Nama File</th>
                      <th className="pb-3 font-semibold">Ukuran</th>
                      <th className="pb-3 font-semibold">Tanggal Dibuat</th>
                      <th className="pb-3 text-right font-semibold">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-900">
                    {backups.map((file) => {
                      const filename = file.pathname.replace('db-backups/', '');
                      const isDeleting = deletingUrls[file.url];

                      return (
                        <tr key={file.url} className="group hover:bg-zinc-900/10 transition">
                          <td className="py-4 pr-3 font-mono text-xs text-white max-w-[240px] truncate">
                            <span className="flex items-center gap-2">
                              <svg className="h-4.5 w-4.5 text-zinc-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                              </svg>
                              <span title={filename}>{filename}</span>
                            </span>
                          </td>
                          <td className="py-4 px-3 text-zinc-400 font-medium">
                            {formatBytes(file.size)}
                          </td>
                          <td className="py-4 px-3 text-zinc-400">
                            {new Date(file.uploadedAt).toLocaleString('id-ID', {
                              dateStyle: 'medium',
                              timeStyle: 'short'
                            })}
                          </td>
                          <td className="py-4 pl-3 text-right">
                            <div className="flex items-center justify-end gap-2.5">
                              {/* Download link */}
                              <a
                                href={file.url}
                                download={filename}
                                target="_blank"
                                rel="noreferrer"
                                className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white border border-zinc-800 transition"
                                title="Download Backup"
                              >
                                <svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                </svg>
                              </a>

                              {/* Delete button */}
                              <button
                                onClick={() => handleDeleteBackup(file.url, filename)}
                                disabled={isDeleting}
                                className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-900 hover:bg-red-950/60 border border-zinc-800 hover:border-red-500/20 text-zinc-500 hover:text-red-400 transition disabled:opacity-50"
                                title="Hapus Backup"
                              >
                                {isDeleting ? (
                                  <svg className="h-4 w-4 animate-spin text-red-400" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                  </svg>
                                ) : (
                                  <svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
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

      </main>
    </div>
  );
}
