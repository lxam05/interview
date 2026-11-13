import "server-only";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { serverSecret } from "@/lib/protect";
import { createSessionToken, SESSION_COOKIE, verifySessionToken } from "./token";

/**
 * Every admin page, server action and route handler calls this first. The
 * proxy only redirects for convenience; this is the security boundary.
 */
export async function requireAdmin(): Promise<void> {
  if (!(await isAdmin())) redirect("/admin/login");
}

export async function isAdmin(): Promise<boolean> {
  // Always a request-time check: never part of a prerendered shell.
  await connection();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return verifySessionToken(token, serverSecret());
}

export async function startSession(): Promise<void> {
  const { token, expires } = createSessionToken(serverSecret());
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires,
  });
}

export async function endSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
