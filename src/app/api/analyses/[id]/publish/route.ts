import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, PRIVATE_HEADERS, readJson, requireOrigin, session } from "@/lib/http";
import { getJob } from "@/lib/jobs";
import { publishReport } from "@/lib/reports";
import { AnalysisError } from "@/lib/fetch-policy";
import { takeQuota } from "@/lib/limits";

export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requireOrigin(request);
    z.object({ consent: z.literal(true) }).parse(await readJson(request));
    const owner = await session();
    const hour = Math.floor(Date.now() / 3600000);
    await takeQuota(`publish:${owner}:${hour}`, 6, 1, (hour + 1) * 3600000);
    const job = getJob((await context.params).id, owner);
    if (job.status !== "complete" || !job.report) throw new AnalysisError("Only completed, validated reports can be published.");
    return NextResponse.json(await publishReport(job.report), { status: 201, headers: PRIVATE_HEADERS });
  } catch (error) { return apiError(error); }
}