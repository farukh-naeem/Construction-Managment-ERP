import { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { createCustomerSale } from "@/services/customerSaleService";
import type { ApiConsumableItem } from "@/services/consumableItemsService";
import { createConsumableUnit, listConsumableUnits, type ApiConsumableUnit } from "@/services/consumableUnitService";
import { useCustomers } from "@/hooks/useCustomers";
import { useBankAccounts } from "@/hooks/useBankAccounts";
import { todayPKT } from "@/lib/pktDate";
import { formatCurrency, formatQuantity } from "@/lib/mock-data";

interface SaleRow {
  itemId: string;
  unit: string;
  quantity: string;
  unitPrice: string;
}

interface SellItemsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Currently selected project on the page — project selection is NOT done inside this dialog. */
  projectId: string | null;
  consumableItems: ApiConsumableItem[];
  onSuccess: () => void;
}

const emptyRow = (): SaleRow => ({ itemId: "", unit: "", quantity: "", unitPrice: "" });

export function SellItemsDialog({
  open,
  onOpenChange,
  projectId,
  consumableItems,
  onSuccess,
}: SellItemsDialogProps) {
  const { customers } = useCustomers(projectId);
  const { accounts, loading: accountsLoading } = useBankAccounts();

  const [customerId, setCustomerId] = useState("");
  const [date, setDate] = useState(todayPKT());
  const [remarks, setRemarks] = useState("");
  const [rows, setRows] = useState<SaleRow[]>([emptyRow()]);
  const [units, setUnits] = useState<ApiConsumableUnit[]>([]);
  const [newUnit, setNewUnit] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMode, setPaymentMode] = useState<"Cash" | "Bank" | "Online">("Bank");
  const [accountId, setAccountId] = useState("");
  const [referenceId, setReferenceId] = useState("");
  const [paymentRemarks, setPaymentRemarks] = useState("");
  const [loading, setLoading] = useState(false);

  const resetForm = () => {
    setCustomerId("");
    setDate(todayPKT());
    setRemarks("");
    setRows([emptyRow()]);
    setPaymentAmount("");
    setPaymentMode("Bank");
    setAccountId("");
    setReferenceId("");
    setPaymentRemarks("");
  };

  useEffect(() => {
    if (!open) return;
    resetForm();
    listConsumableUnits().then(setUnits).catch(() => toast.error("Failed to load units"));
  }, [open]);

  const addRow = () => setRows((r) => [...r, emptyRow()]);
  const removeRow = (i: number) => setRows((r) => (r.length === 1 ? [emptyRow()] : r.filter((_, idx) => idx !== i)));

  const updateRow = (i: number, field: keyof SaleRow, value: string) => {
    setRows((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], [field]: value };
      return next;
    });
  };

  const lineTotal = (row: SaleRow) => {
    const qty = parseFloat(row.quantity);
    const price = parseFloat(row.unitPrice);
    if (isNaN(qty) || isNaN(price)) return null;
    return qty * price;
  };

  const saleTotal = useMemo(
    () => rows.reduce((sum, row) => sum + (lineTotal(row) ?? 0), 0),
    [rows]
  );

  const handleCreateUnit = async () => {
    const name = newUnit.trim();
    if (!name) return toast.error("Enter a unit name");
    try {
      const created = await createConsumableUnit({ name });
      setUnits((current) => [...current, created].sort((a, b) => a.name.localeCompare(b.name)));
      setNewUnit("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create unit");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectId) { toast.error("No project selected"); return; }
    if (!customerId) { toast.error("Select a customer"); return; }
    if (!date) { toast.error("Date is required"); return; }

    const items: { itemId: string; quantity: number; unit: string; unitPrice: number }[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      if (!row.itemId) continue;
      const qty = Math.round(parseFloat(row.quantity) * 100) / 100;
      const price = parseFloat(row.unitPrice);
      if (isNaN(qty) || qty <= 0) { toast.error("All quantities must be greater than 0"); return; }
      if (!row.unit.trim()) { toast.error("Select a unit for each item"); return; }
      if (isNaN(price) || price < 0) { toast.error("Unit price must be >= 0"); return; }

      if (seen.has(row.itemId)) {
        const dupName = consumableItems.find((c) => c.id === row.itemId)?.name ?? "This item";
        toast.error(`${dupName} already added. Update the existing row instead of adding a duplicate.`);
        return;
      }
      seen.add(row.itemId);

      const item = consumableItems.find((c) => c.id === row.itemId);
      if (item && qty > item.currentStock) {
        toast.error(`Insufficient stock for "${item.name}": available ${item.currentStock}, requested ${qty}`);
        return;
      }
      items.push({ itemId: row.itemId, quantity: qty, unit: row.unit.trim(), unitPrice: price });
    }

    if (items.length === 0) { toast.error("Add at least one item with quantity"); return; }

    const paid = paymentAmount === "" ? 0 : parseFloat(paymentAmount);
    if (paymentAmount !== "" && (isNaN(paid) || paid <= 0)) {
      toast.error("Payment amount must be greater than 0");
      return;
    }
    if (paid > 0 && !accountId) {
      toast.error("Select a bank account to record this payment");
      return;
    }

    setLoading(true);
    try {
      await createCustomerSale({
        projectId,
        customerId,
        date,
        remarks: remarks || undefined,
        items,
        payment: paid > 0
          ? {
              amount: paid,
              paymentMethod: paymentMode,
              accountId,
              referenceId: paymentMode !== "Cash" ? referenceId || undefined : undefined,
              remarks: paymentRemarks || undefined,
            }
          : undefined,
      });
      toast.success(paid > 0 ? "Sale recorded — payment received into bank" : "Sale recorded — stock updated");
      onSuccess();
      resetForm();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to record sale");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Sell Items</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Customer *</Label>
              <Select value={customerId} onValueChange={setCustomerId}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select customer" /></SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {customers.length === 0 && (
                <p className="text-xs text-muted-foreground mt-1">No customers for this project. Add a customer first.</p>
              )}
            </div>
            <div>
              <Label>Date *</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1" />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Items *</Label>
              <Button type="button" variant="outline" size="sm" onClick={addRow}>
                <Plus className="h-3 w-3 mr-1" /> Add row
              </Button>
            </div>
            <div className="mb-2 flex gap-2">
              <Input value={newUnit} onChange={(e) => setNewUnit(e.target.value)} placeholder="New unit (e.g. bag, kg, cft)" />
              <Button type="button" variant="outline" onClick={handleCreateUnit}>Add unit</Button>
            </div>
            <div className="space-y-2 border border-border p-3 rounded-md">
              {rows.map((row, i) => {
                const selectedItem = consumableItems.find((c) => c.id === row.itemId);
                const available = selectedItem?.currentStock ?? 0;
                const total = lineTotal(row);
                return (
                  <div key={i} className="flex flex-wrap items-end gap-2">
                    <Select
                      value={row.itemId}
                      onValueChange={(v) => {
                        const duplicate = rows.some((r, idx) => idx !== i && r.itemId === v);
                        if (duplicate) {
                          const dupName = consumableItems.find((c) => c.id === v)?.name ?? "This item";
                          toast.error(`${dupName} already added. Update the existing row instead of adding a duplicate.`);
                          return;
                        }
                        updateRow(i, "itemId", v);
                      }}
                    >
                      <SelectTrigger className="w-[145px]">
                        <SelectValue placeholder="Item" />
                      </SelectTrigger>
                      <SelectContent>
                        {consumableItems.map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={row.unit} onValueChange={(v) => updateRow(i, "unit", v)}>
                      <SelectTrigger className="w-[95px]"><SelectValue placeholder="Unit" /></SelectTrigger>
                      <SelectContent>{units.map((u) => <SelectItem key={u.id} value={u.name}>{u.name}</SelectItem>)}</SelectContent>
                    </Select>
                    <Input
                      type="number"
                      min={0.01}
                      step="0.01"
                      max={selectedItem ? available : undefined}
                      placeholder="Qty"
                      className="w-20"
                      value={row.quantity}
                      onChange={(e) => updateRow(i, "quantity", e.target.value)}
                    />
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      placeholder="Unit price"
                      className="w-28"
                      value={row.unitPrice}
                      onChange={(e) => updateRow(i, "unitPrice", e.target.value)}
                    />
                    <span className="text-xs text-muted-foreground min-w-[64px]">
                      {selectedItem ? `Avail: ${formatQuantity(available)}` : "—"}
                    </span>
                    <span className="text-xs font-mono font-bold min-w-[76px] text-right">
                      {total !== null ? formatCurrency(total) : "—"}
                    </span>
                    <Button type="button" variant="ghost" size="icon" onClick={() => removeRow(i)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                );
              })}
            </div>
            {saleTotal > 0 && (
              <p className="text-sm text-muted-foreground mt-2">
                Sale total: <span className="font-bold">{formatCurrency(saleTotal)} PKR</span>
              </p>
            )}
          </div>

          <div>
            <Label>Remarks</Label>
            <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} className="mt-1" />
          </div>

          <div className="rounded-md border border-border p-3 space-y-3">
            <p className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
              Payment received <span className="font-normal normal-case tracking-normal">(optional)</span>
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Amount</Label>
                <Input
                  type="number"
                  min={0.01}
                  step="0.01"
                  placeholder="0"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Payment Mode</Label>
                <Select value={paymentMode} onValueChange={(v) => setPaymentMode(v as "Cash" | "Bank" | "Online")}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Cash">Cash</SelectItem>
                    <SelectItem value="Bank">Bank</SelectItem>
                    <SelectItem value="Online">Online</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Bank Account {paymentAmount !== "" && <span className="text-destructive">*</span>}</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder={accountsLoading ? "Loading accounts…" : "Select account"} />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>{account.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                Required when an amount is entered — the payment is recorded as an inflow into this account.
              </p>
            </div>
            {(paymentMode === "Bank" || paymentMode === "Online") && (
              <div>
                <Label>Reference / Cheque ID</Label>
                <Input value={referenceId} onChange={(e) => setReferenceId(e.target.value)} placeholder="Cheque or TXN ID" className="mt-1" />
              </div>
            )}
            <div>
              <Label>Payment Remarks</Label>
              <Input value={paymentRemarks} onChange={(e) => setPaymentRemarks(e.target.value)} className="mt-1" />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" variant="warning" disabled={loading}>
              {loading ? "Saving…" : "Record Sale"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
