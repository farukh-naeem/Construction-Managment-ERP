import { useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { createCustomerPayment } from "@/services/customerPaymentService";
import type { ApiCustomer } from "@/services/customersService";
import { useBankAccounts } from "@/hooks/useBankAccounts";
import { todayPKT } from "@/lib/pktDate";

interface CustomerPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer: ApiCustomer;
  onSuccess: () => void;
}

export function CustomerPaymentDialog({ open, onOpenChange, customer, onSuccess }: CustomerPaymentDialogProps) {
  const { accounts, loading: accountsLoading } = useBankAccounts();
  const [date, setDate] = useState(todayPKT());
  const [amount, setAmount] = useState("");
  const [paymentMode, setPaymentMode] = useState<"Cash" | "Bank" | "Online">("Bank");
  const [accountId, setAccountId] = useState("");
  const [referenceId, setReferenceId] = useState("");
  const [remarks, setRemarks] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(amount);
    if (!date) { toast.error("Date is required"); return; }
    if (isNaN(amt) || amt <= 0) { toast.error("Amount must be positive"); return; }
    if (!accountId) { toast.error("Select a bank account to record this payment"); return; }
    setLoading(true);
    try {
      await createCustomerPayment(customer.id, {
        date,
        amount: amt,
        paymentMethod: paymentMode,
        accountId,
        referenceId: paymentMode !== "Cash" ? referenceId || undefined : undefined,
        remarks: remarks || undefined,
      });
      toast.success("Payment recorded — bank inflow created");
      onSuccess();
      setAmount("");
      setReferenceId("");
      setRemarks("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to record payment");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Record Payment — {customer.name}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Current balance: <span className={`font-bold ${customer.balance < 0 ? "text-destructive" : "text-success"}`}>{formatAmount(customer.balance)} PKR</span>
          {customer.balance < 0 && <span className="text-destructive"> (receivable)</span>}
        </p>
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div>
            <Label>Date *</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Amount *</Label>
            <Input
              type="number"
              min={0.01}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-1"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Money received from the customer. It is recorded as a credit and lands as an inflow in the selected bank account.
            </p>
          </div>
          <div>
            <Label>Payment Mode</Label>
            <Select value={paymentMode} onValueChange={(v) => setPaymentMode(v as "Cash" | "Bank" | "Online")}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Cash">Cash</SelectItem>
                <SelectItem value="Bank">Bank</SelectItem>
                <SelectItem value="Online">Online</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Bank Account *</Label>
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
            {!accountsLoading && accounts.length === 0 && (
              <p className="text-xs text-destructive mt-1">No bank accounts exist. An admin must add one before payments can be tracked.</p>
            )}
          </div>
          {(paymentMode === "Bank" || paymentMode === "Online") && (
            <div>
              <Label>Reference / Cheque ID</Label>
              <Input value={referenceId} onChange={(e) => setReferenceId(e.target.value)} className="mt-1" />
            </div>
          )}
          <div>
            <Label>Remarks</Label>
            <Input value={remarks} onChange={(e) => setRemarks(e.target.value)} className="mt-1" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" variant="warning" disabled={loading}>
              {loading ? "Recording…" : "Record Payment"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function formatAmount(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
