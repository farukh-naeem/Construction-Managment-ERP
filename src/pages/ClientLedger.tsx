import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
import Layout from "@/components/Layout";
import PageHeader from "@/components/PageHeader";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getClientLedger, type ClientLedgerResult } from "@/services/clientsService";
import { updateBankTransaction, deleteBankTransaction } from "@/services/bankTransactionService";
import { useProjects } from "@/hooks/useProjects";
import { formatCurrency } from "@/lib/mock-data";
import { formatDisplayDate } from "@/lib/pktDate";
import { toast } from "sonner";

type LedgerPayment = ClientLedgerResult["rows"][number];
const NO_PROJECT = "__none__";

export default function ClientLedger() {
  const { clientId } = useParams<{ clientId: string }>();
  const { projects } = useProjects();
  const [projectId, setProjectId] = useState("all");
  const [ledger, setLedger] = useState<ClientLedgerResult>();
  const [error, setError] = useState<string>();
  const [refreshKey, setRefreshKey] = useState(0);
  const [editing, setEditing] = useState<LedgerPayment | null>(null);
  const [date, setDate] = useState(""); const [amount, setAmount] = useState(""); const [editProjectId, setEditProjectId] = useState(NO_PROJECT); const [referenceId, setReferenceId] = useState(""); const [remarks, setRemarks] = useState(""); const [saving, setSaving] = useState(false);

  useEffect(() => { if (!clientId) return; void getClientLedger(clientId, projectId === "all" ? undefined : projectId).then(setLedger).catch((err) => setError(err instanceof Error ? err.message : "Failed to load ledger")); }, [clientId, projectId, refreshKey]);
  const openEdit = (row: LedgerPayment) => { setEditing(row); setDate(row.date); setAmount(String(row.payment)); setEditProjectId(row.projectId ?? NO_PROJECT); setReferenceId(row.referenceId ?? ""); setRemarks(row.remarks ?? ""); };
  const saveEdit = async (event: React.FormEvent) => { event.preventDefault(); if (!editing) return; const parsedAmount = Number(amount); if (!date || !Number.isFinite(parsedAmount) || parsedAmount <= 0) { toast.error("Enter a valid date and payment amount"); return; } setSaving(true); try { await updateBankTransaction(editing.id, { date, amount: parsedAmount, projectId: editProjectId === NO_PROJECT ? "" : editProjectId, referenceId: referenceId.trim(), remarks: remarks.trim() }); setEditing(null); setRefreshKey((key) => key + 1); toast.success("Client payment updated"); } catch (err) { toast.error(err instanceof Error ? err.message : "Failed to update client payment"); } finally { setSaving(false); } };
  const remove = async (row: LedgerPayment) => { if (!window.confirm(`Delete the ${formatCurrency(row.payment)} payment?`)) return; try { await deleteBankTransaction(row.id); setRefreshKey((key) => key + 1); toast.success("Client payment deleted"); } catch (err) { toast.error(err instanceof Error ? err.message : "Failed to delete client payment"); } };

  return <Layout><Link to="/clients" className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground mb-4"><ArrowLeft className="h-3 w-3" />Back to Clients</Link><PageHeader title={`${ledger?.clientName ?? "Client"} — Ledger`} subtitle="Client payments by project" printTargetId="client-ledger" printOptions={{ printDocumentTitle: `${ledger?.clientName ?? "Client"} Payment Ledger` }} />
    <Select value={projectId} onValueChange={setProjectId}><SelectTrigger className="mb-4 max-w-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All projects</SelectItem>{projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select>
    {error ? <p className="text-destructive">{error}</p> : !ledger ? <p className="text-muted-foreground">Loading ledger…</p> : <div id="client-ledger" className="rounded-xl border bg-card overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b bg-muted/10"><th className="p-3 text-left">Date</th><th className="p-3 text-left">Description</th><th className="p-3 text-right">Payment</th><th className="p-3 text-left">Project</th><th className="p-3 text-left">Bank Account</th><th className="p-3 text-right">Balance</th><th className="p-3 text-right print-hidden">Actions</th></tr></thead><tbody>{ledger.rows.map((row) => <tr className="border-b" key={row.id}><td className="p-3">{formatDisplayDate(row.date)}</td><td className="p-3">{row.description}</td><td className="p-3 text-right">{formatCurrency(row.payment)}</td><td className="p-3">{row.projectName ?? "—"}</td><td className="p-3">{row.accountName}</td><td className="p-3 text-right font-mono">{formatCurrency(row.balance)}</td><td className="p-3 print-hidden"><div className="flex justify-end gap-1"><Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(row)}><Pencil className="h-4 w-4" /></Button><Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => void remove(row)}><Trash2 className="h-4 w-4" /></Button></div></td></tr>)}</tbody></table></div>}
    <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>Edit Client Payment</DialogTitle></DialogHeader><form onSubmit={saveEdit} className="space-y-3"><div><label className="text-xs">Date</label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div><div><label className="text-xs">Payment</label><Input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></div><div><label className="text-xs">Project</label><Select value={editProjectId} onValueChange={setEditProjectId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value={NO_PROJECT}>No project</SelectItem>{projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}</SelectContent></Select></div><div><label className="text-xs">Reference</label><Input value={referenceId} onChange={(e) => setReferenceId(e.target.value)} /></div><div><label className="text-xs">Remarks</label><Input value={remarks} onChange={(e) => setRemarks(e.target.value)} /></div><DialogFooter><Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancel</Button><Button type="submit" variant="warning" disabled={saving}>{saving ? "Saving…" : "Save changes"}</Button></DialogFooter></form></DialogContent></Dialog>
  </Layout>;
}
