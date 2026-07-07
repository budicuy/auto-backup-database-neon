"use server";

import { del, list } from "@vercel/blob";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "../db/index";
import * as schema from "../db/schema";
import { runBackupJob } from "../lib/backup";
import { encrypt } from "../lib/crypto";

/**
 * Server Action: Registers a new backup target database, encrypting its connection string.
 */
export async function registerDatabase(data: {
  name: string;
  url: string;
  interval: "3_DAYS" | "1_WEEK" | "1_MONTH" | "1_YEAR" | "CUSTOM";
  customDays?: number | null;
  maxFiles: number;
}) {
  try {
    if (!data.name || !data.url) {
      throw new Error("Nama dan connection string database wajib diisi");
    }

    const encryptedUrl = encrypt(data.url);

    const result = await db
      .insert(schema.databases)
      .values({
        name: data.name,
        encryptedUrl,
        interval: data.interval,
        customDays: data.interval === "CUSTOM" ? data.customDays : null,
        maxFiles: data.maxFiles,
      })
      .returning();

    revalidatePath("/");
    return { success: true, database: result[0] };
  } catch (error: any) {
    console.error("Failed to register database target:", error);
    return { success: false, error: error.message || String(error) };
  }
}

/**
 * Server Action: Updates config parameters (and optionally connection string) of a target database.
 */
export async function updateDatabaseSettings(
  id: number,
  data: {
    name: string;
    url?: string; // Optional: Only updated if user changes it
    interval: "3_DAYS" | "1_WEEK" | "1_MONTH" | "1_YEAR" | "CUSTOM";
    customDays?: number | null;
    maxFiles: number;
  },
) {
  try {
    const updateFields: any = {
      name: data.name,
      interval: data.interval,
      customDays: data.interval === "CUSTOM" ? data.customDays : null,
      maxFiles: data.maxFiles,
      updatedAt: new Date(),
    };

    if (data.url && data.url.trim() !== "" && !data.url.startsWith("••••")) {
      updateFields.encryptedUrl = encrypt(data.url);
    }

    await db
      .update(schema.databases)
      .set(updateFields)
      .where(eq(schema.databases.id, id));

    revalidatePath("/");
    return { success: true };
  } catch (error: any) {
    console.error("Failed to update database target settings:", error);
    return { success: false, error: error.message || String(error) };
  }
}

/**
 * Server Action: Deletes a database target configuration and clears all its backup files on Vercel Blob.
 */
export async function deleteDatabase(id: number) {
  try {
    // 1. Fetch record first
    const records = await db
      .select()
      .from(schema.databases)
      .where(eq(schema.databases.id, id))
      .limit(1);
    if (records.length === 0) {
      throw new Error("Database target not found");
    }

    // 2. Clear backup files on Vercel Blob
    const folderPrefix = `db-backups/db-${id}/`;
    try {
      const listResult = await list({ prefix: folderPrefix });
      const blobs = listResult.blobs.filter((b) =>
        b.pathname.startsWith(folderPrefix),
      );

      console.log(
        `Deleting ${blobs.length} backups in Blob for deleted DB ID ${id}...`,
      );
      for (const blob of blobs) {
        await del(blob.url);
      }
    } catch (blobErr) {
      console.error(
        `Warning: Failed to cleanup Blob backups for DB ID ${id}:`,
        blobErr,
      );
    }

    // 3. Delete database record
    await db.delete(schema.databases).where(eq(schema.databases.id, id));

    revalidatePath("/");
    return { success: true };
  } catch (error: any) {
    console.error("Failed to delete database target:", error);
    return { success: false, error: error.message || String(error) };
  }
}

/**
 * Server Action: Triggers a manual database backup (ignoring schedule interval limits).
 */
export async function triggerManualBackup(id: number) {
  try {
    const result = await runBackupJob(id, true);
    revalidatePath("/");
    return {
      success: true,
      url: result.url,
      path: result.path,
      sizeBytes: result.sizeBytes,
    };
  } catch (error: any) {
    console.error(`Manual backup Server Action failed for ID ${id}:`, error);
    return { success: false, error: error.message || String(error) };
  }
}

/**
 * Server Action: Fetches all backup files uploaded to Vercel Blob under db-backups/db-{id}/.
 */
export async function listBackupsForDatabase(id: number) {
  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      throw new Error(
        "BLOB_READ_WRITE_TOKEN environment variable is not defined",
      );
    }
    const folderPrefix = `db-backups/db-${id}/`;
    const result = await list({ prefix: folderPrefix });
    // Sort from newest to oldest
    return {
      success: true,
      backups: result.blobs
        .filter((b) => b.pathname.startsWith(folderPrefix))
        .sort(
          (a, b) =>
            new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime(),
        ),
    };
  } catch (error: any) {
    console.error(`Listing backups failed for DB ID ${id}:`, error);
    return {
      success: false,
      error: error.message || String(error),
      backups: [],
    };
  }
}

/**
 * Server Action: Deletes a specific backup file from Vercel Blob.
 */
export async function deleteBackupFile(url: string) {
  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      throw new Error(
        "BLOB_READ_WRITE_TOKEN environment variable is not defined",
      );
    }
    await del(url);
    revalidatePath("/");
    return { success: true };
  } catch (error: any) {
    console.error("Deleting backup file Server Action failed:", error);
    return { success: false, error: error.message || String(error) };
  }
}

/**
 * Server Action: Validates dashboard password and sets session cookie.
 */
export async function login(password: string) {
  const correctPassword = process.env.DASHBOARD_PASSWORD;

  if (!correctPassword) {
    return {
      success: false,
      error:
        "Dashboard password is not set on the server. Please set DASHBOARD_PASSWORD env var.",
    };
  }

  if (password === correctPassword) {
    const { cookies } = await import("next/headers");
    const cookieStore = await cookies();
    cookieStore.set("backup_session", "true", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 60 * 60 * 24 * 7, // 1 week session
      path: "/",
    });
    return { success: true };
  }

  return { success: false, error: "Invalid password" };
}

/**
 * Server Action: Logs out the user by deleting the session cookie.
 */
export async function logout() {
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();
  cookieStore.delete("backup_session");
  revalidatePath("/");
  return { success: true };
}
