import { NextResponse } from "next/server";
import { apiError, PRIVATE_HEADERS, requireOrigin, session } from "@/lib/http";
import { cancelJob, getJob } from "@/lib/jobs";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const job = getJob(id, await session());
    return NextResponse.json({ id: job.id, status: job.status, report: job.report, error: job.error }, { headers: PRIVATE_HEADERS });
  } catch (error) { return apiError(error); }
}
export async function DELETE(request: Request, context: Context) {
  try {
    requireOrigin(request);
    cancelJob((await context.params).id, await session());
    return NextResponse.json({ cancelled: true }, { headers: PRIVATE_HEADERS });
  } catch (error) { return apiError(error); }
}