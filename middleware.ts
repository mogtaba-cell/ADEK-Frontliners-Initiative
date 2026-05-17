import { NextResponse, type NextRequest } from "next/server";

const protectedPrefixes = [
  "/admin",
  "/coordinator",
  "/evaluator",
  "/management",
  "/proofreader",
  "/reviewer",
  "/submissions",
  "/analytics",
];

export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;

  const isProtected = protectedPrefixes.some((prefix) =>
    path.startsWith(prefix)
  );

  if (isProtected && !req.cookies.get("afi_session")) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", path);

    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};