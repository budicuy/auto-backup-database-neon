import { NextRequest, NextResponse } from 'next/server';
import { runBackupJob } from '../../../lib/backup';

export const maxDuration = 300; // Allow up to 5 minutes on Vercel Hobby
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return handleBackupRequest(req);
}

export async function POST(req: NextRequest) {
  return handleBackupRequest(req);
}

async function handleBackupRequest(req: NextRequest) {
  const authHeader = req.headers.get('Authorization');
  const secret = process.env.BACKUP_SECRET;

  if (!secret) {
    console.error("BACKUP_SECRET env variable is not configured");
    return NextResponse.json(
      { error: 'Server configuration error: BACKUP_SECRET is not set' },
      { status: 500 }
    );
  }

  // Authorization check
  if (!authHeader || authHeader !== `Bearer ${secret}`) {
    console.warn("Unauthorized backup attempt block.");
    return NextResponse.json(
      { error: 'Unauthorized: Invalid or missing backup secret token' },
      { status: 401 }
    );
  }

  try {
    // Run scheduled backup (isManualOverride = false)
    const result = await runBackupJob(false);
    
    if (result.skipped) {
      return NextResponse.json({
        message: result.message,
        skipped: true,
        lastSuccessAt: result.settings.lastSuccessAt
      });
    }

    return NextResponse.json({
      message: 'Backup completed successfully',
      skipped: false,
      url: result.url,
      path: result.path,
      sizeBytes: result.sizeBytes
    });
  } catch (error: any) {
    console.error("Backup API endpoint failed:", error);
    return NextResponse.json(
      { error: 'Backup failed', details: error.message || String(error) },
      { status: 500 }
    );
  }
}
