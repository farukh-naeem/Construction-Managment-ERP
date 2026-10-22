import { useState } from "react";
import { Link } from "react-router-dom";
import { Pencil, Trash2 } from "lucide-react";
import Layout from "@/components/Layout";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { useBorrowers } from "@/hooks/useBorrowers";
import { useAuth } from "@/context/AuthContext";
import { createBorrower, updateBorrower, deleteBorrower, type ApiBorrower } from "@/services/borrowersService";
import { formatCurrency } from "@/lib/mock-data";
import { toast } from "sonner";

export default function Borrowers() {
  const { user } = useAuth();
  const [archived, setArchived] = useState(false);
  const { borrowers, loading, error, refetch } = useBorrowers(archived);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<ApiBorrower>();
  const [editName, setEditName] = useState("");
  const [deleting, setDeleting] = useState<ApiBorrower>();
  const [saving, setSaving] = useState(false);
  const create = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true);
    try { await createBorrower(name); setName(""); await refetch(); toast.success("Borrower saved"); }
    catch (err) { toast.error(err instanceof Error ? err.message : "Failed to save borrower"); }
    finally { setSaving(false); }
  };
  const edit = async (event: React.FormEvent) => {
    event.preventDefault(); if (!editing) return; setSaving(true);
    try { await updateBorrower(editing.id, editName); setEditing(undefined); await refetch(); toast.success("Borrower updated"); }
    catch (err) { toast.error(err instanceof Error ? err.message : "Failed to update borrower"); }
    finally { setSaving(false); }
  };
  const remove = async () => {
    if (!deleting) return; setSaving(true);
    try { await deleteBorrower(deleting.id); setDeleting(undefined); await refetch(); toast.success("Borrower removed from active list"); }
    catch (err) { toast.error(err instanceof Error ? err.message : "Failed to delete borrower"); }
    finally { setSaving(false); }
  };
  return <Layout>
    <PageHeader title="Borrowers" subtitle="Payments given and received, with the current balance across all banks" />
    <div className="flex flex-wrap items-center gap-3 mb-6">
      {!archived && <form onSubmit={create} className="flex gap-2 max-w-md"><Input aria-label="Borrower name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Borrower name" required /><Button variant="warning" disabled={saving}>{saving ? "Saving…" : "Add Borrower"}</Button></form>}
      <Button variant="outline" onClick={() => setArchived(!archived)}>{archived ? "Show active borrowers" : "Show archived borrowers"}</Button>
    </div>
    {error ? <p className="text-destructive">{error}</p> : loading ? <p className="text-muted-foreground">Loading borrowers…</p> : <div className="rounded-xl border bg-card overflow-x-auto">
      <table className="w-full text-sm"><thead><tr className="border-b bg-muted/10"><th className="p-3 text-left">Name</th><th className="p-3 text-right">Payments Given</th><th className="p-3 text-right">Payments Received</th><th className="p-3 text-right">Current Balance</th><th className="p-3 text-right">Actions</th></tr></thead>
        <tbody>{borrowers.length ? borrowers.map((b) => <tr key={b.id} className="border-b hover:bg-muted/30">
          <td className="p-3"><Link to={`/borrowers/${b.id}/ledger`} className="font-medium text-primary hover:underline">{b.name}</Link></td>
          <td className="p-3 text-right font-mono">{formatCurrency(b.totalLoaned)}</td><td className="p-3 text-right font-mono">{formatCurrency(b.totalRepaid)}</td><td className="p-3 text-right font-mono">{formatCurrency(b.outstanding)}</td>
          <td className="p-3"><div className="flex justify-end gap-1"><Button variant="ghost" size="icon" aria-label={`Edit ${b.name}`} onClick={() => { setEditing(b); setEditName(b.name); }}><Pencil className="h-4 w-4" /></Button>
            {!archived && user?.role === "Super Admin" && <Button variant="ghost" size="icon" className="text-destructive" aria-label={`Delete ${b.name}`} disabled={b.outstanding !== 0} title={b.outstanding !== 0 ? "Account balance is not settled" : "Delete borrower"} onClick={() => setDeleting(b)}><Trash2 className="h-4 w-4" /></Button>}
            <Link to={`/borrowers/${b.id}/ledger`} className="self-center text-primary hover:underline">View ledger</Link></div></td>
        </tr>) : <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No {archived ? "archived " : ""}borrowers yet</td></tr>}</tbody>
      </table>
    </div>}
    <Dialog open={!!editing} onOpenChange={(open) => !open && !saving && setEditing(undefined)}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>Edit Borrower</DialogTitle></DialogHeader>
      <form onSubmit={edit} className="space-y-4"><Input aria-label="Borrower name" value={editName} onChange={(e) => setEditName(e.target.value)} required /><DialogFooter><Button type="button" variant="outline" disabled={saving} onClick={() => setEditing(undefined)}>Cancel</Button><Button variant="warning" disabled={saving}>Save changes</Button></DialogFooter></form>
    </DialogContent></Dialog>
    <AlertDialog open={!!deleting} onOpenChange={(open) => !open && !saving && setDeleting(undefined)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete borrower?</AlertDialogTitle><AlertDialogDescription>{deleting?.name} can only be removed when the current balance is zero. Borrowers with payment history will be archived, preserving all financial entries.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel><AlertDialogAction disabled={saving} onClick={(e) => { e.preventDefault(); void remove(); }}>Delete</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </Layout>;
}
