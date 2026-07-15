import { NextRequest, NextResponse } from "next/server";
import { adminAuthConfigured, adminAuthDisabled, adminSessionCookie, verifyAdminSession } from "@/lib/admin-auth";

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const isLogin = path === "/login" || path.startsWith("/api/auth/");
  if (adminAuthDisabled()) return NextResponse.next();
  const isAuthenticated = await verifyAdminSession(request.cookies.get(adminSessionCookie)?.value);

  if (path.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const origin = request.headers.get("origin");
    if (origin && origin !== request.nextUrl.origin) {
      return NextResponse.json({ error: "Origem não autorizada" }, { status: 403 });
    }
  }

  if (!adminAuthConfigured() && !isLogin) {
    if (path.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Painel bloqueado: configure as credenciais administrativas." },
        { status: 503 }
      );
    }
    return NextResponse.redirect(new URL("/login?setup=1", request.url));
  }

  if (isLogin) {
    if (path === "/login" && isAuthenticated) return NextResponse.redirect(new URL("/", request.url));
    return NextResponse.next();
  }

  if (!isAuthenticated) {
    if (path.startsWith("/api/")) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    const login = new URL("/login", request.url);
    login.searchParams.set("next", path);
    return NextResponse.redirect(login);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp)$).*)"],
};
