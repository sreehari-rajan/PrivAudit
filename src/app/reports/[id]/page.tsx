import { Dashboard } from "@/components/dashboard";
import { readReport } from "@/lib/reports";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";
export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const report = await readReport((await params).id).catch(() => null);
  if (!report) notFound();
  return <Dashboard initialReport={report} />;
}