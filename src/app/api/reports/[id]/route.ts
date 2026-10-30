import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, PRIVATE_HEADERS, readJson, requireOrigin } from "@/lib/http";
import { readReport, removeReport } from "@/lib/reports";
import { takeQuota } from "@/lib/limits";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  try { return NextResponse.json({ report: await readReport((await context.params).id) }, { headers: PRIVATE_HEADERS }); }
  catch (error) { return apiError(error); }
}
export async function DELETE(request: Request, context: Context) {
  try {
    requireOrigin(request);
    const { credential } = z.object({ credential: z.string().regex(/^[a-f0-9]{64}$/) }).parse(await readJson(request));
    const minute = Math.floor(Date.now() / 60000);
    await takeQuota(`removal:${minute}`, 30, 1, (minute + 1) * 60000);
    await removeReport((await context.params).id, credential);
    return NextResponse.json({ removed: true }, { headers: PRIVATE_HEADERS });
  } catch (error) { return apiError(error); }
}