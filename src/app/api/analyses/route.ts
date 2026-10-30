import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, PRIVATE_HEADERS, readJson, requireOrigin, session } from "@/lib/http";
import { AnalysisError, validatePolicyUrl } from "@/lib/fetch-policy";
import { createJob } from "@/lib/jobs";
import { geminiConfig } from "@/lib/gemini";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    requireOrigin(request);
    const { urls, processingConsent } = z.object({ urls: z.array(z.string().max(2000)).min(1).max(3), processingConsent: z.literal(true) }).parse(await readJson(request));
    if (!processingConsent) throw new AnalysisError("Processing consent is required.");
    const validated = [...new Set(urls.map((url) => validatePolicyUrl(url).href))];
    geminiConfig();
    if (process.env.NODE_ENV === "production" && process.env.PUBLIC_LAUNCH_APPROVED !== "true") throw new AnalysisError("Production analysis is disabled until the security launch checklist is completed.", 503);
    const owner = await session(true);
    const jobs = validated.map((url) => ({ id: createJob(url, owner), url }));
    return NextResponse.json({ jobs }, { status: 202, headers: PRIVATE_HEADERS });
  } catch (error) { return apiError(error); }
}