import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { AnalysisError } from "./fetch-policy.ts";

export const PRIVATE_HEADERS = { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" };

export function requireOrigin(request: Request) {
  const url = new URL(request.url);
  const developmentOrigin = process.env.NODE_ENV === "development" && request.headers.get("host") ? `${url.protocol}//${request.headers.get("host")}` : url.origin;
  const expected = process.env.APP_ORIGIN || developmentOrigin;
  if (process.env.NODE_ENV === "production" && !process.env.APP_ORIGIN) throw new AnalysisError("APP_ORIGIN must be configured for production.", 503);
  if (request.headers.get("origin") !== expected) throw new AnalysisError("This request must originate from PrivAudit.", 403);
}

export async function readJson(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new AnalysisError("Expected a JSON request.", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new AnalysisError("Request body required.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 8192) { await reader.cancel(); throw new AnalysisError("Request too large.", 413); }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new AnalysisError("Invalid JSON request."); }
}

export async function session(create = false) {
  const jar = await cookies();
  const current = jar.get("privacy-session")?.value;
  if (current && /^[a-f0-9]{64}$/.test(current)) return current;
  if (!create) throw new AnalysisError("Your private session has expired.", 401);
  const value = randomBytes(32).toString("hex");
  jar.set("privacy-session", value, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/" });
  return value;
}

export function apiError(error: unknown) {
  const status = error instanceof AnalysisError ? error.status : error instanceof z.ZodError ? 400 : 503;
  const message = error instanceof AnalysisError ? error.message : error instanceof z.ZodError ? "Check the request fields and try again." : "This service is temporarily unavailable. Check the server and database configuration.";
  return NextResponse.json({ error: message }, { status, headers: PRIVATE_HEADERS });
}