import { useState, useMemo, useEffect } from "react";
import Layout from "@/components/Layout";
import PageHeader from "@/components/PageHeader";
import { useAuth } from "@/context/AuthContext";
import { useSelectedProject } from "@/context/SelectedProjectContext";
import { useProjects } from "@/hooks/useProjects";
import { useCashExpensesReport } from "@/hooks/useCashExpensesReport";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import type { CashExpensesEntityType } from "@/services/cashExpensesReportService";
import { CashExpensesLedgerDialog } from "@/components/dialogs/CashExpensesLedgerDialog";

function toTodayISO(): string {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

const ENTITY_TYPE_LABELS: Record<CashExpensesEntityType, string> = {
  Consumable: "Consumable",
  NonConsumable: "Non-Consumable",
  Vendor: "Vendor",
  Contractor: "Contractor",
  Salary: "Salary",
  Expense: "Expense",
  Machinery: "Machinery",
};

const CASH_REPORT_PRINT_CSS = `
  .cash-print-project-name {
    display: block !important;
    text-align: center;
    font-size: 14px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin: 0 0 14px;
    padding-bottom: 10px;
    border-bottom: 2px solid #000;
  }
  .cash-expenses-sheet { font-size: 11px; }
  .cash-expenses-sheet table { margin-top: 0 !important; margin-bottom: 0 !important; }
  .cash-expenses-sheet .cash-section td {
    background: #e8e8e8 !important;
    font-weight: bold;
    padding: 10px 8px;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .cash-expenses-sheet tbody tr.cash-section td { border-top: 2px solid #000; }
  .cash-expenses-sheet tbody tr:first-child td { border-top: 1px solid #000; }
`;

export default function CashAndExpenses() {
  const { user } = useAuth();
  const { projects } = useProjects();
  const { selectedProjectId, setSelectedProjectId } = useSelectedProject();
  const isSiteManager = user?.role === "Site Manager";
  const assignedProjectId = user?.assignedProjectId ?? null;

  const effectiveProjectId = isSiteManager ? assignedProjectId : (selectedProjectId || null);
  const [startDate, setStartDate] = useState(toTodayISO);
  const [endDate, setEndDate] = useState(toTodayISO);
  const [selectedEntity, setSelectedEntity] = useState<{
    entityType: CashExpensesEntityType;
    entityId: string;
    entityName: string;
  } | null>(null);

  useEffect(() => {
    if (endDate < startDate) {
      setEndDate(startDate);
    }
  }, [startDate, endDate]);

  const { report, loading, error } = useCashExpensesReport(
    effectiveProjectId ?? undefined,
    startDate,
    endDate
  );

  const projectsForSelector = useMemo(
    () =>
      projects.filter(
        (p) =>
          p.status === "Active" || p.status === "On Hold" || p.status === "Completed"
      ),
    [projects]
  );

  const selectedProjectName =
    projects.find((p) => p.id === effectiveProjectId)?.name ?? "Project";

  const subtitle =
    isSiteManager && selectedProjectName
      ? `Report — ${selectedProjectName}`
      : effectiveProjectId
        ? `Report — ${selectedProjectName}`
        : "Report — Select project";

  const periodLabel = startDate === endDate ? startDate : `${startDate} to ${endDate}`;

  const formatReportCurrency = (value: number | null | undefined): string => {
    if (!value) return "-";
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
  };

  const totalPayments =
    report?.totalPayments ??
    (report?.payments?.reduce((s, p) => s + p.amount, 0) ?? 0);
  const paymentTotals = (report?.payments ?? []).reduce(
    (acc, p) => ({
      current: acc.current + (p.amount ?? 0),
      previous: acc.previous + (p.previousAmount ?? 0),
      total: acc.total + (p.totalAmount ?? 0),
    }),
    { current: 0, previous: 0, total: 0 }
  );

  const openingRows = report?.openingBalances
    ? [
        {
          id: "opening-row",
          date: startDate,
          label: "Opening balance",
          source: "",
          remarks: "",
          current: report.openingBalances.openingRow.current ?? 0,
          previous: report.openingBalances.openingRow.previous ?? 0,
          total: report.openingBalances.openingRow.total ?? 0,
          tPayment: report.openingBalances.openingRow.tPayment ?? 0,
          isOpeningRow: true,
        },
        ...(report.openingBalances.inflowTransactions ?? []).map((tx) => ({
          id: tx.id,
          label: "",
          source: tx.source,
          remarks: tx.remarks,
          current: tx.current ?? 0,
          previous: tx.previous ?? 0,
          total: tx.total ?? 0,
          tPayment: tx.tPayment ?? 0,
          isOpeningRow: false,
          date: tx.date,
        })),
      ]
    : [];

  const openingTotals = openingRows.reduce(
    (acc, row) => ({
      current: acc.current + row.current,
      previous: acc.previous + row.previous,
      total: acc.total + row.total,
      tPayment: acc.tPayment + row.tPayment,
    }),
    { current: 0, previous: 0, total: 0, tPayment: 0 }
  );
  const receiptsBalance = {
    current: openingTotals.total,
    previous: openingTotals.previous,
    total: openingTotals.tPayment,
  };
  const dayClosing = {
    current: receiptsBalance.current - paymentTotals.current,
    previous: receiptsBalance.previous - paymentTotals.previous,
    total: receiptsBalance.total - paymentTotals.total,
  };

  const closingBalance = report?.closingBalance ?? 0;

  const thBase =
    "border border-border/60 bg-muted/20 px-3 py-2.5 text-left text-xs font-medium text-muted-foreground print:bg-neutral-200 print:text-black";
  const thNum = `${thBase} text-right`;
  const tdBase = "border border-border/60 px-3 py-2.5 text-sm";
  const tdNum = `${tdBase} text-right font-mono text-sm`;

  return (
    <Layout>
      <PageHeader
        title="Cash & Expenses"
        subtitle={subtitle}
        printProjectName={selectedProjectName}
        printTargetId="cash-expenses-report"
        printOptions={{
          printDocumentTitle: `Cash & Expenses — ${selectedProjectName} — ${periodLabel}`,
          additionalPrintCss: CASH_REPORT_PRINT_CSS,
        }}
      />

      <div className="space-y-6">
        <div className="flex flex-wrap items-end gap-4 p-4 border-2 border-border print-hidden">
          {!isSiteManager && (
            <div className="min-w-[200px]">
              <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Project
              </Label>
              <Select
                value={selectedProjectId || ""}
                onValueChange={(v) => {
                  setSelectedProjectId(v);
                }}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  {projectsForSelector.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {isSiteManager && selectedProjectName && (
            <div className="min-w-[200px]">
              <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Project
              </Label>
              <p className="mt-1.5 text-sm font-medium">{selectedProjectName}</p>
            </div>
          )}
          <div className="min-w-[220px]">
            <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Start date
            </Label>
            <Input
              type="date"
              className="mt-1"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="min-w-[220px]">
            <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              End date
            </Label>
            <Input
              type="date"
              className="mt-1"
              value={endDate}
              min={startDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
        </div>

        {loading ? (
          <p className="flex items-center gap-2 text-muted-foreground py-8">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading report…
          </p>
        ) : error ? (
          <p className="text-destructive py-8">{error}</p>
        ) : !effectiveProjectId ? (
          <p className="text-muted-foreground py-8">
            Select a project to view the cash & expenses report.
          </p>
        ) : (
          <div
            id="cash-expenses-report"
            className="cash-expenses-sheet rounded-xl border border-border/60 bg-card overflow-hidden shadow-sm"
          >
            {/* `hidden`: hidden on screen (Tailwind). Print popup has no Tailwind — line shows via .cash-print-project-name in print CSS. */}
            <div className="cash-print-project-name hidden">{selectedProjectName}</div>
            <table className="w-full border-collapse text-base">
              <tbody>
                {report?.openingBalances ? (
                  <>
                    <tr className="cash-section">
                      <td colSpan={6} className={tdBase}>
                        Opening balances ({periodLabel})
                      </td>
                    </tr>
                    <tr>
                      <th className={thBase}>Date</th>
                      <th className={thBase}>Source / account</th>
                      <th className={thNum}>Current</th>
                      <th className={thNum}>Previous</th>
                      <th className={thNum}>Total</th>
                      <th className={thNum}>T.Payment</th>
                    </tr>
                    {openingRows.map((row) => (
                      <tr key={row.id}>
                        <td className={`${tdBase} text-muted-foreground`}>
                          {row.date || "-"}
                        </td>
                        <td className={`${tdBase} text-muted-foreground`}>
                          {row.isOpeningRow
                            ? row.label
                            : [row.source?.trim() || null, row.remarks?.trim() || null]
                                .filter(Boolean)
                                .join(" — ") || "-"}
                        </td>
                        <td className={tdNum}>{formatReportCurrency(row.current)}</td>
                        <td className={tdNum}>{formatReportCurrency(row.previous)}</td>
                        <td className={tdNum}>{formatReportCurrency(row.total)}</td>
                        <td className={tdNum}>{formatReportCurrency(row.tPayment)}</td>
                      </tr>
                    ))}
                    <tr className="font-medium bg-muted/10">
                      <td className={tdBase}>-</td>
                      <td className={tdBase}>
                        Total
                      </td>
                      <td className={tdNum}>{formatReportCurrency(openingTotals.current)}</td>
                      <td className={tdNum}>{formatReportCurrency(openingTotals.previous)}</td>
                      <td className={tdNum}>{formatReportCurrency(openingTotals.total)}</td>
                      <td className={tdNum}>{formatReportCurrency(openingTotals.tPayment)}</td>
                    </tr>
                  </>
                ) : null}

                <tr className="cash-section">
                  <td colSpan={6} className={tdBase}>
                    Payments ({periodLabel})
                  </td>
                </tr>
                <tr>
                  <th className={thBase}>Entity name</th>
                  <th className={thBase}>Type</th>
                  <th className={thNum}>Current</th>
                  <th className={thNum}>Previous</th>
                  <th className={thNum}>Total</th>
                  <th className={thBase}>Remarks</th>
                </tr>
                {!report?.payments?.length ? (
                  <tr>
                    <td colSpan={6} className={`${tdBase} text-center text-muted-foreground py-8`}>
                      No payments on this date
                    </td>
                  </tr>
                ) : (
                  report.payments.map((p, i) => (
                    <tr
                      key={p.sourceId ?? `${p.entityName}-${i}`}
                      className="hover:bg-muted/30 transition-colors print:hover:bg-transparent cursor-pointer"
                      role="button"
                      onClick={() =>
                        setSelectedEntity({
                          entityType: p.entityType,
                          entityId: p.entityId,
                          entityName: p.entityName,
                        })
                      }
                    >
                      <td className={`${tdBase} font-medium`}>{p.entityName}</td>
                      <td className={`${tdBase} text-muted-foreground`}>
                        {ENTITY_TYPE_LABELS[p.entityType] ?? p.entityType}
                      </td>
                      <td className={tdNum}>{formatReportCurrency(p.amount)}</td>
                      <td className={tdNum}>{formatReportCurrency(p.previousAmount)}</td>
                      <td className={tdNum}>{formatReportCurrency(p.totalAmount)}</td>
                      <td
                        className={`${tdBase} text-muted-foreground max-w-[200px] truncate`}
                        title={p.remarks || undefined}
                      >
                        {p.remarks || "-"}
                      </td>
                    </tr>
                  ))
                )}
                {report?.payments?.length ? (
                  <tr className="bg-warning/20 font-bold print:bg-amber-100">
                    <td colSpan={2} className={tdBase}>
                      Total payments
                    </td>
                    <td className={tdNum}>{formatReportCurrency(paymentTotals.current)}</td>
                    <td className={tdNum}>{formatReportCurrency(paymentTotals.previous)}</td>
                    <td className={tdNum}>{formatReportCurrency(paymentTotals.total)}</td>
                    <td className={tdBase}>-</td>
                  </tr>
                ) : null}
                {report?.openingBalances ? (
                  <tr className="font-medium bg-muted/10">
                    <td colSpan={2} className={tdBase}>
                      Receipts balance
                    </td>
                    <td className={tdNum}>{formatReportCurrency(receiptsBalance.current)}</td>
                    <td className={tdNum}>{formatReportCurrency(receiptsBalance.previous)}</td>
                    <td className={tdNum}>{formatReportCurrency(receiptsBalance.total)}</td>
                    <td className={tdBase}>-</td>
                  </tr>
                ) : null}
                {report?.openingBalances ? (
                  <tr className="border-t-2 border-border/60 font-semibold">
                    <td colSpan={2} className={tdBase}>
                      Day closing balance
                    </td>
                    <td className={tdNum}>{formatReportCurrency(dayClosing.current)}</td>
                    <td className={tdNum}>{formatReportCurrency(dayClosing.previous)}</td>
                    <td className={tdNum}>{formatReportCurrency(dayClosing.total)}</td>
                    <td className={tdBase}>-</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedEntity && effectiveProjectId && (
        <CashExpensesLedgerDialog
          open={!!selectedEntity}
          onOpenChange={(open) => { if (!open) setSelectedEntity(null); }}
          projectId={effectiveProjectId}
          entityType={selectedEntity.entityType}
          entityId={selectedEntity.entityId}
          entityName={selectedEntity.entityName}
          startDate={startDate}
          endDate={endDate}
        />
      )}
    </Layout>
  );
}
