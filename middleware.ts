import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

const PUBLIC_PATHS = ["/login", "/api/auth"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p)))
    return NextResponse.next();

  const cookie = getSessionCookie(req);
  if (!cookie)
    return NextResponse.redirect(new URL("/login", req.url));

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|favicon.svg).*)"],
};
