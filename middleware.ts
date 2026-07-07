import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Define public paths that middleware shouldn't block
  // - /login: The page to enter password
  // - /api/backup: The automated backup endpoint (uses header secret)
  // - static files / images / favicon
  if (
    path === "/login" ||
    path.startsWith("/api/backup") ||
    path.startsWith("/_next") ||
    path.includes(".") // matches favicon.ico, images, etc.
  ) {
    return NextResponse.next();
  }

  const password = process.env.DASHBOARD_PASSWORD;

  // If no password is set, warn but don't block the dashboard during setup
  if (!password) {
    console.warn(
      "WARNING: DASHBOARD_PASSWORD is not configured. Access to the dashboard is unprotected.",
    );
    return NextResponse.next();
  }

  const session = request.cookies.get("backup_session")?.value;

  // Redirect to login if not authenticated
  if (session !== "true") {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

// Support running on standard app paths
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
