'use server';

import { runBackupJob, getOrInitializeSettings } from '../lib/backup';
import { db } from '../db/index';
import * as schema from '../db/schema';
import { list, del } from '@vercel/blob';
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';

/**
 * Server Action: Triggers a manual database backup (ignoring schedule interval limits).
 */
export async function triggerManualBackup() {
  try {
    const result = await runBackupJob(true);
    revalidatePath('/');
    return { success: true, url: result.url, path: result.path, sizeBytes: result.sizeBytes };
  } catch (error: any) {
    console.error("Manual backup Server Action failed:", error);
    return { success: false, error: error.message || String(error) };
  }
}

/**
 * Server Action: Fetches all backup files uploaded to Vercel Blob under db-backups/.
 */
export async function listBackups() {
  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      throw new Error("BLOB_READ_WRITE_TOKEN environment variable is not defined");
    }
    const result = await list({ prefix: 'db-backups/' });
    // Sort from newest to oldest
    return {
      success: true,
      backups: result.blobs
        .filter(b => b.pathname.startsWith('db-backups/'))
        .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())
    };
  } catch (error: any) {
    console.error("Listing backups Server Action failed:", error);
    return { success: false, error: error.message || String(error), backups: [] };
  }
}

/**
 * Server Action: Deletes a specific backup file from Vercel Blob.
 */
export async function deleteBackup(url: string) {
  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      throw new Error("BLOB_READ_WRITE_TOKEN environment variable is not defined");
    }
    await del(url);
    revalidatePath('/');
    return { success: true };
  } catch (error: any) {
    console.error("Deleting backup Server Action failed:", error);
    return { success: false, error: error.message || String(error) };
  }
}

/**
 * Server Action: Retrieves the current backup configuration and execution status.
 */
export async function getBackupSettings() {
  try {
    const settings = await getOrInitializeSettings();
    return { success: true, settings };
  } catch (error: any) {
    console.error("Fetching settings Server Action failed:", error);
    return { success: false, error: error.message || String(error), settings: null };
  }
}

/**
 * Server Action: Updates the backup schedule interval and retention constraints in the database.
 */
export async function updateBackupSettings(data: {
  interval: '3_DAYS' | '1_WEEK' | '1_MONTH' | '1_YEAR' | 'CUSTOM';
  customDays?: number | null;
  maxFiles: number;
}) {
  try {
    const settings = await getOrInitializeSettings();
    
    await db.update(schema.backupSettings)
      .set({
        interval: data.interval,
        customDays: data.interval === 'CUSTOM' ? data.customDays : null,
        maxFiles: data.maxFiles,
        updatedAt: new Date(),
      })
      .where(eq(schema.backupSettings.id, settings.id));
      
    revalidatePath('/');
    return { success: true };
  } catch (error: any) {
    console.error("Updating settings Server Action failed:", error);
    return { success: false, error: error.message || String(error) };
  }
}

/**
 * Server Action: Validates dashboard password and sets session cookie.
 */
export async function login(password: string) {
  const correctPassword = process.env.DASHBOARD_PASSWORD;
  
  if (!correctPassword) {
    return { success: false, error: "Dashboard password is not set on the server. Please set DASHBOARD_PASSWORD env var." };
  }

  if (password === correctPassword) {
    const { cookies } = await import('next/headers');
    const cookieStore = await cookies();
    cookieStore.set('backup_session', 'true', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 60 * 60 * 24 * 7, // 1 week session
      path: '/'
    });
    return { success: true };
  }

  return { success: false, error: "Invalid password" };
}

/**
 * Server Action: Logs out the user by deleting the session cookie.
 */
export async function logout() {
  const { cookies } = await import('next/headers');
  const cookieStore = await cookies();
  cookieStore.delete('backup_session');
  revalidatePath('/');
  return { success: true };
}

