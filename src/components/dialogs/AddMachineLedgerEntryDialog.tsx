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
import { Textarea } from "@/components/ui/textarea";
import { createMachineEntry } from "@/services/machinesService";
import { toast } from "sonner";
import type { ApiMachineWithTotals } from "@/services/machinesService";
import { todayPKT } from "@/lib/pktDate";
import type { ApiConsumableItem } from "@/services/consumableItemsService";

interface AddMachineLedgerEntryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  machine: ApiMachineWithTotals | null;
  dieselItem?: ApiConsumableItem | null;
  onSuccess?: () => void;
}

export function AddMachineLedgerEntryDialog({
  open,
  onOpenChange,
  machine,
  dieselItem,
  onSuccess,
}: AddMachineLedgerEntryDialogProps) {
  const [date, setDate] = useState(todayPKT());
  const [hoursWorked, setHoursWorked] = useState("");
  const [dieselLitres, setDieselLitres] = useState("");
  const [usedBy, setUsedBy] = useState("");
  const [remarks, setRemarks] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!machine) return;
    const hours = parseFloat(hoursWorked);
    if (!date || isNaN(hours) || hours <= 0) {
      toast.error("Date and hours worked are required");
      return;
    }
    const litres = dieselLitres === "" ? 0 : Number(dieselLitres);
    if (!Number.isFinite(litres) || litres < 0) { toast.error("Diesel litres must be a non-negative number"); return; }
    if (dieselItem && litres > dieselItem.currentStock) { toast.error(`Only ${dieselItem.currentStock} L diesel is available`); return; }
    setSubmitting(true);
    try {
      await createMachineEntry(machine.id, {
        date,
        hoursWorked: hours,
        dieselLitres: litres > 0 ? litres : undefined,
        usedBy: usedBy.trim() || undefined,
        remarks: remarks.trim() || undefined,
      });
      toast.success("Ledger entry added");
      setHoursWorked("");
      setDieselLitres("");
      setUsedBy("");
      setRemarks("");
      onSuccess?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add ledger entry");
    } finally {
      setSubmitting(false);
    }
  };

  if (!machine) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Ledger Entry — {machine.name}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">Hourly rate: {machine.hourlyRate} PKR. Total cost will be calculated from hours × rate. Record payments separately via &quot;Add Payment&quot;.</p>
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div>
            <Label>Date *</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Hours Worked *</Label>
            <Input type="number" min={0.5} step={0.5} value={hoursWorked} onChange={(e) => setHoursWorked(e.target.value)} className="mt-1" />
          </div>
          {dieselItem && <div>
            <Label>Diesel (litres)</Label>
            <Input type="number" min={0} step="any" value={dieselLitres} onChange={(e) => setDieselLitres(e.target.value)} className="mt-1" />
            <p className="mt-1 text-xs text-muted-foreground">Available: {dieselItem.currentStock} L</p>
          </div>}
          <div>
            <Label>Used By</Label>
            <Input value={usedBy} onChange={(e) => setUsedBy(e.target.value)} placeholder="Person or site" className="mt-1" />
          </div>
          <div>
            <Label>Remarks</Label>
            <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} className="mt-1" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" variant="warning" disabled={submitting}>{submitting ? "Adding…" : "Add Entry"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
