import { NextResponse } from "next/server";
import { adminSessionCookie, createAdminSession, validAdminCredentials } from "@/lib/admin-auth";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(request: Request) {
  const blocked = rateLimit(request, "admin-login", 5, 15 * 60 * 1000);
  if (blocked) return blocked;

  let body: { email?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!validAdminCredentials(email, password)) {
    await new Promise((resolve) => setTimeout(resolve, 350));
    return NextResponse.json({ error: "E-mail ou senha incorretos" }, { status: 401 });
  }

  const session = await createAdminSession();
  const response = NextResponse.json({ ok: true });
  response.cookies.set(adminSessionCookie, session.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: session.maxAge,
  });
  return response;
}
