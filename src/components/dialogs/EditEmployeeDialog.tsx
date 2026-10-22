import { useState, useEffect } from "react";
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
import { updateEmployee, type ApiEmployee, type UpdateEmployeeInput } from "@/services/employeesService";
import { toast } from "sonner";

interface EditEmployeeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: ApiEmployee | null;
  onSuccess?: () => void;
}

export function EditEmployeeDialog({
  open,
  onOpenChange,
  employee,
  onSuccess,
}: EditEmployeeDialogProps) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [type, setType] = useState<"Fixed" | "Daily">("Fixed");
  const [monthlySalary, setMonthlySalary] = useState("");
  const [dailyRate, setDailyRate] = useState("");
  const [phone, setPhone] = useState("");
  const [joiningDate, setJoiningDate] = useState("");
  const [endingDate, setEndingDate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (employee) {
      setName(employee.name);
      setRole(employee.role);
      setType(employee.type);
      setMonthlySalary("");
      setDailyRate(employee.type === "Daily" && employee.dailyRate != null ? String(employee.dailyRate) : "");
      setPhone(employee.phone ?? "");
      setJoiningDate(employee.joiningDate ?? employee.createdAt?.slice(0, 10) ?? "");
      setEndingDate(employee.endingDate ?? "");
    }
  }, [employee, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employee) return;
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    if (!role.trim()) {
      toast.error("Role is required");
      return;
    }
    if (endingDate.trim() && joiningDate.trim() && endingDate.trim() < joiningDate.trim()) {
      toast.error("Ending date cannot be before joining date");
      return;
    }
    setSubmitting(true);
    try {
      const input: UpdateEmployeeInput = {
        name: name.trim(),
        role: role.trim(),
        type,
        phone: phone.trim(),
        joiningDate: joiningDate.trim(),
        endingDate: endingDate.trim(),
      };
      if (type === "Fixed" && employee.type !== "Fixed") {
        const sal = parseFloat(monthlySalary);
        if (isNaN(sal) || sal <= 0) {
          toast.error("Valid monthly salary required");
          setSubmitting(false);
          return;
        }
        input.monthlySalary = sal;
      } else {
        const rate = parseFloat(dailyRate);
        if (isNaN(rate) || rate <= 0) {
          toast.error("Valid daily rate required");
          setSubmitting(false);
          return;
        }
        input.dailyRate = rate;
      }
      await updateEmployee(employee.id, input);
      toast.success("Employee updated");
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update employee");
    } finally {
      setSubmitting(false);
    }
  };

  if (!employee) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Employee</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label>Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Employee name" className="mt-1" />
          </div>
          <div>
            <Label>Role *</Label>
            <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Foreman, Mason" className="mt-1" />
          </div>
          <div>
            <Label>Type *</Label>
            <Select value={type} onValueChange={(v) => setType(v as "Fixed" | "Daily")}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Fixed">Fixed Monthly Salary</SelectItem>
                <SelectItem value="Daily">Daily Wage</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {type === "Fixed" && employee.type !== "Fixed" && (
            <div>
              <Label>Monthly Salary *</Label>
              <Input type="number" min={1} value={monthlySalary} onChange={(e) => setMonthlySalary(e.target.value)} className="mt-1" />
            </div>
          )}
          {type === "Fixed" && employee.type === "Fixed" && (
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              Fixed salary changes are recorded separately with an effective month. Use the Change Salary action on the employee ledger.
            </div>
          )}
          {type === "Daily" && (
            <div>
              <Label>Daily Rate (8 hrs = 1 day) *</Label>
              <Input type="number" min={1} value={dailyRate} onChange={(e) => setDailyRate(e.target.value)} className="mt-1" />
            </div>
          )}
          <div>
            <Label>Phone</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+92 ..." className="mt-1" />
          </div>
          <div>
            <Label>Joining Date</Label>
            <Input type="date" value={joiningDate} onChange={(e) => setJoiningDate(e.target.value)} className="mt-1" />
            <p className="mt-1 text-xs text-muted-foreground">
              The date the employee actually started. Salary/attendance data before this month will show "No Data".
            </p>
          </div>
          <div>
            <Label>Ending Date</Label>
            <Input type="date" value={endingDate} onChange={(e) => setEndingDate(e.target.value)} className="mt-1" />
            <p className="mt-1 text-xs text-muted-foreground">
              {type === "Fixed"
                ? "The date the employee left. Salary is prorated up to this date, and no salary or liability is generated after it."
                : "The date the employee left. Wages still depend on marked attendance, but this records that they're no longer with the company."}
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" variant="warning" disabled={submitting}>
              {submitting ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
