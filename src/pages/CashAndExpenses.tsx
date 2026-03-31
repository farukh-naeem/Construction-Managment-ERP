import { useState, useMemo } from "react";
import Layout from "@/components/Layout";
import PageHeader from "@/components/PageHeader";
import { formatCurrency } from "@/lib/mock-data";
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
import { Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CashExpensesEntityType } from "@/services/cashExpensesReportService";

function toTodayISO(): string {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function addDays(isoDate: string, delta: number): string {
  const d = new Date(isoDate + "T12:00:00");
  d.setDate(d.getDate() + delta);
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
  const [reportDate, setReportDate] = useState(toTodayISO);

  const { report, loading, error } = useCashExpensesReport(
    effectiveProjectId ?? undefined,
    reportDate
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
      ? `Daily report — ${selectedProjectName}`
      : effectiveProjectId
        ? `Daily report — ${selectedProjectName}`
        : "Daily report — Select project";

  const totalPayments =
    report?.totalPayments ??
    (report?.payments?.reduce((s, p) => s + p.amount, 0) ?? 0);

  const totalOpening =
    (report?.openingBalances?.projectLedger ?? 0) +
    (report?.openingBalances?.bankAccounts ?? []).reduce(
      (s, a) => s + a.openingBalance,
      0
    );

  const totalClosing =
    (report?.openingBalances?.projectLedgerClosing ?? 0) +
    (report?.openingBalances?.bankAccounts ?? []).reduce(
      (s, a) => s + (a.closingBalance ?? 0),
      0
    );

  const totalInflows =
    (report?.openingBalances?.projectLedgerInflows ?? 0) +
    (report?.openingBalances?.bankAccounts ?? []).reduce(
      (s, a) => s + (a.inflows ?? 0),
      0
    );

  const closingBalance = report?.closingBalance ?? totalClosing;

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
        printTargetId="cash-expenses-report"
        printOptions={{
          printDocumentTitle: `Cash & Expenses — ${selectedProjectName} — ${reportDate}`,
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
              Report date
            </Label>
            <div className="mt-1 flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={() => setReportDate(addDays(reportDate, -1))}
                title="Previous day"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Input
                type="date"
                className="flex-1 min-w-0"
                value={reportDate}
                onChange={(e) => setReportDate(e.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={() => setReportDate(addDays(reportDate, 1))}
                title="Next day"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
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
                        Opening balances ({reportDate})
                      </td>
                    </tr>
                    <tr>
                      <th colSpan={2} className={thBase}>
                        Source / account
                      </th>
                      <th className={thNum}>Previous</th>
                      <th className={thNum}>Current</th>
                      <th className={thNum}>Total payment</th>
                      <th className={thBase} aria-hidden />
                    </tr>
                    <tr>
                      <td colSpan={2} className={`${tdBase} text-muted-foreground`}>
                        Project ledger
                      </td>
                      <td className={tdNum}>
                        {formatCurrency(report.openingBalances.projectLedger ?? 0)}
                      </td>
                      <td className={tdNum}>
                        {formatCurrency(report.openingBalances.projectLedgerInflows ?? 0)}
                      </td>
                      <td className={tdNum}>
                        {formatCurrency(report.openingBalances.projectLedgerClosing ?? 0)}
                      </td>
                      <td className={tdBase} />
                    </tr>
                    {(report.openingBalances.bankAccounts ?? []).map((acc) => (
                      <tr key={acc.id}>
                        <td colSpan={2} className={`${tdBase} text-muted-foreground`}>
                          {acc.name}
                        </td>
                        <td className={tdNum}>{formatCurrency(acc.openingBalance ?? 0)}</td>
                        <td className={tdNum}>{formatCurrency(acc.inflows ?? 0)}</td>
                        <td className={tdNum}>{formatCurrency(acc.closingBalance ?? 0)}</td>
                        <td className={tdBase} />
                      </tr>
                    ))}
                    <tr className="font-medium bg-muted/10">
                      <td colSpan={2} className={tdBase}>
                        Total
                      </td>
                      <td className={tdNum}>{formatCurrency(totalOpening)}</td>
                      <td className={tdNum}>{formatCurrency(totalInflows)}</td>
                      <td className={tdNum}>{formatCurrency(totalClosing)}</td>
                      <td className={tdBase} />
                    </tr>
                  </>
                ) : null}

                <tr className="cash-section">
                  <td colSpan={6} className={tdBase}>
                    Payments ({reportDate})
                  </td>
                </tr>
                <tr>
                  <th className={thBase}>Entity name</th>
                  <th className={thBase}>Type</th>
                  <th className={thNum}>Previous</th>
                  <th className={thNum}>Current</th>
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
                      className="hover:bg-muted/30 transition-colors print:hover:bg-transparent"
                    >
                      <td className={`${tdBase} font-medium`}>{p.entityName}</td>
                      <td className={`${tdBase} text-muted-foreground`}>
                        {ENTITY_TYPE_LABELS[p.entityType] ?? p.entityType}
                      </td>
                      <td className={tdNum}>{formatCurrency(p.previousAmount)}</td>
                      <td className={tdNum}>{formatCurrency(p.amount)}</td>
                      <td className={tdNum}>{formatCurrency(p.totalAmount)}</td>
                      <td
                        className={`${tdBase} text-muted-foreground max-w-[200px] truncate`}
                        title={p.remarks || undefined}
                      >
                        {p.remarks || "—"}
                      </td>
                    </tr>
                  ))
                )}
                {report?.payments?.length ? (
                  <tr className="bg-warning/20 font-bold print:bg-amber-100">
                    <td colSpan={2} className={tdBase}>
                      Total payments
                    </td>
                    <td className={`${tdNum} text-muted-foreground font-normal print:text-black`}>
                      —
                    </td>
                    <td className={tdNum}>{formatCurrency(totalPayments)}</td>
                    <td className={`${tdNum} text-muted-foreground font-normal print:text-black`}>
                      —
                    </td>
                    <td className={tdBase} />
                  </tr>
                ) : null}

                {report?.openingBalances ? (
                  <>
                    <tr className="cash-section">
                      <td colSpan={6} className={tdBase}>
                        Summary ({reportDate})
                      </td>
                    </tr>
                    <tr>
                      <th colSpan={4} className={thBase}>
                        Item
                      </th>
                      <th colSpan={2} className={thNum}>
                        Amount
                      </th>
                    </tr>
                    <tr>
                      <td colSpan={4} className={`${tdBase} text-muted-foreground`}>
                        Total opening
                      </td>
                      <td colSpan={2} className={tdNum}>
                        {formatCurrency(totalOpening)}
                      </td>
                    </tr>
                    <tr className="bg-warning/20 font-bold print:bg-amber-100">
                      <td colSpan={4} className={tdBase}>
                        Total payments
                      </td>
                      <td colSpan={2} className={tdNum}>
                        {formatCurrency(totalPayments)}
                      </td>
                    </tr>
                    <tr className="border-t-2 border-border/60 font-semibold">
                      <td colSpan={4} className={tdBase}>
                        Day closing balance
                      </td>
                      <td colSpan={2} className={tdNum}>
                        {formatCurrency(closingBalance)}
                      </td>
                    </tr>
                  </>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>
  );
}
