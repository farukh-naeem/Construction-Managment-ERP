import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { listMachines, createMachineEntriesBulk, type ApiMachineWithTotals } from "@/services/machinesService";
import { useDieselItem } from "@/hooks/useDieselItem";
import { todayPKT } from "@/lib/pktDate";
import { toast } from "sonner";

type Row = { hours: string; diesel: string; usedBy: string; remarks: string };
const blank = (): Row => ({ hours: "", diesel: "", usedBy: "", remarks: "" });

export function BulkMachineEntryDialog({ open, onOpenChange, projectId, onSuccess }: {
  open: boolean; onOpenChange: (open: boolean) => void; projectId: string | null; onSuccess: () => void;
}) {
  const [date, setDate] = useState(todayPKT());
  const [machines, setMachines] = useState<ApiMachineWithTotals[]>([]);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const { dieselItem } = useDieselItem(open ? projectId : null);
  useEffect(() => {
    if (!open || !projectId) return;
    listMachines({ projectId, page: 1, pageSize: 100 }).then(({ items }) => {
      setMachines(items); setRows(Object.fromEntries(items.map((m) => [m.id, blank()]))); setErrors({});
    }).catch((e) => toast.error(e instanceof Error ? e.message : "Failed to load machines"));
  }, [open, projectId]);
  const totalDiesel = useMemo(() => machines.reduce((sum, m) => sum + (Number(rows[m.id]?.diesel) || 0), 0), [machines, rows]);
  const change = (id: string, key: keyof Row, value: string) => setRows((current) => ({ ...current, [id]: { ...(current[id] ?? blank()), [key]: value } }));
  const submit = async () => {
    if (!projectId || !date) return toast.error("Project and date are required");
    const clientErrors: Record<number, string> = {};
    machines.forEach((m, index) => {
      const row = rows[m.id] ?? blank();
      const hours = Number(row.hours); const diesel = Number(row.diesel);
      if ((diesel > 0 || row.usedBy.trim() || row.remarks.trim()) && !(hours > 0)) clientErrors[index] = "Hours must be greater than 0 for a filled row";
      else if (row.hours !== "" && (!Number.isFinite(hours) || hours <= 0)) clientErrors[index] = "Hours must be greater than 0";
      else if (row.diesel !== "" && (!Number.isFinite(diesel) || diesel < 0)) clientErrors[index] = "Diesel must be at least 0";
    });
    if (Object.keys(clientErrors).length) { setErrors(clientErrors); toast.error(`Fix ${Object.keys(clientErrors).length} rows`); return; }
    const submittedIndexes: number[] = [];
    const entries = machines.flatMap((m, index) => {
      const row = rows[m.id] ?? blank(); const hours = Number(row.hours);
      if (hours > 0) submittedIndexes.push(index);
      return hours > 0 ? [{ machineId: m.id, hoursWorked: hours, dieselLitres: Number(row.diesel) || undefined,
        usedBy: row.usedBy.trim() || undefined, remarks: row.remarks.trim() || undefined }] : [];
    });
    if (!entries.length) return toast.error("Enter hours for at least one machine");
    if (dieselItem && totalDiesel > dieselItem.currentStock) return toast.error(`Batch diesel (${totalDiesel} L) exceeds available stock (${dieselItem.currentStock} L)`);
    setSubmitting(true); setErrors({});
    try { const result = await createMachineEntriesBulk({ projectId, date, entries }); toast.success(`${result.created} machine entries added`); onSuccess(); onOpenChange(false); }
    catch (err) {
      const data = (err as Error & { data?: { rows?: { rowIndex: number; message: string }[] } }).data;
      if (data?.rows) setErrors(Object.fromEntries(data.rows.map((r) => [submittedIndexes[r.rowIndex] ?? r.rowIndex, r.message])));
      toast.error(data?.rows ? `Fix ${data.rows.length} rows` : err instanceof Error ? err.message : "Bulk entry failed");
    } finally { setSubmitting(false); }
  };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-[96vw] max-h-[90vh] overflow-hidden flex flex-col">
    <DialogHeader><DialogTitle>Bulk Machinery Entry</DialogTitle></DialogHeader>
    <div className="flex items-end gap-6"><div><Label>Date</Label><Input className="mt-1 w-44" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
      {dieselItem && <p className={totalDiesel > dieselItem.currentStock ? "text-destructive font-semibold" : "text-muted-foreground"}>Diesel: {totalDiesel} / {dieselItem.currentStock} L available</p>}</div>
    <div className="overflow-auto border-2 border-border flex-1"><table className="w-full min-w-[900px] text-sm"><thead className="sticky top-0 bg-primary text-primary-foreground"><tr>
      {['Machine','Rate/hr','Hours','Diesel (L)','Used By','Remarks'].filter((h) => dieselItem || h !== 'Diesel (L)').map((h) => <th key={h} className="p-2 text-left">{h}</th>)}</tr></thead><tbody>
      {machines.map((m, index) => { const r = rows[m.id] ?? blank(); return <tr key={m.id} className={`border-b ${errors[index] ? 'bg-destructive/10' : ''}`}>
        <td className="p-2 font-semibold sticky left-0 bg-background">{m.name}{errors[index] && <div className="text-xs text-destructive">{errors[index]}</div>}</td><td className="p-2">{m.hourlyRate}</td>
        <td className="p-2"><Input type="number" min="0" step="any" value={r.hours} onChange={(e) => change(m.id,'hours',e.target.value)} /></td>
        {dieselItem && <td className="p-2"><Input type="number" min="0" step="any" value={r.diesel} onChange={(e) => change(m.id,'diesel',e.target.value)} /></td>}
        <td className="p-2"><Input value={r.usedBy} onChange={(e) => change(m.id,'usedBy',e.target.value)} /></td><td className="p-2"><Input value={r.remarks} onChange={(e) => change(m.id,'remarks',e.target.value)} /></td>
      </tr>; })}</tbody></table></div>
    <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="warning" disabled={submitting} onClick={submit}>{submitting ? "Saving…" : "Save Entries"}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
