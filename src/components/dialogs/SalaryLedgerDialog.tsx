import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/mock-data";
import { formatDisplayDate } from "@/lib/pktDate";
import type { Employee } from "@/lib/mock-data";

interface SalaryLedgerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: Employee | null;
}

// Prototype: mock ledger entries for display (SRS: month, payable, paid, due, payment date, method)
const MOCK_FIXED_LEDGER = [
  { month: "2025-12", payable: 45000, paid: 45000, due: 0, paymentDate: "2026-01-05", method: "Bank" as const },
  { month: "2026-01", payable: 45000, paid: 40000, due: 5000, paymentDate: "—", method: "—" as const },
  { month: "2026-02", payable: 45000, paid: 0, due: 45000, paymentDate: "—", method: "—" as const },
];

function getLedgerRows(employee: Employee) {
  if (employee.type === "Fixed") return MOCK_FIXED_LEDGER;
  return [
    { month: "Current (daily)", payable: employee.dailyRate ?? 0, paid: employee.totalPaid, due: employee.totalDue, paymentDate: "—", method: "—" as const },
  ];
}

export function SalaryLedgerDialog({ open, onOpenChange, employee }: SalaryLedgerDialogProps) {
  if (!employee) return null;

  const rows = getLedgerRows(employee);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Salary Ledger — {employee.name}</DialogTitle>
          <p className="text-sm text-muted-foreground">
            {employee.type === "Fixed" ? "Fixed monthly salary" : "Daily wage"} · {employee.project}
          </p>
          <p className="text-sm font-medium mt-1">
            Total Paid: {formatCurrency(employee.totalPaid)} · Due: {formatCurrency(employee.totalDue)}
          </p>
        </DialogHeader>
        <div className="overflow-auto border border-border rounded-md">
          <table className="w-full text-sm">
            <thead className="bg-muted sticky top-0">
              <tr>
                <th className="px-4 py-2 text-left font-bold">Month / Period</th>
                <th className="px-4 py-2 text-right font-bold">Payable</th>
                <th className="px-4 py-2 text-right font-bold">Paid</th>
                <th className="px-4 py-2 text-right font-bold">Due</th>
                <th className="px-4 py-2 text-left font-bold">Payment Date</th>
                <th className="px-4 py-2 text-left font-bold">Method</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="px-4 py-2">{row.month}</td>
                  <td className="px-4 py-2 text-right font-mono">{formatCurrency(row.payable)}</td>
                  <td className="px-4 py-2 text-right font-mono text-success">{formatCurrency(row.paid)}</td>
                  <td className="px-4 py-2 text-right font-mono text-destructive">{row.due > 0 ? formatCurrency(row.due) : "—"}</td>
                  <td className="px-4 py-2">{formatDisplayDate(row.paymentDate)}</td>
                  <td className="px-4 py-2">{row.method}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Prototype: sample ledger. Late salary payments and real data will appear when backend is connected.
        </p>
      </DialogContent>
    </Dialog>
  );
}
