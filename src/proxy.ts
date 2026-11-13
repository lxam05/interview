import { NextResponse, type NextRequest } from "next/server";

/*
 * Convenience only: sends signed-out visitors to the login page. The real
 * check is requireAdmin() in every admin page and action.
 */
export function proxy(request: NextRequest) {
  if (!request.cookies.has("admin_session")) {
    return NextResponse.redirect(new URL("/admin/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin", "/admin/((?!login).*)"],
};
