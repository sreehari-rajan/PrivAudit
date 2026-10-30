import Link from "next/link";
import { FileSearch } from "lucide-react";

export default function NotFound() {
  return <main className="empty-workspace"><FileSearch size={40} /><h1>Report unavailable</h1><p>This report may have expired, been removed, or never been published.</p><Link className="primary" href="/">Back to PrivAudit</Link></main>;
}