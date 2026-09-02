import { useState, useMemo, useEffect } from "react";
import { Link } from "react-router-dom";
import Layout from "@/components/Layout";
import PageHeader from "@/components/PageHeader";
import StatusBadge from "@/components/StatusBadge";
import { formatCurrencyDecimal } from "@/lib/mock-data";
import { formatDisplayDate } from "@/lib/pktDate";
import { useAuth } from "@/context/AuthContext";
import { useSelectedProject } from "@/context/SelectedProjectContext";
import { useProjects } from "@/hooks/useProjects";
import { useMachines } from "@/hooks/useMachines";
import { useMachinesRunningBill } from "@/hooks/useMachinesRunningBill";
import { AddMachineDialog } from "@/components/dialogs/AddMachineDialog";
import { EditMachineDialog } from "@/components/dialogs/EditMachineDialog";
import { BulkMachineEntryDialog } from "@/components/dialogs/BulkMachineEntryDialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { TablePagination } from "@/components/TablePagination";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteMachine } from "@/services/machinesService";
import type { ApiMachineWithTotals } from "@/services/machinesService";

const DEFAULT_PAGE_SIZE = 12;
const PAGE_SIZE_OPTIONS = [12, 24, 50, 100];

function defaultPeriodBounds(): { start: string; end: string } {
  const d = new Date();
  const y = d.getFullYear();
  const m = d.getMonth();
  const pad = (n: number) => String(n).padStart(2, "0");
  const start = `${y}-${pad(m + 1)}-01`;
  const lastDay = new Date(y, m + 1, 0).getDate();
  const end = `${y}-${pad(m + 1)}-${pad(lastDay)}`;
  return { start, end };
}

/** Table cells: grouped digits only (PKR stated once above the table). Always shows 2 decimal places, matching the hours columns. */
function formatRunningBillAmount(amount: number): string {
  const abs = Math.abs(amount);
  const formatted = new Intl.NumberFormat("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(abs);
  if (amount < 0) return `(${formatted})`;
  return formatted;
}


function formatHoursCell(n: number): string {
  return n.toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPeriodLabel(ymd: string): string {
  return formatDisplayDate(ymd);
}

function cellMoney(n: number, blankWhenZero = false): string {
  if (blankWhenZero && n === 0) return "—";
  return formatRunningBillAmount(n);
}

const MACHINERY_RUNNING_PRINT_CSS = `
  table.machinery-running-table { width: 100%; border-collapse: collapse; margin-top: 0; }
  table.machinery-running-table th,
  table.machinery-running-table td { border: 1px solid #000; padding: 5px 6px; font-size: 11px; vertical-align: middle; }
  table.machinery-running-table th {
    background: #d9d9d9 !important;
    color: #000 !important;
    font-weight: 700;
    text-align: center !important;
    text-transform: none !important;
    letter-spacing: normal !important;
  }
  table.machinery-running-table th.text-left,
  table.machinery-running-table td.text-left { text-align: left !important; }
  table.machinery-running-table th.text-center,
  table.machinery-running-table td.text-center { text-align: center !important; }
  table.machinery-running-table td.text-right { text-align: right !important; font-family: Consolas, ui-monospace, monospace; }
  table.machinery-running-table a {
    color: inherit !important;
    text-decoration: none !important;
  }
  table.machinery-running-table tbody tr:nth-child(even) td { background: #f9f9f9; }
  .machinery-row-excluded { display: none !important; }
  table.machinery-running-table tr.machinery-running-total td { font-weight: 700; background: #f0f0f0; }
  table.machinery-running-table tr.machinery-running-deduction td,
  table.machinery-running-table tr.machinery-running-balance td { font-weight: 700; }
  .machinery-running-doc { font-family: Arial, Helvetica, sans-serif; color: #000; }
  .machinery-running-project { text-align: center; font-size: 13px; font-weight: 600; }
  .machinery-running-title { text-align: center; font-size: 15px; font-weight: 700; margin: 14px 0 6px; letter-spacing: 0.02em; }
  .machinery-running-bill-meta { text-align: right; font-size: 10px; color: #333; line-height: 1.35; }
  .machinery-running-signatures { display: flex; justify-content: flex-end; margin-top: 128px; padding: 0 8%; font-size: 11px; }
  .machinery-running-signatures > div { text-align: center; width: 11rem; max-width: 45%; }
  .machinery-running-signatures .sig-line { border-top: 1px solid #000; margin-bottom: 6px; min-height: 28px; }
`;

type ViewMode = "standard" | "runningBill";

export default function Machinery() {
  const { user: currentUser } = useAuth();
  const { projects } = useProjects();
  const { selectedProjectId, setSelectedProjectId } = useSelectedProject();
  const [addOpen, setAddOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [viewMode, setViewMode] = useState<ViewMode>("standard");
  const [{ start: periodStart, end: periodEnd }, setPeriod] = useState(defaultPeriodBounds);
  /** Machines unchecked from the running bill totals/print. Tracking exclusions (rather than
   *  inclusions) means every machine defaults to selected without needing to seed the set from
   *  fetched rows. */
  const [deselectedMachineIds, setDeselectedMachineIds] = useState<Set<string>>(new Set());

  const isSiteManager = currentUser?.role === "Site Manager";
  const canEditDelete = !isSiteManager;

  const effectiveProjectId = selectedProjectId || null;

  const { machines, total, loading, error, refetch } = useMachines(
    effectiveProjectId,
    page,
    pageSize
  );

  // Running bill selection (which machines count toward totals/print) needs every machine on the
  // project in hand at once, not just the current standard-view page — so fetch it unpaginated.
  const runningBill = useMachinesRunningBill(
    effectiveProjectId,
    periodStart,
    periodEnd,
    1,
    100,
    viewMode === "runningBill"
  );

  const [editMachine, setEditMachine] = useState<ApiMachineWithTotals | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteMachineState, setDeleteMachineState] = useState<ApiMachineWithTotals | null>(null);

  const projectsForSelector = useMemo(
    () => projects.filter((p) => p.status === "Active" || p.status === "On Hold"),
    [projects]
  );

  const projectName = effectiveProjectId
    ? projects.find((p) => p.id === effectiveProjectId)?.name ?? "Project"
    : "—";

  const subtitle = effectiveProjectId
    ? `Company owned & rented machinery — ${projectName}`
    : "Company owned & rented machinery — Select project";

  const activeTotal = viewMode === "runningBill" ? runningBill.total : total;
  const activeLoading = viewMode === "runningBill" ? runningBill.loading : loading;
  const activeError = viewMode === "runningBill" ? runningBill.error : error;

  const totalPages = Math.max(1, Math.ceil(activeTotal / pageSize));
  const startIndexOneBased = activeTotal === 0 ? 0 : (page - 1) * pageSize + 1;
  const endIndex = Math.min(page * pageSize, activeTotal);

  const canAdd = !!effectiveProjectId;

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setPage(1);
  };

  const handleSuccess = () => {
    refetch();
    void runningBill.refetch();
  };

  const handleDeleteClick = (m: ApiMachineWithTotals) => {
    setDeleteMachineState(m);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteMachineState) return;
    try {
      await deleteMachine(deleteMachineState.id);
      toast.success("Machine deleted");
      setDeleteMachineState(null);
      handleSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete machine");
    }
  };

  const setViewModeAndReset = (mode: ViewMode) => {
    setViewMode(mode);
    setPage(1);
  };

  useEffect(() => {
    setPage(1);
  }, [periodStart, periodEnd]);

  // Re-include every machine whenever the bill's scope changes, rather than carrying stale
  // exclusions from a different project/period into a new one.
  useEffect(() => {
    setDeselectedMachineIds(new Set());
  }, [effectiveProjectId, periodStart, periodEnd]);

  const toggleMachineSelected = (id: string, selected: boolean) => {
    setDeselectedMachineIds((prev) => {
      const next = new Set(prev);
      if (selected) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedRunningBillRows = useMemo(
    () => runningBill.rows.filter((r) => !deselectedMachineIds.has(r.id)),
    [runningBill.rows, deselectedMachineIds]
  );
  const allRunningBillSelected =
    runningBill.rows.length > 0 && selectedRunningBillRows.length === runningBill.rows.length;

  /** Totals recomputed from only the checked rows — this is what prints and what "Balance" is
   *  based on, since the client decides which machines belong on a given bill. */
  const summary = useMemo(
    () =>
      selectedRunningBillRows.reduce(
        (acc, r) => ({
          currentHours: acc.currentHours + r.currentHours,
          previousHours: acc.previousHours + r.previousHours,
          totalHours: acc.totalHours + r.totalHours,
          thisBill: acc.thisBill + r.thisBill,
          previousBill: acc.previousBill + r.previousBill,
          totalAmount: acc.totalAmount + r.totalAmount,
          previousBillAdvance: acc.previousBillAdvance + r.previousBillAdvance,
          thisBillAdvance: acc.thisBillAdvance + r.thisBillAdvance,
        }),
        {
          currentHours: 0,
          previousHours: 0,
          totalHours: 0,
          thisBill: 0,
          previousBill: 0,
          totalAmount: 0,
          previousBillAdvance: 0,
          thisBillAdvance: 0,
        }
      ),
    [selectedRunningBillRows]
  );
  const totalAdvance = summary.previousBillAdvance + summary.thisBillAdvance;
  const balanceThisBill = summary.thisBill - summary.thisBillAdvance;
  const balancePreviousBill = summary.previousBill - summary.previousBillAdvance;
  const balanceTotal = summary.totalAmount - totalAdvance;

  return (
    <Layout>
      <PageHeader
        title="Machinery"
        printProjectName={projectName}
        subtitle={
          viewMode === "runningBill"
            ? `${subtitle} · Running bill ${formatDisplayDate(periodStart)} → ${formatDisplayDate(periodEnd)}`
            : subtitle
        }
        printTargetId="machinery-table"
        printOptions={
          viewMode === "runningBill"
            ? {
                omitDefaultHeader: true,
                printDocumentTitle: `Machinery running bill — ${projectName}`,
                additionalPrintCss: MACHINERY_RUNNING_PRINT_CSS,
                preparePrintContent: (printContent) => {
                  printContent.querySelectorAll("table.machinery-running-table").forEach((table) => {
                    table.querySelector("colgroup > col")?.remove();
                    table.querySelectorAll(".machinery-running-checkbox-cell").forEach((cell) => cell.remove());
                    table.querySelectorAll("tbody tr").forEach((row) => {
                      const leadingCell = row.querySelector(":scope > td[colspan]") as HTMLTableCellElement | null;
                      if (leadingCell && leadingCell.colSpan > 1) leadingCell.colSpan -= 1;
                    });
                  });
                  return printContent;
                },
              }
            : undefined
        }
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setBulkOpen(true)} disabled={!canAdd}>Bulk Entry</Button>
            <Button variant="warning" size="sm" onClick={() => setAddOpen(true)} disabled={!canAdd}><Plus className="h-4 w-4 mr-1" />Add Machine</Button>
          </div>
        }
      />
      <AddMachineDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        restrictedProjectId={isSiteManager ? effectiveProjectId ?? undefined : undefined}
        restrictedProjectName={isSiteManager ? projectName : undefined}
        projects={projects.map((p) => ({ id: p.id, name: p.name }))}
        onSuccess={handleSuccess}
      />
      <BulkMachineEntryDialog open={bulkOpen} onOpenChange={setBulkOpen} projectId={effectiveProjectId} onSuccess={handleSuccess} />
      <EditMachineDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        machine={editMachine}
        onSave={handleSuccess}
      />
      <AlertDialog open={!!deleteMachineState} onOpenChange={(open) => !open && setDeleteMachineState(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete machine?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete &quot;{deleteMachineState?.name}&quot;. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <div className="flex flex-col gap-4 p-4 border-2 border-border mb-4 print-hidden">
        <div className="flex flex-wrap items-end gap-4">
          {projectsForSelector.length > 0 && (
            <div className="min-w-[200px]">
              <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Project</Label>
              <Select
                value={selectedProjectId || ""}
                onValueChange={(v) => {
                  setSelectedProjectId(v);
                  setPage(1);
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
              <p className="text-xs text-muted-foreground mt-1">Group machinery by project</p>
            </div>
          )}
          <div className="min-w-[220px]">
            <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">View</Label>
            <Tabs value={viewMode} onValueChange={(v) => setViewModeAndReset(v as ViewMode)} className="mt-2">
              <TabsList className="h-9">
                <TabsTrigger value="standard" className="text-xs sm:text-sm">
                  Standard
                </TabsTrigger>
                <TabsTrigger value="runningBill" className="text-xs sm:text-sm">
                  Running bill
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>
        {viewMode === "runningBill" && (
          <div className="flex flex-wrap items-end gap-4 border-t border-border pt-4">
            <div>
              <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Period start</Label>
              <Input
                type="date"
                className="mt-1 w-[160px]"
                value={periodStart}
                onChange={(e) => setPeriod((p) => ({ ...p, start: e.target.value }))}
              />
            </div>
            <div>
              <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Period end (bill date)</Label>
              <Input
                type="date"
                className="mt-1 w-[160px]"
                value={periodEnd}
                onChange={(e) => setPeriod((p) => ({ ...p, end: e.target.value }))}
              />
            </div>
          </div>
        )}
      </div>
      <div id="machinery-table" className="border-2 border-border">
        {viewMode === "runningBill" ? (
          <div className="machinery-running-doc rounded-lg border border-border bg-card p-4 shadow-sm sm:p-6">
            <header className="mb-4 border-b border-border pb-4">
              <p className="machinery-running-project text-center text-base font-semibold text-foreground">
                {effectiveProjectId ? projectName : "Select a project"}
              </p>
              {effectiveProjectId ? (
                <div className="machinery-running-bill-meta relative mt-2 min-h-[2.25rem] text-end text-[11px] leading-snug text-muted-foreground sm:text-xs">
                  <div className="sm:absolute sm:right-0 sm:top-0">
                    <div>
                      Billing period {formatPeriodLabel(periodStart)} – {formatPeriodLabel(periodEnd)}
                    </div>
                    <div>Bill date {formatPeriodLabel(periodEnd)}</div>
                  </div>
                </div>
              ) : null}
              <h2 className="machinery-running-title mt-4 text-center text-lg font-bold uppercase tracking-wide sm:mt-5 sm:text-xl">
                Machinery running bill
              </h2>
            </header>
            <div className="overflow-x-auto rounded-md border border-border bg-background">
              <table
                className="machinery-running-table w-full min-w-[1040px] border-collapse text-sm [&_tbody_tr:nth-child(even)]:bg-muted/20 [&_td]:px-2.5 [&_td]:py-2 [&_td]:align-middle [&_th]:px-2.5 [&_th]:py-2.5 [&_th]:text-xs [&_th]:font-semibold"
              >
                <colgroup>
                  <col className="w-8" />
                  <col className="w-10" />
                  <col className="min-w-[11rem]" />
                  <col span={3} className="w-[4.5rem]" />
                  <col className="w-[5rem]" />
                  <col span={3} className="min-w-[5.5rem]" />
                </colgroup>
                <thead>
                  <tr>
                    <th className="text-center machinery-running-checkbox-cell print-hidden">
                      <Checkbox
                        checked={allRunningBillSelected}
                        onCheckedChange={(checked) => {
                          setDeselectedMachineIds(
                            checked ? new Set() : new Set(runningBill.rows.map((r) => r.id))
                          );
                        }}
                        aria-label="Select all machines"
                      />
                    </th>
                    <th className="text-center">#</th>
                    <th className="text-left">Machine</th>
                    <th className="whitespace-nowrap" title="Hours this period">
                      Cur hrs
                    </th>
                    <th className="whitespace-nowrap" title="Hours before this period">
                      Prev hrs
                    </th>
                    <th className="whitespace-nowrap">Total hrs</th>
                    <th className="whitespace-nowrap border-l border-border/80" title="PKR per hour">
                      Rate
                    </th>
                    <th className="whitespace-nowrap border-l-2 border-border" title="This period">
                      This bill
                    </th>
                    <th className="whitespace-nowrap" title="Before this period">
                      Prev bill
                    </th>
                    <th className="whitespace-nowrap">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {activeLoading ? (
                    <tr>
                      <td colSpan={10} className="px-4 py-10 text-center text-muted-foreground">
                        Loading…
                      </td>
                    </tr>
                  ) : activeError ? (
                    <tr>
                      <td colSpan={10} className="px-4 py-10 text-center text-destructive">
                        {activeError}
                      </td>
                    </tr>
                  ) : runningBill.rows.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-4 py-10 text-center text-muted-foreground">
                        No machines for this project.
                      </td>
                    </tr>
                  ) : (
                    runningBill.rows.map((m, i) => {
                      const isSelected = !deselectedMachineIds.has(m.id);
                      return (
                        <tr
                          key={m.id}
                          className={`border-b border-border/60 ${
                            isSelected ? "" : "machinery-row-excluded opacity-50"
                          }`}
                        >
                          <td className="text-center machinery-running-checkbox-cell print-hidden">
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={(checked) => toggleMachineSelected(m.id, checked === true)}
                              aria-label={`Include ${m.name} in bill`}
                            />
                          </td>
                          <td className="text-center tabular-nums text-muted-foreground">{i + 1}</td>
                          <td className="max-w-[14rem] truncate text-left font-medium sm:max-w-[18rem]" title={m.name}>
                            <Link
                              to={`/machinery/${m.id}`}
                              className="font-medium text-foreground no-underline hover:underline"
                            >
                              {m.name}
                            </Link>
                          </td>
                          <td className="text-right font-mono text-xs tabular-nums sm:text-sm">
                            {m.currentHours === 0 ? "—" : formatHoursCell(m.currentHours)}
                          </td>
                          <td className="text-right font-mono text-xs tabular-nums sm:text-sm">
                            {formatHoursCell(m.previousHours)}
                          </td>
                          <td className="text-right font-mono text-xs font-medium tabular-nums sm:text-sm">
                            {formatHoursCell(m.totalHours)}
                          </td>
                          <td className="border-l border-border/80 text-right font-mono text-xs tabular-nums sm:text-sm">
                            {formatRunningBillAmount(m.hourlyRate)}
                          </td>
                          <td className="border-l-2 border-border text-right font-mono text-xs tabular-nums sm:text-sm">
                            {cellMoney(m.thisBill, true)}
                          </td>
                          <td className="text-right font-mono text-xs tabular-nums sm:text-sm">
                            {cellMoney(m.previousBill)}
                          </td>
                          <td className="text-right font-mono text-xs font-medium tabular-nums sm:text-sm">
                            {cellMoney(m.totalAmount)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                  {!activeLoading && !activeError && selectedRunningBillRows.length > 0 && (
                    <>
                      <tr className="machinery-running-total border-t-2 border-border bg-muted/40">
                        <td colSpan={3} className="text-left font-semibold">
                          Total
                        </td>
                        <td className="text-right font-mono text-xs font-semibold tabular-nums sm:text-sm">
                          {summary.currentHours === 0 ? "—" : formatHoursCell(summary.currentHours)}
                        </td>
                        <td className="text-right font-mono text-xs font-semibold tabular-nums sm:text-sm">
                          {formatHoursCell(summary.previousHours)}
                        </td>
                        <td className="text-right font-mono text-xs font-semibold tabular-nums sm:text-sm">
                          {formatHoursCell(summary.totalHours)}
                        </td>
                        <td className="border-l border-border/80 text-center text-muted-foreground">—</td>
                        <td className="border-l-2 border-border text-right font-mono text-xs font-semibold tabular-nums sm:text-sm">
                          {cellMoney(summary.thisBill, true)}
                        </td>
                        <td className="text-right font-mono text-xs font-semibold tabular-nums sm:text-sm">
                          {cellMoney(summary.previousBill)}
                        </td>
                        <td className="text-right font-mono text-xs font-semibold tabular-nums sm:text-sm">
                          {cellMoney(summary.totalAmount)}
                        </td>
                      </tr>
                      <tr className="machinery-running-deduction bg-muted/25">
                        <td colSpan={7} className="text-left text-sm font-medium">
                          Less advance
                        </td>
                        <td className="text-right font-mono text-sm font-semibold tabular-nums">
                          {summary.thisBillAdvance === 0 ? "—" : formatRunningBillAmount(summary.thisBillAdvance)}
                        </td>
                        <td className="text-right font-mono text-sm font-semibold tabular-nums">
                          {summary.previousBillAdvance === 0
                            ? "—"
                            : formatRunningBillAmount(summary.previousBillAdvance)}
                        </td>
                        <td className="text-right font-mono text-sm font-semibold tabular-nums">
                          {totalAdvance === 0 ? "—" : formatRunningBillAmount(totalAdvance)}
                        </td>
                      </tr>
                      <tr className="machinery-running-balance bg-muted/40">
                        <td colSpan={7} className="text-left text-sm font-semibold">
                          Balance
                        </td>
                        <td className="text-right font-mono text-sm font-bold tabular-nums">
                          {cellMoney(balanceThisBill)}
                        </td>
                        <td className="text-right font-mono text-sm font-bold tabular-nums">
                          {cellMoney(balancePreviousBill)}
                        </td>
                        <td className="text-right font-mono text-sm font-bold tabular-nums">
                          {cellMoney(balanceTotal)}
                        </td>
                      </tr>
                    </>
                  )}
                </tbody>
              </table>
            </div>
            <div className="machinery-running-signatures mt-24 flex justify-end px-[8%] text-muted-foreground">
              <div className="w-44 text-center">
                <div className="sig-line border-border" />
                <span className="text-xs">Checked by</span>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-base">
                <thead>
                  <tr className="border-b-2 border-border bg-primary text-primary-foreground">
                    <th className="px-4 py-2.5 text-left text-sm font-bold uppercase tracking-wider">Machine</th>
                    <th className="px-4 py-2.5 text-left text-sm font-bold uppercase tracking-wider">Ownership</th>
                    <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Rate/Hr</th>
                    <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Hours</th>
                    <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Total Cost</th>
                    <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Paid</th>
                    <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Pending</th>
                    {canEditDelete && (
                      <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider print-hidden">Actions</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={canEditDelete ? 8 : 7} className="px-4 py-8 text-center text-muted-foreground">
                        Loading…
                      </td>
                    </tr>
                  ) : error ? (
                    <tr>
                      <td colSpan={canEditDelete ? 8 : 7} className="px-4 py-8 text-center text-destructive">
                        {error}
                      </td>
                    </tr>
                  ) : machines.length === 0 ? (
                    <tr>
                      <td colSpan={canEditDelete ? 8 : 7} className="px-4 py-8 text-center text-muted-foreground">
                        No machines.
                      </td>
                    </tr>
                  ) : (
                    machines.map((m) => (
                      <tr key={m.id} className="border-b border-border hover:bg-accent/50 transition-colors">
                        <td className="px-4 py-3">
                          <Link to={`/machinery/${m.id}`} className="font-bold hover:underline">
                            {m.name}
                          </Link>
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={m.ownership} />
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-sm">{formatCurrencyDecimal(m.hourlyRate)}</td>
                        <td className="px-4 py-3 text-right font-mono text-sm">{m.totalHours}</td>
                        <td className="px-4 py-3 text-right font-mono text-sm font-bold">{formatCurrencyDecimal(m.totalCost)}</td>
                        <td className="px-4 py-3 text-right font-mono text-sm text-success">{formatCurrencyDecimal(m.totalPaid)}</td>
                        <td className="px-4 py-3 text-right font-mono text-sm">
                          {m.totalPending > 0 ? (
                            <span className="text-destructive">{formatCurrencyDecimal(m.totalPending)}</span>
                          ) : m.totalPaid > m.totalCost ? (
                            <span className="text-success">+{formatCurrencyDecimal(m.totalPaid - m.totalCost)} adv</span>
                          ) : (
                            "—"
                          )}
                        </td>
                        {canEditDelete && (
                          <td className="px-4 py-3 text-right print-hidden">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => {
                                  setEditMachine(m);
                                  setEditOpen(true);
                                }}
                                aria-label="Edit"
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                onClick={() => handleDeleteClick(m)}
                                aria-label="Delete"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
        {viewMode !== "runningBill" && (
          <div className="print-hidden">
            <TablePagination
              pageSize={pageSize}
              onPageSizeChange={handlePageSizeChange}
              page={page}
              totalPages={totalPages}
              totalItems={activeTotal}
              onPrevious={() => setPage((p) => Math.max(1, p - 1))}
              onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
              canPrevious={page > 1}
              canNext={page < totalPages}
              startIndexOneBased={startIndexOneBased}
              endIndex={endIndex}
              pageSizeOptions={PAGE_SIZE_OPTIONS}
            />
          </div>
        )}
      </div>
    </Layout>
  );
}
