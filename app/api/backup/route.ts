import { type NextRequest, NextResponse } from "next/server";
import { db } from "../../../db/index";
import * as schema from "../../../db/schema";
import { runBackupJob } from "../../../lib/backup";

export const maxDuration = 300; // Allow up to 5 minutes on Vercel Hobby
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return handleCronBackup(req);
}

export async function POST(req: NextRequest) {
  return handleCronBackup(req);
}

async function handleCronBackup(req: NextRequest) {
  const authHeader = req.headers.get("Authorization");
  const secret = process.env.BACKUP_SECRET;

  if (!secret) {
    console.error("BACKUP_SECRET env variable is not configured");
    return NextResponse.json(
      { error: "Server configuration error: BACKUP_SECRET is not set" },
      { status: 500 },
    );
  }

  // Authorization check
  if (!authHeader || authHeader !== `Bearer ${secret}`) {
    console.warn("Unauthorized backup attempt block.");
    return NextResponse.json(
      { error: "Unauthorized: Invalid or missing backup secret token" },
      { status: 401 },
    );
  }

  try {
    // Fetch all database targets from config database
    const targets = await db.select().from(schema.databases);

    if (targets.length === 0) {
      return NextResponse.json({
        message: "No database targets registered for backup",
        results: [],
      });
    }

    const results = [];

    // Run scheduled backup checks sequentially
    for (const target of targets) {
      try {
        const res = await runBackupJob(target.id, false);
        results.push({
          id: target.id,
          name: target.name,
          status: res.skipped ? "SKIPPED" : "SUCCESS",
          message: res.skipped ? res.message : "Backup completed",
          url: !res.skipped ? res.url : undefined,
        });
      } catch (err: any) {
        console.error(
          `Scheduled backup failed for "${target.name}" (ID: ${target.id}):`,
          err,
        );
        results.push({
          id: target.id,
          name: target.name,
          status: "FAILED",
          message: err.message || String(err),
        });
      }
    }

    const hasFailure = results.some((r) => r.status === "FAILED");

    return NextResponse.json(
      {
        message: hasFailure
          ? "Some scheduled backups failed"
          : "All scheduled checks processed",
        results,
      },
      { status: hasFailure ? 200 : 200 },
    ); // Still return 200 so Vercel Cron registers a complete invocation
  } catch (error: any) {
    console.error("API Backup route cron failed completely:", error);
    return NextResponse.json(
      {
        error: "General cron runner failure",
        details: error.message || String(error),
      },
      { status: 500 },
    );
  }
}
