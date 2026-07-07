import { getBackupSettings, listBackups } from './actions';
import DashboardClient from './DashboardClient';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  // Fetch settings and backup list concurrently on the server
  const [settingsResult, backupsResult] = await Promise.all([
    getBackupSettings(),
    listBackups(),
  ]);

  const settings = settingsResult.success ? settingsResult.settings : null;
  const backups = backupsResult.success && backupsResult.backups ? backupsResult.backups : [];

  // Convert Date objects to JSON-serializable strings for client boundary
  const serializableSettings = settings
    ? {
        ...settings,
        lastSuccessAt: settings.lastSuccessAt
          ? new Date(settings.lastSuccessAt).toISOString()
          : null,
        updatedAt: new Date(settings.updatedAt).toISOString(),
      }
    : null;

  const serializableBackups = backups.map(b => ({
    url: b.url,
    pathname: b.pathname,
    size: b.size,
    uploadedAt: new Date(b.uploadedAt).toISOString()
  }));

  return (
    <DashboardClient
      initialSettings={serializableSettings as any}
      initialBackups={serializableBackups}
    />
  );
}
