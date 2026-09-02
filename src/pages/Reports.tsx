import Layout from "@/components/Layout";
import PageHeader from "@/components/PageHeader";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSelectedProject } from "@/context/SelectedProjectContext";
import { useProjects } from "@/hooks/useProjects";
import { useDailyProgressReport } from "@/hooks/useDailyProgressReport";
import { formatDisplayDate, todayPKT } from "@/lib/pktDate";
import { useState } from "react";

const DAILY_PROGRESS_PRINT_CSS = `
  #daily-progress-report table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  #daily-progress-report th, #daily-progress-report td { border: 1px solid #000; padding: 4px 5px; font-size: 10px; }
  #daily-progress-report th { background: #ddd !important; color: #000 !important; }
  #daily-progress-report h3 { margin: 12px 0 6px; text-align: center; font-size: 14px; }
`;
const number = (value: number) => value === 0 ? "—" : value.toLocaleString("en-PK", { maximumFractionDigits: 2 });

export default function Reports() {
  const { selectedProjectId, setSelectedProjectId } = useSelectedProject();
  const { projects } = useProjects();
  const [date, setDate] = useState(todayPKT());
  const { report, loading, error } = useDailyProgressReport(selectedProjectId || null, date);
  const projectName = report?.projectName ?? projects.find((p) => p.id === selectedProjectId)?.name ?? "Project";
  return <Layout>
    <PageHeader title="Daily Progress Report" subtitle={formatDisplayDate(date)} printProjectName={projectName} printTargetId="daily-progress-report"
      printOptions={{ additionalPrintCss: DAILY_PROGRESS_PRINT_CSS, printDocumentTitle: `Daily progress — ${projectName} — ${formatDisplayDate(date)}` }} />
    <div className="print-hidden flex flex-wrap items-end gap-4 mb-5 border-2 border-border p-4">
      <div><Label>Project</Label><Select value={selectedProjectId} onValueChange={setSelectedProjectId}><SelectTrigger className="mt-1 w-64"><SelectValue placeholder="Select project" /></SelectTrigger><SelectContent>{projects.map((p)=><SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select></div>
      <div><Label>Date</Label><Input className="mt-1 w-44" type="date" value={date} onChange={(e)=>setDate(e.target.value)} /></div>
    </div>
    {loading && <p className="py-10 text-center text-muted-foreground">Loading report…</p>}
    {error && <p className="py-10 text-center text-destructive">{error}</p>}
    {!loading && !error && !selectedProjectId && <p className="py-10 text-center text-muted-foreground">Select a project.</p>}
    {report && <div id="daily-progress-report" className="space-y-5">
      <section><h3 className="text-center font-bold uppercase mb-2">Machinery Progress Report</h3><div className="overflow-x-auto"><table className="w-full min-w-[900px] border-collapse text-sm"><thead><tr className="bg-primary text-primary-foreground">
        {['Sr','Machinery','Diesel','P.Diesel','T.Diesel','Hour','P.Hour','T.Hour','Avg','Remarks'].map((h)=><th key={h} className="border p-2">{h}</th>)}</tr></thead><tbody>
        {report.machinery.rows.map((r,i)=><tr key={r.machineId}><td className="border p-2 text-center">{i+1}</td><td className="border p-2 font-semibold">{r.name}</td><td className="border p-2 text-right">{number(r.currentDiesel)}</td><td className="border p-2 text-right">{number(r.previousDiesel)}</td><td className="border p-2 text-right">{number(r.totalDiesel)}</td><td className="border p-2 text-right">{number(r.currentHour)}</td><td className="border p-2 text-right">{number(r.previousHour)}</td><td className="border p-2 text-right">{number(r.totalHour)}</td><td className="border p-2 text-right">{number(r.avg)}</td><td className="border p-2"></td></tr>)}
        </tbody></table></div>
        {report.machinery.dieselTank && <div className="overflow-x-auto mt-3"><table className="w-full border-collapse text-sm"><thead><tr className="bg-secondary"><th className="border p-2">Diesel Tank</th>{['Received','Previous','Total','Issue','P.Issue','Total','Balance'].map((h)=><th key={h} className="border p-2">{h}</th>)}</tr></thead><tbody><tr><td className="border p-2"></td>{[report.machinery.dieselTank.received,report.machinery.dieselTank.previousReceived,report.machinery.dieselTank.totalReceived,report.machinery.dieselTank.issue,report.machinery.dieselTank.pIssue,report.machinery.dieselTank.totalIssue,report.machinery.dieselTank.balance].map((v,i)=><td key={i} className="border p-2 text-right">{number(v)}</td>)}</tr></tbody></table></div>}
      </section>
      <section><h3 className="text-center font-bold uppercase mb-2">Material Report</h3><table className="w-full border-collapse text-sm"><thead><tr className="bg-primary text-primary-foreground">{['Sr','Material','Current','Previous','Total'].map((h)=><th key={h} className="border p-2">{h}</th>)}</tr></thead><tbody>{report.material.rows.map((r,i)=><tr key={r.itemId}><td className="border p-2 text-center">{i+1}</td><td className="border p-2 font-semibold">{r.name}</td><td className="border p-2 text-right">{number(r.current)}</td><td className="border p-2 text-right">{number(r.previous)}</td><td className="border p-2 text-right">{number(r.total)}</td></tr>)}</tbody></table></section>
    </div>}
  </Layout>;
}
