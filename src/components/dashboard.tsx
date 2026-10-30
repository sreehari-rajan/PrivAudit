"use client";

import { useEffect, useRef, useState, type FormEvent, type CSSProperties } from "react";
import Link from "next/link";
import { ArrowDownToLine, ArrowLeft, ArrowRight, BookOpen, Check, CheckCheck, ChevronDown, ChevronRight, CircleAlert, Columns3, Copy, ExternalLink, FileSearch, Globe2, Info, Library, Link2, LoaderCircle, LockKeyhole, Plus, ScanEye, Search, ShieldCheck, Trash2, X } from "lucide-react";
import { sampleReports } from "@/lib/sample";
import { categories, RUBRIC_VERSION } from "@/lib/rubric";
import type { Report } from "@/lib/schema";

type View = "analyze" | "compare" | "library" | "method";
type Job = { id: string; url: string; status: string; error?: string; report?: Report };
type Published = { id: string; removalCredential: string; expiresAt: string };
function tone(score: number | null) { return score === null ? "neutral" : score >= 8 ? "good" : score >= 5 ? "mixed" : "risk"; }
function scoreLabel(score: number | null) { return score === null ? "Insufficient evidence" : score >= 8 ? "Stronger protections" : score >= 5 ? "Mixed protections" : "Weaker protections"; }
function date(value: string) { return new Date(value).toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric" }); }
async function jsonRequest(path: string, options?: RequestInit) {
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...options?.headers }, cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "The request could not be completed.");
  return data;
}
function Score({ report, compact = false }: { report: Report; compact?: boolean }) {
  const overall = report.score.overall;
  return <div className={`score-ring ${tone(overall)} ${compact ? "compact" : ""}`} style={{ "--score": `${(overall ?? 0) * 10}%` } as CSSProperties} aria-label={`${overall ?? "No score"} out of 10. ${scoreLabel(overall)}`}><div><strong>{overall === null ? "--" : overall.toFixed(1)}</strong><span>/ 10</span></div></div>;
}

export function Dashboard({ initialReport }: { initialReport?: Report }) {
  const [view, setView] = useState<View>("analyze");
  const [urls, setUrls] = useState([""]);
  const [consent, setConsent] = useState(false);
  const [reports, setReports] = useState<Report[]>(initialReport ? [initialReport] : []);
  const [selected, setSelected] = useState(0);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [library, setLibrary] = useState<Report[]>([]);
  const [query, setQuery] = useState("");
  const [libraryStatus, setLibraryStatus] = useState("loading");
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishConsent, setPublishConsent] = useState(false);
  const [published, setPublished] = useState<Published | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removeId, setRemoveId] = useState("");
  const [credential, setCredential] = useState("");
  const [notice, setNotice] = useState("");
  const [legalRegion, setLegalRegion] = useState<"GDPR" | "CCPA/CPRA">("GDPR");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const report = reports[selected] ?? reports[0];
  const pending = jobs.some((job) => job.status === "queued" || job.status === "analyzing");
  const activeJobIds = jobs.filter((job) => ["queued", "analyzing"].includes(job.status)).map(({ id }) => id).join(",");

  useEffect(() => {
    const timer = setInterval(() => {
      setReports((current) => current.filter((item) => {
        if (item.sample) return true;
        const expiry = item.id === initialReport?.id ? Date.parse(item.expiresAt) : Date.parse(item.analyzedAt) + 20 * 60 * 1000;
        return expiry > Date.now();
      }));
      setJobs((current) => current.filter((job) => !job.report || Date.parse(job.report.analyzedAt) + 20 * 60 * 1000 > Date.now()));
    }, 10000);
    return () => clearInterval(timer);
  }, [initialReport?.id]);

  useEffect(() => {
    if (!activeJobIds) return;
    const controller = new AbortController();
    let active = true;
    const poll = async () => {
      for (const id of activeJobIds.split(",")) {
        try {
          const result = await jsonRequest(`/api/analyses/${id}`, { signal: controller.signal });
          if (!active) return;
          setJobs((current) => current.map((job) => job.id === id ? { ...job, ...result } : job));
          if (result.report) setReports((current) => current.some((item) => item.id === result.report.id) ? current : [...current, result.report].slice(-3));
        } catch (failure) {
          if (!active) return;
          setJobs((current) => current.map((job) => job.id === id ? { ...job, status: "failed", error: failure instanceof Error ? failure.message : "Unable to read the report." } : job));
        }
      }
    };
    void poll();
    const timer = setInterval(() => { void poll(); }, 2000);
    return () => { active = false; controller.abort(); clearInterval(timer); };
  }, [activeJobIds]);

  useEffect(() => {
    if (view !== "library") return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLibraryStatus("loading");
      void jsonRequest(`/api/reports?q=${encodeURIComponent(query)}`, { signal: controller.signal }).then((data) => {
        setLibrary(data.reports); setLibraryStatus(data.configured ? "ready" : "unconfigured");
      }).catch(() => { if (!controller.signal.aborted) setLibraryStatus("error"); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [view, query]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (publishOpen || removeOpen) dialog?.showModal();
    else dialog?.close();
  }, [publishOpen, removeOpen]);

  function navigate(next: View) { setView(next); setError(""); setNotice(""); }
  function loadSamples() {
    if (pending || submitting) { setError("Wait for active analyses to finish or cancel them before opening samples."); return; }
    setReports(sampleReports()); setSelected(0); setJobs([]); setError(""); setExpanded(null); setPublished(null); setView("analyze");
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(""); setNotice(""); setSubmitting(true);
    try {
      const data = await jsonRequest("/api/analyses", { method: "POST", body: JSON.stringify({ urls: urls.map((url) => url.trim()).filter(Boolean), processingConsent: consent }) });
      setReports([]); setSelected(0); setPublished(null); setJobs(data.jobs.map((job: Job) => ({ ...job, status: "queued" })));
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to start analysis."); }
    finally { setSubmitting(false); }
  }
  async function cancel(job: Job) {
    try {
      await jsonRequest(`/api/analyses/${job.id}`, { method: "DELETE" });
      setJobs((current) => current.map((item) => item.id === job.id ? { ...item, status: "cancelled" } : item));
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to cancel."); }
  }
  async function publish(event: FormEvent) {
    event.preventDefault(); setError(""); setPublishing(true);
    const job = jobs.find((item) => item.report?.id === report?.id);
    try {
      if (!job) throw new Error("This is not a publishable private analysis.");
      const result = await jsonRequest(`/api/analyses/${job.id}/publish`, { method: "POST", body: JSON.stringify({ consent: publishConsent }) });
      setPublished(result); setPublishOpen(false); setNotice("Published to the library. Your removal credential is shown below.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to publish."); }
    finally { setPublishing(false); }
  }
  async function remove(event: FormEvent) {
    event.preventDefault(); setPublishing(true); setError("");
    try {
      await jsonRequest(`/api/reports/${encodeURIComponent(removeId.trim())}`, { method: "DELETE", body: JSON.stringify({ credential: credential.trim() }) });
      setLibrary((current) => current.filter((item) => item.id !== removeId.trim())); setPublished(null); setRemoveOpen(false); setCredential(""); setNotice("The report and its excerpts have been removed from the library.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to remove report."); }
    finally { setPublishing(false); }
  }
  function download() {
    if (!report) return;
    const anchor = document.createElement("a");
    const objectUrl = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    anchor.href = objectUrl; anchor.download = `privaudit-${new URL(report.finalUrl).hostname}.json`; anchor.click(); URL.revokeObjectURL(objectUrl);
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <Link className="brand" href="/" aria-label="PrivAudit home"><span className="brand-mark"><ScanEye size={24} /></span><span>Priv<span className="brand-light">Audit</span></span></Link>
      <span className="nav-caption">WORKSPACE</span>
      <nav aria-label="Main navigation">{([{ id: "analyze", label: "Analyze policy", Icon: FileSearch }, { id: "compare", label: "Compare", Icon: Columns3 }, { id: "library", label: "Public library", Icon: Library }] as const).map(({ id, label, Icon }) => <button key={id} className={`nav-item ${view === id ? "active" : ""}`} onClick={() => navigate(id)} aria-current={view === id ? "page" : undefined}><Icon size={18} /><span>{label}</span>{id === "compare" && reports.length > 0 && <span className="nav-count">{reports.length}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><button className={`nav-item ${view === "method" ? "active" : ""}`} onClick={() => navigate("method")}><BookOpen size={18} />Scoring methodology</button><div className="local-status"><span className="status-dot" />Policy-based assessment<span>Rubric v{RUBRIC_VERSION}</span></div><p>Less guesswork.<br />More informed choices.</p></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><div><span className="topbar-path">Workspace</span><ChevronRight size={14} /><span>{view === "analyze" ? "Policy analysis" : view === "compare" ? "Comparison" : view === "library" ? "Public library" : "Methodology"}</span></div><span className="private-badge"><LockKeyhole size={13} />{initialReport ? "Public report" : "Private until published"}</span></header>
      <main id="main-content">
        <div className="page-heading"><div><span className="eyebrow">A CLOSER LOOK AT THE FINE PRINT</span><h1>{view === "analyze" ? "Privacy analysis" : view === "compare" ? "Compare policies" : view === "library" ? "Public library" : "Behind the score"}</h1></div>{view === "analyze" && <button className="text-button" onClick={loadSamples}>Explore sample reports<ArrowRight size={16} /></button>}{view === "library" && <button className="secondary" onClick={() => { setRemoveOpen(true); setError(""); }}>Remove a report<Trash2 size={15} /></button>}</div>
        {error && !publishOpen && !removeOpen && <div className="alert error" role="alert"><CircleAlert size={18} /><span>{error}</span><button className="icon-button" aria-label="Dismiss error" onClick={() => setError("")}><X size={16} /></button></div>}
        {notice && <div className="alert success" role="status"><Check size={18} />{notice}</div>}
        {view === "analyze" && <>
          {!initialReport && <form className="analyzer" onSubmit={submit}>
            <div className="section-label"><span className="step-number">01</span><h2>Start with a privacy policy</h2><span className="muted small">Public English-language pages</span></div>
            {urls.map((url, index) => <div className="url-row" key={index}><label className="url-input"><Link2 size={18} /><input type="url" aria-label={`Privacy policy URL ${index + 1}`} placeholder="https://example.com/privacy" required value={url} onChange={(event) => setUrls((current) => current.map((value, item) => item === index ? event.target.value : value))} disabled={pending || submitting} /></label>{index > 0 && <button type="button" className="icon-button remove-url" aria-label={`Remove URL ${index + 1}`} onClick={() => setUrls((current) => current.filter((_, item) => item !== index))} disabled={pending}><X size={18} /></button>}{index === 0 && <button className="primary analyze-button" type="submit" disabled={pending || submitting || !consent}>{pending || submitting ? <LoaderCircle size={17} className="spin" /> : <ScanEye size={17} />}{pending || submitting ? "Analyzing" : "Analyze policy"}</button>}</div>)}
            <div className="input-footer"><label className="checkbox"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>I agree to send the URL and policy text to Google Gemini for analysis.</span></label>{urls.length < 3 && <button type="button" className="text-button small" onClick={() => setUrls((current) => [...current, ""])} disabled={pending}><Plus size={14} />Add policy</button>}</div>
            <p className="input-warning"><LockKeyhole size={12} />Do not submit private links or personal information. Google may use free-tier submissions to improve its products. Unpublished results expire after 20 minutes.</p>
          </form>}
          {jobs.length > 0 && <div className="job-list" aria-live="polite">{jobs.map((job) => <div className={`job ${job.status === "failed" ? "job-error" : ""}`} key={job.id}>{["queued", "analyzing"].includes(job.status) ? <LoaderCircle size={16} className="spin" /> : job.status === "complete" ? <CheckCheck size={16} /> : <CircleAlert size={16} />}<span><strong>{new URL(job.url).hostname}</strong><small>{job.error ?? (job.status === "analyzing" ? "Fetching policy and validating evidence..." : job.status === "complete" ? "Assessment complete" : job.status)}</small></span>{["queued", "analyzing"].includes(job.status) && <button className="icon-button" aria-label="Cancel analysis" onClick={() => void cancel(job)}><X size={16} /></button>}</div>)}</div>}
          {reports.length > 1 && <div className="report-selector" role="tablist" aria-label="Analyzed policies">{reports.map((item, index) => <button key={item.id} role="tab" aria-selected={selected === index} onClick={() => { setSelected(index); setExpanded(null); setPublished(null); }} className={selected === index ? "selected" : ""}>{item.organization}<span className={tone(item.score.overall)}>{item.score.overall?.toFixed(1) ?? "--"}</span></button>)}</div>}
          {report ? <>
            <div className="report-heading"><div className="company-mark">{report.organization.slice(0, 1)}</div><div><h2>{report.organization}{report.sample && <span className="tag">FICTIONAL SAMPLE</span>}</h2><a href={report.finalUrl} target="_blank" rel="noreferrer">{new URL(report.finalUrl).hostname}<ExternalLink size={12} /></a></div><div className="report-actions"><button className="icon-button" title="Download report as JSON" aria-label="Download report as JSON" onClick={download}><ArrowDownToLine size={17} /></button>{!report.sample && !initialReport && <button className="secondary" onClick={() => { setPublishConsent(false); setPublishOpen(true); setError(""); }}>Publish report<Globe2 size={15} /></button>}</div></div>
            {report.sample && <div className="sample-notice"><Info size={15} />Fictional policy and illustrative results. No website was fetched and no AI request was made.</div>}
            <section className="score-overview" aria-label="Assessment overview"><div className="overall"><Score report={report} /><div><span className="eyebrow">PRIVACY PROTECTION SCORE</span><h2 className={tone(report.score.overall)}>{scoreLabel(report.score.overall)}</h2><p>{report.score.overall === null ? "More policy evidence is needed before an overall score can be shown." : "Higher scores reflect stronger stated protections under our rubric."}</p><span className={`score-chip ${tone(report.score.overall)}`}><ShieldCheck size={14} />{report.score.overall === null ? "Score withheld" : "Evidence-backed assessment"}</span></div></div><div className="overview-meta"><div><span>Evidence coverage</span><strong>{report.score.coverage}%</strong></div><div className="coverage-track"><span style={{ width: `${report.score.coverage}%` }} /></div><div><span>Categories assessed</span><strong>{report.score.breakdown.filter(({ score }) => score !== null).length}<small> / 10</small></strong></div><div><span>Analyzed</span><strong className="date-value">{date(report.analyzedAt)}</strong></div></div></section>
            <p className="assessment-caveat"><Info size={13} />Assesses policy disclosures, not actual practices or legal compliance.</p>
            <div className="report-grid"><section className="category-section"><div className="section-title"><h2>Category breakdown</h2><span className="muted small">Weighted out of 10</span></div><div className="category-head"><span>PRIVACY CATEGORY</span><span>SCORE / WEIGHT</span></div>{report.score.breakdown.map((category) => {
              const finding = report.findings.find(({ id }) => id === category.id)!;
              return <div className="category-item" key={category.id}><button className="category-row" aria-expanded={expanded === category.id} aria-controls={`evidence-${category.id}`} onClick={() => setExpanded(expanded === category.id ? null : category.id)}><span className={`category-dot ${tone(category.score)}`} /><span className="category-name">{category.name}</span><span className="mini-track"><span className={tone(category.score)} style={{ width: `${(category.score ?? 0) * 10}%` }} /></span><strong className={tone(category.score)}>{category.score === null ? "--" : category.score.toFixed(1)}</strong><span className="category-weight">{category.weight}%</span><ChevronDown size={15} className={expanded === category.id ? "rotated" : ""} /></button>{expanded === category.id && <div id={`evidence-${category.id}`} className="evidence"><p>{finding.explanation}</p>{finding.quote ? <><blockquote>{finding.quote}</blockquote><div className="quote-source"><CheckCheck size={13} />{report.sample ? "Fictional sample excerpt" : "Exact excerpt verified against fetched text"}{finding.section && <span> / {finding.section}</span>}</div><a href={report.finalUrl} target="_blank" rel="noreferrer" className="text-button small">View policy source<ExternalLink size={12} /></a></> : <span className="muted small">No verified supporting excerpt. Unknown, not a zero.</span>}</div>}</div>;
            })}</section><aside className="report-rail"><section className="risk-summary"><div className="section-title"><h2>Worth a closer look</h2><CircleAlert size={17} /></div>{report.score.breakdown.filter(({ score }) => score === null || score < 8).slice(0, 3).map((category) => <button className="risk-item" key={category.id} onClick={() => setExpanded(category.id)}><span className={`risk-symbol ${tone(category.score)}`}>{category.score === null ? "?" : "!"}</span><span><strong>{category.name}</strong><small>{category.score === null ? "Insufficient disclosure" : category.score === 0 ? "Explicit privacy risk" : "Material exceptions remain"}</small></span><ChevronRight size={15} /></button>)}{report.score.breakdown.every(({ score }) => score !== null && score >= 8) && <p className="muted small">No weak categories under this rubric. Stated protections are not verified behavior.</p>}</section><section className="legal-section"><div className="section-title"><h2>Regional disclosures</h2><Globe2 size={17} /></div><div className="segmented" role="tablist" aria-label="Regional disclosure checks">{(["GDPR", "CCPA/CPRA"] as const).map((region) => <button key={region} role="tab" aria-selected={legalRegion === region} onClick={() => setLegalRegion(region)}>{region}</button>)}</div><p className="muted small">Disclosure checks only. Legal applicability and compliance are not established.</p>{report.legal.filter(({ region }) => region === legalRegion).map((item, index) => <details className="legal-check" key={`${legalRegion}-${index}`}><summary><span className={item.status === "evidence_found" ? "good" : item.status === "potential_gap" ? "mixed" : "neutral"}>{item.status === "evidence_found" ? <Check size={15} /> : <Info size={15} />}</span><span>{item.topic}<small>{item.status === "evidence_found" ? "Evidence found" : item.status === "potential_gap" ? "Potential gap" : item.status === "not_applicable" ? "Not applicable (qualified)" : "Unclear"}</small></span><ChevronDown size={13} /></summary><p>{item.explanation}</p>{item.quote && <blockquote>{item.quote}</blockquote>}</details>)}</section></aside></div>
            {published && <section className="publication-result"><h2>Report published</h2><a href={`/reports/${published.id}`}>Open public report<ExternalLink size={14} /></a><p>Removal credential (shown only in this session):</p><div className="credential"><code>{published.removalCredential}</code><button className="icon-button" title="Copy removal credential" aria-label="Copy removal credential" onClick={async () => { try { await navigator.clipboard.writeText(published.removalCredential); setCopied(true); } catch { setError("Clipboard unavailable. Select the credential manually."); } }}>{copied ? <Check size={16} /> : <Copy size={16} />}</button></div><p className="muted small">Expires {date(published.expiresAt)}. Anyone with this credential can remove the report.</p><button className="text-button" onClick={() => { setRemoveId(published.id); setCredential(published.removalCredential); setRemoveOpen(true); }}>Remove publication<Trash2 size={14} /></button></section>}
            <div className="report-footer"><span>Rubric v{report.rubricVersion} / {report.sample ? "Illustrative assessment" : report.model}</span><button className="text-button small" onClick={() => navigate("method")}>How scores are calculated<ArrowRight size={14} /></button></div>
          </> : !pending && <section className="empty-workspace"><div className="empty-illustration"><FileSearch size={42} strokeWidth={1.3} /><span><ShieldCheck size={21} /></span></div><h2>What does the fine print say?</h2><p>Enter a privacy-policy URL to begin.</p><button className="secondary" onClick={loadSamples}>Open fictional sample reports<ArrowRight size={15} /></button><div className="empty-labels"><span><CheckCheck size={15} />Quoted evidence</span><span><Columns3 size={15} />Side-by-side comparison</span><span><Globe2 size={15} />Regional checks</span></div></section>}
        </>}
        {view === "compare" && <section className="comparison">{reports.length < 2 ? <div className="empty-workspace"><Columns3 size={38} strokeWidth={1.3} /><h2>Add another perspective</h2><p>Analyze two or three policies, or open the fictional samples.</p><button className="secondary" onClick={loadSamples}>Open sample reports<ArrowRight size={15} /></button></div> : <><div className="comparison-note"><Info size={16} />Compare stated protections alongside coverage and dates. Unknown is not a zero; incomplete or incompatible reports are not ranked.</div><div className="comparison-scroll"><table><caption className="sr-only">Privacy-policy comparison</caption><thead><tr><th>Protection category</th>{reports.map((item) => <th key={item.id}><strong>{item.organization}</strong>{item.sample && <span className="tag">SAMPLE</span>}<Score report={item} compact /><span className={tone(item.score.overall)}>{scoreLabel(item.score.overall)}</span><small>{item.score.coverage}% evidence / {date(item.analyzedAt)}</small><small>Rubric {item.rubricVersion}</small></th>)}</tr></thead><tbody>{categories.map((category) => <tr key={category.id}><th>{category.name}<small>{category.weight}% weight</small></th>{reports.map((item) => { const score = item.score.breakdown.find(({ id }) => id === category.id)?.score ?? null; return <td key={item.id} className={tone(score)}>{score === null ? "Unknown" : `${score.toFixed(1)} / 10`}</td>; })}</tr>)}</tbody></table></div><button className="text-button" onClick={() => navigate("analyze")}><ArrowLeft size={15} />Back to evidence</button></>}</section>}
        {view === "library" && <section className="library"><div className="library-toolbar"><label className="search-input"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search company or domain" aria-label="Search public reports" /></label><span className="muted small">Reports expire after 30 days</span></div><div aria-live="polite">{libraryStatus === "loading" ? <p className="loading-line"><LoaderCircle size={17} className="spin" />Loading reports...</p> : libraryStatus === "error" ? <div className="alert error"><CircleAlert size={17} />The library is unavailable. Check the database connection.</div> : library.length ? <div className="library-list">{library.map((item) => <a className="library-row" key={item.id} href={`/reports/${item.id}`}><div className="company-mark">{item.organization.slice(0, 1)}</div><div><h2>{item.organization}</h2><span>{new URL(item.finalUrl).hostname}</span><small>Analyzed {date(item.analyzedAt)} / Expires {date(item.expiresAt)}</small></div><strong className={tone(item.score.overall)}>{item.score.overall?.toFixed(1) ?? "--"}<small> / 10</small></strong><ChevronRight size={18} /></a>)}</div> : <div className="empty-workspace"><Library size={38} strokeWidth={1.3} /><h2>{libraryStatus === "unconfigured" ? "Connect the public library" : "No published reports yet"}</h2><p>{libraryStatus === "unconfigured" ? "PostgreSQL must be configured before reports can be published or searched." : query ? "No reports match that company or domain." : "Only reports explicitly published by their submitter appear here."}</p><button className="secondary" onClick={() => navigate("analyze")}>Analyze a policy<ArrowRight size={15} /></button></div>}</div></section>}
        {view === "method" && <section className="methodology"><div className="method-intro"><BookOpen size={25} /><h2>A score you can question.</h2><p>PrivAudit assesses what a policy says, not what a company actually does. Our proposed rubric draws on NIST and FTC privacy guidance and consumer rights under GDPR and CCPA/CPRA. None of these sources certifies this numerical rating.</p></div><div className="method-columns"><section><h2>Evidence before numbers</h2><p>Each category is assessed as strong (10), mixed (5), weak (0), unknown, or explicitly not applicable. Gemini extracts commitments and risks; the backend calculates the weighted mean.</p><p>Quoted findings must match the fetched text exactly. Missing or unverifiable evidence stays unknown. Strong means specific commitments without material exceptions; mixed means protections with important exceptions; weak means an explicit intrusive permission or weak protection.</p><p>An overall score requires at least 80% weighted evidence coverage and assessable collection, purposes, sharing, controls and rights categories. Critical categories cannot be marked not applicable.</p><h2>Limits worth knowing</h2><p>Policy text cannot establish legal compliance, security effectiveness or real-world tracking. Linked documents and JavaScript-only text are not fetched. We reject oversized documents rather than silently scoring a fragment.</p><p>Assessments can be wrong or become outdated. Use the source excerpts and seek qualified advice for legal decisions.</p></section><section><h2>Category weights</h2>{categories.map((category) => <div className="weight-row" key={category.id}><span>{category.name}</span><strong>{category.weight}%</strong></div>)}</section></div><section className="retention-note"><LockKeyhole size={20} /><div><h2>Your submissions</h2><p>Unpublished content is held temporarily in server memory and this browser tab, not saved in the report database. It expires after 20 minutes; server restarts can clear it sooner. Live analysis sends policy text to Google Gemini, whose own processing and retention terms apply. Free-tier submissions may be used to improve Google products. Published reports and excerpts expire 30 days after analysis, with scheduled deletion. Other people may copy public material. Removal cannot recall those copies.</p></div></section><div className="method-links"><a href="https://www.nist.gov/privacy-framework" target="_blank" rel="noreferrer">NIST Privacy Framework<ExternalLink size={13} /></a><a href="https://www.ftc.gov/business-guidance/privacy-security" target="_blank" rel="noreferrer">FTC privacy guidance<ExternalLink size={13} /></a><a href="https://commission.europa.eu/law/law-topic/data-protection/information-individuals_en" target="_blank" rel="noreferrer">GDPR rights<ExternalLink size={13} /></a><a href="https://oag.ca.gov/privacy/ccpa" target="_blank" rel="noreferrer">California privacy rights<ExternalLink size={13} /></a></div></section>}
        <footer className="workspace-footer"><span><ScanEye size={14} />PrivAudit</span><button className="text-button small mobile-method" onClick={() => navigate("method")}>Methodology</button><span>Not legal advice</span></footer>
      </main>
    </div>
    <dialog ref={dialogRef} onCancel={() => { setPublishOpen(false); setRemoveOpen(false); }} className="modal"><div className="modal-heading"><h2>{removeOpen ? "Remove a public report" : "Publish to the public library"}</h2><button className="icon-button" aria-label="Close dialog" onClick={() => { setPublishOpen(false); setRemoveOpen(false); }}><X size={18} /></button></div>{error && <div className="alert error" role="alert">{error}</div>}{removeOpen ? <form onSubmit={remove}><label className="field-label">Report ID<input required value={removeId} onChange={(event) => setRemoveId(event.target.value)} autoComplete="off" /></label><label className="field-label">Removal credential<input required value={credential} onChange={(event) => setCredential(event.target.value)} autoComplete="off" spellCheck={false} /></label><p className="muted small">Removal deletes our public report and excerpts. It cannot remove copies held by other people.</p><button className="danger-button" disabled={publishing}>{publishing ? <LoaderCircle size={16} className="spin" /> : <Trash2 size={16} />}Remove report</button></form> : report && <form onSubmit={publish}><p>The report, its source URL, scores and quoted excerpts will become public and searchable inside PrivAudit until {date(report.expiresAt)}.</p><div className="publish-preview"><strong>{report.organization}</strong><span>{report.finalUrl}</span><span>{report.score.overall?.toFixed(1) ?? "Insufficient evidence"} / 10</span><small>{report.findings.filter(({ quote }) => quote).length} excerpts from the report you just reviewed</small></div><p className="muted small">Check every excerpt for personal information before publishing. Automated screening is not a guarantee. Others may copy public material. A removal credential will be shown once publication completes.</p><label className="checkbox publish-consent"><input type="checkbox" checked={publishConsent} onChange={(event) => setPublishConsent(event.target.checked)} required /><span>I reviewed the report and consent to public publication of the URL and excerpts for up to 30 days.</span></label><button className="primary" disabled={!publishConsent || publishing}>{publishing ? <LoaderCircle size={16} className="spin" /> : <Globe2 size={16} />}Publish report</button></form>}</dialog>
  </div>;
}