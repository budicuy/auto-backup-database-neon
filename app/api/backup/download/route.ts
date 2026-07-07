import { type NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // 1. Check dashboard session cookie for authorization
  const session = req.cookies.get("backup_session")?.value;
  if (session !== "true") {
    console.warn("Unauthorized attempt to download backup file.");
    return new NextResponse("Unauthorized: Access denied", { status: 401 });
  }

  const url = req.nextUrl.searchParams.get("url");
  if (!url) {
    return new NextResponse("Bad Request: Missing url parameter", {
      status: 400,
    });
  }

  // Security check: ensure URL is indeed from vercel storage to prevent server-side request forgery (SSRF)
  if (!url.includes(".blob.vercel-storage.com/")) {
    return new NextResponse("Forbidden: Invalid source domain", {
      status: 403,
    });
  }

  try {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) {
      console.error("BLOB_READ_WRITE_TOKEN is not configured on the server");
      return new NextResponse(
        "Internal Server Error: Storage token is missing",
        { status: 500 },
      );
    }

    // 2. Fetch the private blob content from Vercel Blob Storage using authentication
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      console.error(
        `Failed to fetch private blob. Status: ${response.status} ${response.statusText}`,
      );
      return new NextResponse("Failed to fetch backup file from storage", {
        status: response.status,
      });
    }

    const filename = url.split("/").pop() || "backup.sql.gz";

    // 3. Stream the file content directly back to the client as a download
    return new NextResponse(response.body, {
      headers: {
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error: any) {
    console.error("Error during secure backup file download:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
