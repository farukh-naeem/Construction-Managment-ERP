import { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Printer } from "lucide-react";
import { formatCurrency } from "@/lib/mock-data";
import {
  getCashExpensesEntityLedger,
  type CashExpensesEntityType,
  type CashExpensesEntityLedger,
} from "@/services/cashExpensesReportService";

const ENTITY_TYPE_LABELS: Record<CashExpensesEntityType, string> = {
  Consumable: "Consumable",
  NonConsumable: "Non-Consumable",
  Vendor: "Vendor",
  Contractor: "Contractor",
  Salary: "Salary",
  Expense: "Expense",
  Machinery: "Machinery",
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  entityType: CashExpensesEntityType;
  entityId: string;
  entityName: string;
  startDate: string;
  endDate: string;
}

export function CashExpensesLedgerDialog({
  open,
  onOpenChange,
  projectId,
  entityType,
  entityId,
  entityName,
  startDate,
  endDate,
}: Props) {
  const [ledger, setLedger] = useState<CashExpensesEntityLedger | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLedger(null);
    setError(null);
    setLoading(true);
    getCashExpensesEntityLedger(projectId, entityType, entityId, startDate, endDate)
      .then(setLedger)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load ledger"))
      .finally(() => setLoading(false));
  }, [open, projectId, entityType, entityId, startDate, endDate]);

  const runningTotals = useMemo(() => {
    if (!ledger) return [];
    let acc = ledger.previousAmount;
    return ledger.entries.map((e) => { acc += e.amount; return acc; });
  }, [ledger]);

  const showNameCol = entityType === "Salary";
  const periodLabel = startDate === endDate ? startDate : `${startDate} to ${endDate}`;

  const handlePrint = () => {
    if (!ledger) return;
    const content = document.getElementById("ledger-print-content");
    if (!content) return;
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    const docTitle = `${entityName} — ${ENTITY_TYPE_LABELS[entityType]} — ${periodLabel}`;
    const html = `<!DOCTYPE html>
<html>
<head>
  <title>${docTitle}</title>
  <style>
    body { font-family: Arial, Helvetica, sans-serif; padding: 20px; color: #000; }
    .print-title { display: block !important; font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; text-align: center; margin-bottom: 4px; }
    .print-period { display: block !important; font-size: 11px; text-align: center; margin-bottom: 12px; color: #444; }
    .print-previous { font-size: 11px; font-weight: 600; padding: 6px 0 10px; border-bottom: 1px solid #000; margin-bottom: 6px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th, td { border: 1px solid #000; padding: 6px 10px; text-align: left; font-size: 11px; }
    th { background-color: #000; color: #fff; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; }
    th.num, td.num { text-align: right; }
    tr:nth-child(even) { background-color: #f5f5f5; }
    .total-row td { font-weight: bold; background-color: #e8e8e8 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>${content.innerHTML}</body>
</html>`;
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.print();
  };

  const thCls = "px-3 py-2 text-left text-xs font-bold uppercase tracking-wider border-b border-border bg-muted/40";
  const thNumCls = `${thCls} text-right`;
  const tdCls = "px-3 py-2.5 text-sm border-b border-border/60";
  const tdNumCls = `${tdCls} text-right font-mono`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-start justify-between gap-2">
            <div>
              <DialogTitle>
                {entityName} — {ENTITY_TYPE_LABELS[entityType]}
              </DialogTitle>
              <DialogDescription>{periodLabel}</DialogDescription>
            </div>
            {ledger && (
              <Button variant="outline" size="sm" onClick={handlePrint} className="shrink-0 mt-0.5">
                <Printer className="h-4 w-4 mr-1" />
                Print
              </Button>
            )}
          </div>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 py-8 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : error ? (
          <p className="text-destructive py-4">{error}</p>
        ) : ledger ? (
          <div className="flex flex-col gap-2 overflow-hidden">
            <div className="overflow-auto flex-1">
              <div id="ledger-print-content">
                <div className="print-title hidden">{entityName} — {ENTITY_TYPE_LABELS[entityType]}</div>
                <div className="print-period hidden">{periodLabel}</div>
                <div className="print-previous text-sm font-medium px-1 mb-2">
                  Previous (before {startDate}):{" "}
                  <span className="font-mono font-bold">{formatCurrency(ledger.previousAmount)}</span>
                </div>
                <table className="w-full border-collapse text-base">
                  <thead>
                    <tr>
                      <th className={thCls}>Date</th>
                      {showNameCol && <th className={thCls}>Employee</th>}
                      <th className={thCls}>Remarks</th>
                      <th className={thNumCls + " num"}>Amount</th>
                      <th className={thNumCls + " num"}>Running Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.entries.length === 0 ? (
                      <tr>
                        <td
                          colSpan={showNameCol ? 5 : 4}
                          className="px-3 py-8 text-center text-muted-foreground text-sm"
                        >
                          No payments in this period.
                        </td>
                      </tr>
                    ) : (
                      ledger.entries.map((entry, i) => (
                        <tr key={entry.id} className="hover:bg-accent/40 transition-colors">
                          <td className={`${tdCls} text-muted-foreground`}>{entry.date}</td>
                          {showNameCol && <td className={`${tdCls} font-medium`}>{entry.name}</td>}
                          <td className={`${tdCls} text-muted-foreground max-w-[200px] truncate`} title={entry.remarks || undefined}>
                            {entry.remarks || "-"}
                          </td>
                          <td className={tdNumCls + " num"}>{formatCurrency(entry.amount)}</td>
                          <td className={`${tdNumCls} num font-bold`}>{formatCurrency(runningTotals[i])}</td>
                        </tr>
                      ))
                    )}
                    <tr className="total-row font-bold bg-muted/20">
                      <td colSpan={showNameCol ? 3 : 2} className={`${tdCls} border-t-2 border-border`}>
                        Total (in range)
                      </td>
                      <td className={`${tdNumCls} num border-t-2 border-border`}>{formatCurrency(ledger.currentTotal)}</td>
                      <td className={`${tdNumCls} num border-t-2 border-border`}>
                        {formatCurrency(ledger.previousAmount + ledger.currentTotal)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
