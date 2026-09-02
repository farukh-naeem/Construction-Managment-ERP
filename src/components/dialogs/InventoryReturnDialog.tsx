import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useCustomers } from "@/hooks/useCustomers";
import { useVendors } from "@/hooks/useVendors";
import { useBankAccounts } from "@/hooks/useBankAccounts";
import { createInventoryReturn, type InventoryReturnType } from "@/services/inventoryReturnService";
import type { ApiConsumableItem } from "@/services/consumableItemsService";
import { todayPKT } from "@/lib/pktDate";
import { formatCurrency } from "@/lib/mock-data";

type Row = { itemId: string; quantity: string; unit: string; unitPrice: string };
const blankRow = (): Row => ({ itemId: "", quantity: "", unit: "", unitPrice: "" });

export function InventoryReturnDialog({ open, onOpenChange, type, projectId, items, onSuccess }: {
  open: boolean; onOpenChange: (open: boolean) => void; type: InventoryReturnType;
  projectId: string | null; items: ApiConsumableItem[]; onSuccess: () => void;
}) {
  const isSaleReturn = type === "sale_return";
  const { customers } = useCustomers(open ? projectId : null);
  const { vendors } = useVendors(open ? projectId : null);
  const { accounts, loading: accountsLoading } = useBankAccounts();
  const parties = isSaleReturn ? customers : vendors;
  const [partyId, setPartyId] = useState("");
  const [date, setDate] = useState(todayPKT());
  const [rows, setRows] = useState<Row[]>([blankRow()]);
  const [accountId, setAccountId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"Cash" | "Bank" | "Online">("Bank");
  const [referenceId, setReferenceId] = useState("");
  const [remarks, setRemarks] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPartyId(""); setDate(todayPKT()); setRows([blankRow()]); setAccountId("");
    setPaymentMethod("Bank"); setReferenceId(""); setRemarks("");
  }, [open, type]);

  const total = useMemo(() => rows.reduce((sum, row) => sum + (Number(row.quantity) || 0) * (Number(row.unitPrice) || 0), 0), [rows]);
  const updateRow = (index: number, field: keyof Row, value: string) => setRows((current) => current.map((row, i) => i === index ? { ...row, [field]: value } : row));
  const removeRow = (index: number) => setRows((current) => current.length === 1 ? [blankRow()] : current.filter((_, i) => i !== index));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!projectId) return toast.error("Select a project");
    if (!partyId) return toast.error(`Select a ${isSaleReturn ? "customer" : "vendor"}`);
    if (!accountId) return toast.error("Select the company bank account for the refund");
    const returnItems: { itemId: string; quantity: number; unit: string; unitPrice: number }[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      if (!row.itemId) continue;
      const quantity = Math.round(Number(row.quantity) * 100) / 100;
      const unitPrice = Number(row.unitPrice);
      if (!Number.isFinite(quantity) || quantity <= 0) return toast.error("Every return quantity must be greater than 0");
      if (!row.unit.trim()) return toast.error("Enter the unit for every returned item");
      if (!Number.isFinite(unitPrice) || unitPrice < 0) return toast.error("Every unit price must be at least 0");
      if (seen.has(row.itemId)) return toast.error("An item can only be added once");
      seen.add(row.itemId);
      returnItems.push({ itemId: row.itemId, quantity, unit: row.unit.trim(), unitPrice });
    }
    if (!returnItems.length) return toast.error("Add at least one returned item");
    setSubmitting(true);
    try {
      await createInventoryReturn({
        projectId, type, date, items: returnItems, accountId, paymentMethod,
        customerId: isSaleReturn ? partyId : undefined, vendorId: isSaleReturn ? undefined : partyId,
        referenceId: paymentMethod === "Cash" ? undefined : referenceId.trim() || undefined,
        remarks: remarks.trim() || undefined,
      });
      toast.success(isSaleReturn ? "Sale return recorded — stock restored and customer refunded" : "Purchase return recorded — stock reduced and vendor refund received");
      onSuccess(); onOpenChange(false);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Failed to record return"); }
    finally { setSubmitting(false); }
  };

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
      <DialogHeader><DialogTitle>{isSaleReturn ? "Sale Return — Customer Refund" : "Purchase Return — Vendor Refund"}</DialogTitle></DialogHeader>
      <p className="text-sm text-muted-foreground">{isSaleReturn
        ? "Returned goods go back into stock. The full return value is paid out from the selected company account."
        : "Goods sent back leave stock. The full return value is received into the selected company account."}</p>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div><Label>{isSaleReturn ? "Customer" : "Vendor"} *</Label><Select value={partyId} onValueChange={setPartyId}><SelectTrigger className="mt-1"><SelectValue placeholder={`Select ${isSaleReturn ? "customer" : "vendor"}`} /></SelectTrigger><SelectContent>{parties.map((party) => <SelectItem key={party.id} value={party.id}>{party.name}</SelectItem>)}</SelectContent></Select></div>
          <div><Label>Date *</Label><Input className="mt-1" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        </div>
        <div className="flex items-center justify-between"><Label>Returned items *</Label><Button type="button" size="sm" variant="outline" onClick={() => setRows((current) => [...current, blankRow()])}><Plus className="h-4 w-4 mr-1" /> Add row</Button></div>
        <div className="space-y-2">
          {rows.map((row, index) => <div key={index} className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-2 items-end border p-3">
            <div><Label>Item</Label><Select value={row.itemId} onValueChange={(value) => { updateRow(index, "itemId", value); const item = items.find((candidate) => candidate.id === value); if (item?.unit) updateRow(index, "unit", item.unit); }}><SelectTrigger className="mt-1"><SelectValue placeholder="Select item" /></SelectTrigger><SelectContent>{items.map((item) => <SelectItem key={item.id} value={item.id}>{item.name} ({item.currentStock} in stock)</SelectItem>)}</SelectContent></Select></div>
            <div><Label>Quantity</Label><Input className="mt-1" type="number" min="0.01" step="0.01" value={row.quantity} onChange={(e) => updateRow(index, "quantity", e.target.value)} /></div>
            <div><Label>Unit</Label><Input className="mt-1" value={row.unit} onChange={(e) => updateRow(index, "unit", e.target.value)} placeholder="e.g. bag" /></div>
            <div><Label>Unit price</Label><Input className="mt-1" type="number" min="0" step="0.01" value={row.unitPrice} onChange={(e) => updateRow(index, "unitPrice", e.target.value)} /></div>
            <Button type="button" variant="ghost" size="icon" onClick={() => removeRow(index)} aria-label="Remove row"><Trash2 className="h-4 w-4 text-destructive" /></Button>
          </div>)}
        </div>
        <div className="rounded border bg-muted/30 p-3 text-right font-bold">Refund total: {formatCurrency(total)}</div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Company bank account *</Label><Select value={accountId} onValueChange={setAccountId}><SelectTrigger className="mt-1"><SelectValue placeholder={accountsLoading ? "Loading accounts…" : "Select account"} /></SelectTrigger><SelectContent>{accounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.name}</SelectItem>)}</SelectContent></Select>{!accountsLoading && !accounts.length && <p className="text-xs text-destructive mt-1">Add a company bank account first.</p>}</div>
          <div><Label>Payment mode</Label><Select value={paymentMethod} onValueChange={(value) => setPaymentMethod(value as typeof paymentMethod)}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Cash">Cash</SelectItem><SelectItem value="Bank">Bank</SelectItem><SelectItem value="Online">Online</SelectItem></SelectContent></Select></div>
        </div>
        {paymentMethod !== "Cash" && <div><Label>Reference / Cheque ID</Label><Input className="mt-1" value={referenceId} onChange={(e) => setReferenceId(e.target.value)} /></div>}
        <div><Label>Remarks</Label><Textarea className="mt-1" value={remarks} onChange={(e) => setRemarks(e.target.value)} /></div>
        <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" variant="warning" disabled={submitting || accounts.length === 0}>{submitting ? "Recording…" : `Record ${isSaleReturn ? "Sale" : "Purchase"} Return`}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
