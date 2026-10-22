import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changeEmployeeSalary, type ApiEmployee } from "@/services/employeesService";
import { formatCurrency } from "@/lib/mock-data";
import { toast } from "sonner";

interface ChangeEmployeeSalaryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: ApiEmployee | null;
  defaultMonth: string;
  onSuccess?: () => void;
}

export function ChangeEmployeeSalaryDialog({ open, onOpenChange, employee, defaultMonth, onSuccess }: ChangeEmployeeSalaryDialogProps) {
  const [effectiveMonth, setEffectiveMonth] = useState(defaultMonth);
  const [newSalary, setNewSalary] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setEffectiveMonth(defaultMonth);
      setNewSalary("");
    }
  }, [open, defaultMonth]);

  const currentSalary = useMemo(() => {
    if (!employee) return 0;
    const revisions = [...(employee.salaryRevisions ?? [])].sort((a, b) => a.effectiveMonth.localeCompare(b.effectiveMonth));
    const applicable = revisions.filter((revision) => revision.effectiveMonth <= effectiveMonth).at(-1);
    return applicable?.monthlySalary ?? revisions[0]?.monthlySalary ?? employee.monthlySalary ?? 0;
  }, [employee, effectiveMonth]);
  const increment = Number(newSalary) - currentSalary;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!employee) return;
    const salary = Number(newSalary);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(effectiveMonth)) { toast.error("Select a valid effective month"); return; }
    if (!Number.isFinite(salary) || salary <= currentSalary) { toast.error("Enter a salary higher than the salary effective for this month"); return; }
    setSubmitting(true);
    try {
      await changeEmployeeSalary(employee.id, { monthlySalary: salary, effectiveMonth });
      toast.success(`Salary updated from ${effectiveMonth}`);
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to change salary");
    } finally {
      setSubmitting(false);
    }
  };

  if (!employee) return null;
  const joiningMonth = employee.joiningDate?.slice(0, 7);
  const endingMonth = employee.endingDate?.slice(0, 7);
  return <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
    <DialogContent className="max-w-md">
      <DialogHeader><DialogTitle>Change Fixed Salary</DialogTitle></DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-muted-foreground">For {employee.name}. The new salary applies from the selected month onward; earlier months keep their existing salary.</p>
        <div><Label htmlFor="salary-effective-month">Effective month</Label><Input id="salary-effective-month" type="month" min={joiningMonth} max={endingMonth} value={effectiveMonth} onChange={(event) => setEffectiveMonth(event.target.value)} required className="mt-1" /></div>
        <div className="rounded-md border bg-muted/30 p-3 text-sm"><div className="flex justify-between"><span>Salary for this month</span><strong>{formatCurrency(currentSalary)}/mo</strong></div></div>
        <div><Label htmlFor="employee-new-salary">New monthly salary</Label><Input id="employee-new-salary" type="number" min={currentSalary + 0.01} step="0.01" value={newSalary} onChange={(event) => setNewSalary(event.target.value)} required className="mt-1" /><p className="mt-1 text-xs text-muted-foreground">{Number.isFinite(increment) && increment > 0 ? `Increase: ${formatCurrency(increment)} per month` : "Enter the new salary amount, not the increase amount."}</p></div>
        <DialogFooter><Button type="button" variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" variant="warning" disabled={submitting}>{submitting ? "Saving…" : "Save salary change"}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
