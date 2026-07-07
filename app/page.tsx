import { db } from "../db/index";
import * as schema from "../db/schema";
import { listBackupsForDatabase } from "./actions";
import DashboardClient from "./DashboardClient";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  // 1. Fetch all registered databases from central DB
  const dbTargets = await db
    .select()
    .from(schema.databases)
    .orderBy(schema.databases.createdAt);

  let initialBackups: any[] = [];

  // 2. Prefetch backups for the first target database, if available
  if (dbTargets.length > 0) {
    const backupsRes = await listBackupsForDatabase(dbTargets[0].id);
    if (backupsRes.success && backupsRes.backups) {
      initialBackups = backupsRes.backups;
    }
  }

  // 3. Serialize objects to pass JSON border safely
  const serializableDatabases = dbTargets.map((d) => ({
    ...d,
    lastSuccessAt: d.lastSuccessAt
      ? new Date(d.lastSuccessAt).toISOString()
      : null,
    createdAt: new Date(d.createdAt).toISOString(),
    updatedAt: new Date(d.updatedAt).toISOString(),
  }));

  const serializableBackups = initialBackups.map((b) => ({
    url: b.url,
    pathname: b.pathname,
    size: b.size,
    uploadedAt: new Date(b.uploadedAt).toISOString(),
  }));

  return (
    <DashboardClient
      initialDatabases={serializableDatabases as any}
      initialBackups={serializableBackups}
    />
  );
}
