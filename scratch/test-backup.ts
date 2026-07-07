import { del, list } from "@vercel/blob";
import { eq } from "drizzle-orm";
import { db } from "../db/index";
import * as schema from "../db/schema";
import { runBackupJob } from "../lib/backup";
import { decrypt, encrypt } from "../lib/crypto";

async function verifyEncryption() {
  console.log("=== Testing Connection String Encryption ===");
  const testUrl =
    "postgres://username:secr3t_pass@host.neon.tech:5432/my_db?sslmode=require";
  const encrypted = encrypt(testUrl);
  const decrypted = decrypt(encrypted);

  console.log("Original URL:", testUrl);
  console.log("Encrypted string:", encrypted);
  console.log("Decrypted string:", decrypted);

  if (testUrl !== decrypted) {
    throw new Error(
      "FAIL: Decrypted connection string does not match original URL",
    );
  }
  console.log("PASS: Encryption/Decryption verified successfully.");
}

async function verifySchedulingLogic(dbId: number) {
  console.log("\n=== Testing Scheduling Logic ===");

  // Set interval to '1_WEEK' (7 days)
  console.log("Setting interval to 1 Week...");
  await db
    .update(schema.databases)
    .set({ interval: "1_WEEK", customDays: null })
    .where(eq(schema.databases.id, dbId));

  // Case 1: last success 8 days ago (Should trigger backup)
  console.log("Case 1: Simulating last success was 8 days ago...");
  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  await db
    .update(schema.databases)
    .set({ lastSuccessAt: eightDaysAgo, lastStatus: "SUCCESS" })
    .where(eq(schema.databases.id, dbId));

  let result = await runBackupJob(dbId, false);
  console.log(`Result: success=${result.success}, skipped=${result.skipped}`);
  if (result.skipped) {
    throw new Error(
      "FAIL: Backup should NOT have been skipped (elapsed 8 days > 7 days interval)",
    );
  }
  console.log("PASS: Backup triggered correctly when due.");

  // Case 2: last success 1 day ago (Should skip backup)
  console.log("Case 2: Simulating last success was 1 day ago...");
  const oneDayAgo = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
  await db
    .update(schema.databases)
    .set({ lastSuccessAt: oneDayAgo, lastStatus: "SUCCESS" })
    .where(eq(schema.databases.id, dbId));

  result = await runBackupJob(dbId, false);
  console.log(`Result: success=${result.success}, skipped=${result.skipped}`);
  if (!result.skipped) {
    throw new Error(
      "FAIL: Backup should have been skipped (elapsed 1 day < 7 days interval)",
    );
  }
  console.log("PASS: Backup skipped correctly when not due.");
}

async function verifyRetentionPruningLogic(dbId: number) {
  console.log("\n=== Testing Retention & Pruning Logic ===");

  // Set max files to 2 for quick testing
  console.log("Setting max files to 2 in DB config...");
  await db
    .update(schema.databases)
    .set({ maxFiles: 2 })
    .where(eq(schema.databases.id, dbId));

  console.log("Running manual backup 1...");
  await runBackupJob(dbId, true);

  console.log("Running manual backup 2...");
  await runBackupJob(dbId, true);

  console.log("Running manual backup 3 (should trigger pruning)...");
  await runBackupJob(dbId, true);

  // Check file count under db-specific prefix
  const folderPrefix = `db-backups/db-${dbId}/`;
  console.log(
    `Checking file count in Vercel Blob with prefix: ${folderPrefix}...`,
  );
  const listRes = await list({ prefix: folderPrefix });
  const backupFiles = listRes.blobs.filter((b) =>
    b.pathname.startsWith(folderPrefix),
  );

  console.log(`Found ${backupFiles.length} backup files.`);
  if (backupFiles.length > 2) {
    throw new Error(
      `FAIL: Pruning failed. Expected at most 2 files, found ${backupFiles.length}`,
    );
  }
  console.log("PASS: Old backup files pruned successfully. Current list:");
  for (const f of backupFiles) {
    console.log(` - ${f.pathname} (${f.uploadedAt})`);
  }
}

async function runAllTests() {
  if (!process.env.DATABASE_URL) {
    console.error("ERROR: DATABASE_URL must be defined to run tests.");
    process.exit(1);
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error(
      "ERROR: BLOB_READ_WRITE_TOKEN must be defined to run Vercel Blob upload tests.",
    );
    process.exit(1);
  }

  try {
    // 1. Verify cryptography helper
    await verifyEncryption();

    // Register the config database itself as a target for backing up
    console.log("\n=== Registering central DB itself as backup target ===");
    const encryptedUrl = encrypt(process.env.DATABASE_URL);
    const dbTarget = await db
      .insert(schema.databases)
      .values({
        name: "Test Introspected DB",
        encryptedUrl,
        interval: "1_WEEK",
        maxFiles: 10,
      })
      .returning();

    const dbId = dbTarget[0].id;
    console.log(`Registered successfully. Database Target ID: ${dbId}`);

    try {
      // 2. Test scheduling logic on this target
      await verifySchedulingLogic(dbId);

      // 3. Test file retention pruning
      await verifyRetentionPruningLogic(dbId);

      console.log("\n✅ ALL MULTI-DATABASE BACKUP TESTS PASSED SUCCESSFULLY!");
    } finally {
      // Cleanup: Delete test database target record and all files
      console.log("\n=== Cleaning up test target and files... ===");
      const folderPrefix = `db-backups/db-${dbId}/`;
      const listRes = await list({ prefix: folderPrefix });
      for (const blob of listRes.blobs) {
        if (blob.pathname.startsWith(folderPrefix)) {
          await del(blob.url);
        }
      }
      await db.delete(schema.databases).where(eq(schema.databases.id, dbId));
      console.log("Cleanup completed.");
    }
  } catch (error: any) {
    console.error("\n❌ TEST FAILED:", error.message || error);
    process.exit(1);
  }
}

runAllTests();
