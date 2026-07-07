import { runBackupJob, getOrInitializeSettings } from '../lib/backup';
import { db } from '../db/index';
import * as schema from '../db/schema';
import { list } from '@vercel/blob';
import { eq } from 'drizzle-orm';

async function verifySchedulingLogic() {
  console.log("\n=== Testing Scheduling Logic ===");
  
  const settings = await getOrInitializeSettings();
  
  // Set interval to '1_WEEK' (7 days)
  console.log("Setting backup interval to 1 Week...");
  await db.update(schema.backupSettings)
    .set({ interval: '1_WEEK', customDays: null })
    .where(eq(schema.backupSettings.id, settings.id));

  // Case 1: Set last success to 8 days ago (Should trigger backup)
  console.log("Case 1: Simulating last success was 8 days ago...");
  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  await db.update(schema.backupSettings)
    .set({ lastSuccessAt: eightDaysAgo, lastStatus: 'SUCCESS' })
    .where(eq(schema.backupSettings.id, settings.id));
    
  let result = await runBackupJob(false);
  console.log(`Result: success=${result.success}, skipped=${result.skipped}`);
  if (result.skipped) {
    throw new Error("FAIL: Backup should NOT have been skipped (elapsed 8 days > 7 days interval)");
  }
  console.log("PASS: Backup triggered correctly when due.");

  // Case 2: Set last success to 1 day ago (Should skip backup)
  console.log("Case 2: Simulating last success was 1 day ago...");
  const oneDayAgo = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
  await db.update(schema.backupSettings)
    .set({ lastSuccessAt: oneDayAgo, lastStatus: 'SUCCESS' })
    .where(eq(schema.backupSettings.id, settings.id));
    
  result = await runBackupJob(false);
  console.log(`Result: success=${result.success}, skipped=${result.skipped}`);
  if (!result.skipped) {
    throw new Error("FAIL: Backup should have been skipped (elapsed 1 day < 7 days interval)");
  }
  console.log("PASS: Backup skipped correctly when not due.");
}

async function verifyRetentionPruningLogic() {
  console.log("\n=== Testing Retention & Pruning Logic ===");
  
  const settings = await getOrInitializeSettings();
  
  // Set max files to 2 for quick testing
  console.log("Setting max files to 2 in DB...");
  await db.update(schema.backupSettings)
    .set({ maxFiles: 2 })
    .where(eq(schema.backupSettings.id, settings.id));

  console.log("Running backup 1...");
  await runBackupJob(true); // manual override
  
  console.log("Running backup 2...");
  await runBackupJob(true);
  
  console.log("Running backup 3 (should trigger pruning)...");
  await runBackupJob(true);

  // List files in Vercel Blob
  console.log("Checking file count in Vercel Blob...");
  const listRes = await list({ prefix: 'db-backups/' });
  const backupFiles = listRes.blobs.filter(b => b.pathname.startsWith('db-backups/'));
  
  console.log(`Found ${backupFiles.length} backup files.`);
  if (backupFiles.length > 2) {
    throw new Error(`FAIL: Pruning failed. Expected at most 2 files, found ${backupFiles.length}`);
  }
  console.log("PASS: Old backup files pruned successfully. Current list:");
  backupFiles.forEach(f => console.log(` - ${f.pathname} (${f.uploadedAt})`));
}

async function runAllTests() {
  // Ensure DATABASE_URL and BLOB_READ_WRITE_TOKEN are present
  if (!process.env.DATABASE_URL) {
    console.error("ERROR: DATABASE_URL must be defined to run tests.");
    process.exit(1);
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error("ERROR: BLOB_READ_WRITE_TOKEN must be defined to run Vercel Blob upload tests.");
    process.exit(1);
  }

  try {
    // 1. Run scheduling test
    await verifySchedulingLogic();
    
    // 2. Run retention test
    await verifyRetentionPruningLogic();
    
    console.log("\n✅ ALL END-TO-END TESTS PASSED SUCCESSFULLY!");
  } catch (error: any) {
    console.error("\n❌ TEST FAILED:", error.message || error);
    process.exit(1);
  }
}

runAllTests();
