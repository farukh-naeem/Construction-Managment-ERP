import { useState, useMemo } from "react";
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
import { Combobox } from "@/components/ui/combobox";
import { createBankTransaction } from "@/services/bankTransactionService";
import type { ApiBankAccount } from "@/services/bankAccountService";
import type { ApiProject } from "@/services/projectsService";
import { toast } from "sonner";

interface AddBankTransactionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: ApiBankAccount[];
  projects: ApiProject[];
  onSuccess?: () => void;
}

type DestinationType = "general" | "project";

export function AddBankTransactionDialog({
  open,
  onOpenChange,
  accounts,
  projects,
  onSuccess,
}: AddBankTransactionDialogProps) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [type, setType] = useState<"inflow" | "outflow">("inflow");
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [source, setSource] = useState("");
  const [destinationType, setDestinationType] = useState<DestinationType>("general");
  const [destinationText, setDestinationText] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [mode, setMode] = useState<"Cash" | "Bank" | "Online">("Bank");
  const [referenceId, setReferenceId] = useState("");
  const [remarks, setRemarks] = useState("");
  const [loading, setLoading] = useState(false);

  const accountOptions = useMemo(
    () => accounts.map((a) => ({ value: a.id, label: `${a.name} (${a.accountNumber || "—"})` })),
    [accounts]
  );

  const projectOptions = useMemo(
    () => projects.map((p) => ({ value: p.id, label: p.name })),
    [projects]
  );

  const selectedAccount = accounts.find((a) => a.id === accountId);
  const selectedProject = projects.find((p) => p.id === projectId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(amount);
    if (!date?.trim()) {
      toast.error("Date is required");
      return;
    }
    if (isNaN(amt) || amt <= 0) {
      toast.error("Valid amount is required");
      return;
    }
    if (!accountId) {
      toast.error("Bank account is required");
      return;
    }
    if (type === "inflow" && !source.trim()) {
      toast.error("Source is required");
      return;
    }

    let sourcePayload: string;
    let destination = "";
    let projectIdPayload: string | undefined;

    if (type === "inflow") {
      sourcePayload = source.trim();
      destination = selectedAccount?.name ?? "";
    } else {
      sourcePayload = selectedAccount?.name ?? "";
      if (destinationType === "project") {
        if (!projectId) {
          toast.error("Select a project as destination");
          return;
        }
        destination = selectedProject?.name ?? "";
        projectIdPayload = projectId;
      } else {
        destination = destinationText.trim();
        if (!destination) {
          toast.error("Destination is required (general expense or project)");
          return;
        }
      }
    }

    setLoading(true);
    try {
      await createBankTransaction({
        accountId,
        date: date.trim(),
        type,
        amount: amt,
        source: sourcePayload,
        destination,
        projectId: projectIdPayload,
        mode,
        referenceId: referenceId.trim() || undefined,
        remarks: remarks.trim() || undefined,
      });
      toast.success("Transaction recorded");
      onOpenChange(false);
      setAmount("");
      setSource("");
      setDestinationText("");
      setProjectId(null);
      setReferenceId("");
      setRemarks("");
      onSuccess?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to record transaction");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-2xl p-4 sm:p-6">
        <DialogHeader className="pb-2">
          <DialogTitle>Add Transaction</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Date *</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-0.5 h-9" />
            </div>
            <div>
              <Label className="text-xs">Type *</Label>
              <Select value={type} onValueChange={(v: "inflow" | "outflow") => setType(v)}>
                <SelectTrigger className="mt-0.5 h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="inflow">Inflow</SelectItem>
                  <SelectItem value="outflow">Outflow</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label className="text-xs">Bank Account *</Label>
            <Combobox
              options={accountOptions}
              value={accountId}
              onValueChange={setAccountId}
              placeholder="Select account"
              searchPlaceholder="Search..."
              emptyText="No account found"
              className="mt-0.5 h-9"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Amount *</Label>
              <Input
                type="number"
                min={0.01}
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="mt-0.5 h-9"
              />
            </div>
            <div>
              <Label className="text-xs">Mode</Label>
              <Select value={mode} onValueChange={(v: "Cash" | "Bank" | "Online") => setMode(v)}>
                <SelectTrigger className="mt-0.5 h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Cash">Cash</SelectItem>
                  <SelectItem value="Bank">Bank</SelectItem>
                  <SelectItem value="Online">Online</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {type === "inflow" ? (
            <div>
              <Label className="text-xs">Source *</Label>
              <Input
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder="e.g. Client Payment"
                className="mt-0.5 h-9"
              />
              <p className="text-[10px] text-muted-foreground mt-0.5">Who paid into the account</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs">Destination</Label>
                <Select
                  value={destinationType}
                  onValueChange={(v: DestinationType) => {
                    setDestinationType(v);
                    if (v === "general") setProjectId(null);
                    else setDestinationText("");
                  }}
                >
                  <SelectTrigger className="mt-0.5 h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="general">General expense</SelectItem>
                    <SelectItem value="project">Project</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {destinationType === "general" ? (
                <div>
                  <Label className="text-xs">Expense/Party *</Label>
                  <Input
                    value={destinationText}
                    onChange={(e) => setDestinationText(e.target.value)}
                    placeholder="e.g. ABC Traders"
                    className="mt-0.5 h-9"
                  />
                </div>
              ) : (
                <div className="sm:col-span-2">
                  <Label className="text-xs">Project *</Label>
                  <Combobox
                    options={projectOptions}
                    value={projectId}
                    onValueChange={setProjectId}
                    placeholder="Select project"
                    searchPlaceholder="Search..."
                    emptyText="No project found"
                    className="mt-0.5 h-9"
                  />
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Reference</Label>
              <Input value={referenceId} onChange={(e) => setReferenceId(e.target.value)} placeholder="Cheque/Ref No" className="mt-0.5 h-9" />
            </div>
            <div>
              <Label className="text-xs">Remarks</Label>
              <Input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional" className="mt-0.5 h-9" />
            </div>
          </div>
          <DialogFooter className="pt-2 gap-2 sm:gap-0">
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={loading}>Cancel</Button>
            <Button type="submit" variant="warning" size="sm" disabled={loading}>{loading ? "Recording..." : "Add Transaction"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
