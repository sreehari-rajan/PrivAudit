import { NextResponse } from "next/server";
import { apiError, PRIVATE_HEADERS } from "@/lib/http";
import { searchReports } from "@/lib/reports";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const query = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 100);
    return NextResponse.json(await searchReports(query), { headers: PRIVATE_HEADERS });
  } catch (error) { return apiError(error); }
}