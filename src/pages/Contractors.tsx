import { useState, useMemo, useEffect } from "react";
import { useSearchParams, Link } from "react-router-dom";
import Layout from "@/components/Layout";
import PageHeader from "@/components/PageHeader";
import StatCard from "@/components/StatCard";
import { formatCurrency } from "@/lib/mock-data";
import { useAuth } from "@/context/AuthContext";
import { useSelectedProject } from "@/context/SelectedProjectContext";
import { useProjects } from "@/hooks/useProjects";
import { useContractors } from "@/hooks/useContractors";
import { useContractorLedger } from "@/hooks/useContractorLedger";
import { AddContractorDialog } from "@/components/dialogs/AddContractorDialog";
import { AddContractorEntryDialog } from "@/components/dialogs/AddContractorEntryDialog";
import { EditContractorDialog } from "@/components/dialogs/EditContractorDialog";
import { ContractorPaymentDialog } from "@/components/dialogs/ContractorPaymentDialog";
import { Combobox } from "@/components/ui/combobox";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { getLocalMonthKey } from "@/lib/employee-ledger";
import { Plus, ChevronLeft, ChevronRight, Banknote, Pencil, Trash2, ArrowLeft } from "lucide-react";
import PrintExportButton from "@/components/PrintExportButton";
import { deleteContractor } from "@/services/contractorsService";
import { deleteContractorEntry, deleteContractorPayment } from "@/services/contractorLedgerService";
import { toast } from "sonner";
import type { ApiContractorWithTotals } from "@/services/contractorsService";
import type { ApiContractorLedgerRow } from "@/services/contractorLedgerService";
import { TablePagination } from "@/components/TablePagination";

const ALL_CONTRACTORS = "__all__";
const PAGE_SIZE_OPTIONS = [12, 24, 50, 100];

function getMonthLabel(ym: string) {
  const [y, m] = ym.split("-");
  const date = new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1);
  return date.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

function getMonthLabelFromDate(dateStr: string) {
  const [y, m] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

function prevMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  if (m === 1) return `${y - 1}-12`;
  return `${y}-${String(m - 1).padStart(2, "0")}`;
}

function nextMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  if (m === 12) return `${y + 1}-01`;
  return `${y}-${String(m + 1).padStart(2, "0")}`;
}

function getContractorStatusLabel(c: ApiContractorWithTotals): string {
  if (c.totalAmount === 0 && c.totalPaid === 0) return "N/A";
  if (c.remaining > 0) return "Remaining";
  return "Paid";
}

export default function Contractors() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user: currentUser } = useAuth();
  const { projects } = useProjects();
  const isSiteManager = currentUser?.role === "Site Manager";
  const canEditDelete = currentUser?.role !== "Site Manager";

  const urlContractorId = searchParams.get("contractorId") ?? null;
  const fromLiabilities = searchParams.get("returnTo") === "liabilities";

  const { selectedProjectId, setSelectedProjectId } = useSelectedProject();
  const effectiveProjectId = isSiteManager ? (currentUser?.assignedProjectId ?? null) : (selectedProjectId || null);

  const { contractors, loading: contractorsLoading, error: contractorsError, refetch: refetchContractors } = useContractors(effectiveProjectId);
  const [currentMonth, setCurrentMonth] = useState(() => getLocalMonthKey());
  const [selectedContractorId, setSelectedContractorIdState] = useState<string>(ALL_CONTRACTORS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);

  const setSelectedContractorId = (id: string) => {
    setSelectedContractorIdState(id);
    setPage(1);
    if (id === ALL_CONTRACTORS) {
      const next = new URLSearchParams(searchParams);
      next.delete("contractorId");
      setSearchParams(next, { replace: true });
    } else {
      setSearchParams({ ...Object.fromEntries(searchParams), contractorId: id }, { replace: true });
    }
  };

  const { ledger, loading: ledgerLoading, error: ledgerError, refetch: refetchLedger, isAllTimeMode } = useContractorLedger(
    effectiveProjectId,
    currentMonth,
    selectedContractorId === ALL_CONTRACTORS ? null : selectedContractorId,
    page,
    pageSize
  );

  const [addContractorOpen, setAddContractorOpen] = useState(false);
  const [addEntryOpen, setAddEntryOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [editContractor, setEditContractor] = useState<ApiContractorWithTotals | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteContractorState, setDeleteContractorState] = useState<ApiContractorWithTotals | null>(null);
  const [deleteEntryState, setDeleteEntryState] = useState<ApiContractorLedgerRow | null>(null);
  const [deletePaymentState, setDeletePaymentState] = useState<ApiContractorLedgerRow | null>(null);

  const projectsForSelector = useMemo(
    () => projects.filter((p) => p.status === "Active" || p.status === "On Hold" || p.status === "Completed"),
    [projects]
  );
  const selectedProjectName = isSiteManager
    ? (currentUser?.assignedProjectName ?? "Project")
    : (projects.find((p) => p.id === selectedProjectId)?.name ?? "Project");
  const selectedContractor = selectedContractorId !== ALL_CONTRACTORS
    ? contractors.find((c) => c.id === selectedContractorId) ?? null
    : null;

  useEffect(() => {
    if (urlContractorId && contractors.length > 0 && contractors.some((c) => c.id === urlContractorId)) {
      setSelectedContractorIdState(urlContractorId);
    }
  }, [urlContractorId, contractors]);

  useEffect(() => {
    if (selectedContractorId !== ALL_CONTRACTORS && !contractors.some((c) => c.id === selectedContractorId)) {
      setSelectedContractorId(ALL_CONTRACTORS);
    }
  }, [contractors, selectedContractorId]);

  const comboboxOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [
      { value: ALL_CONTRACTORS, label: "All Contractors" },
      ...contractors.map((c) => ({
        value: c.id,
        label: `${c.name} — ${getContractorStatusLabel(c)}`,
      })),
    ];
    return opts;
  }, [contractors]);

  const totalPages = ledger ? Math.max(1, Math.ceil(ledger.total / pageSize)) : 1;
  const canGoNext = currentMonth < getLocalMonthKey();

  const kpiTotal = isAllTimeMode && selectedContractor
    ? formatCurrency(selectedContractor.totalAmount)
    : ledger ? formatCurrency(ledger.totalAmount) : "—";
  const kpiPaid = isAllTimeMode && selectedContractor
    ? formatCurrency(selectedContractor.totalPaid)
    : ledger ? formatCurrency(ledger.totalPaid) : "—";
  const kpiRemaining = isAllTimeMode && selectedContractor
    ? formatCurrency(selectedContractor.remaining)
    : ledger ? formatCurrency(ledger.remaining) : "—";
  const kpiRemainingVariant =
    isAllTimeMode && selectedContractor
      ? (selectedContractor.remaining > 0 ? "destructive" : "success")
      : (ledger && ledger.remaining > 0 ? "destructive" : "success");

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setPage(1);
  };

  const handleDeleteContractorClick = (c: ApiContractorWithTotals) => {
    if (c.remaining > 0) {
      toast.error(`Cannot delete "${c.name}" — they have remaining amount of ${formatCurrency(c.remaining)}. Clear the outstanding balance first.`);
      return;
    }
    setDeleteContractorState(c);
  };

  const handleDeleteContractorConfirm = async () => {
    if (!deleteContractorState) return;
    try {
      await deleteContractor(deleteContractorState.id);
      toast.success("Contractor deleted");
      setDeleteContractorState(null);
      setSelectedContractorId(ALL_CONTRACTORS);
      refetchContractors();
      refetchLedger();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete contractor");
    }
  };

  const handleDeleteEntry = async () => {
    if (!deleteEntryState) return;
    try {
      await deleteContractorEntry(deleteEntryState.id);
      toast.success("Entry deleted");
      setDeleteEntryState(null);
      refetchLedger();
      refetchContractors();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete entry");
    }
  };

  const handleDeletePayment = async () => {
    if (!deletePaymentState) return;
    try {
      await deleteContractorPayment(deletePaymentState.id);
      toast.success("Payment deleted");
      setDeletePaymentState(null);
      refetchLedger();
      refetchContractors();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete payment");
    }
  };

  const handleRowClick = (row: ApiContractorLedgerRow) => {
    if (row.contractorId && selectedContractorId === ALL_CONTRACTORS) {
      setSelectedContractorId(row.contractorId);
    }
  };

  return (
    <Layout>
      {fromLiabilities && (
        <Link to="/liabilities" className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="h-3 w-3" /> Back to Liabilities
        </Link>
      )}
      <PageHeader
        title="Contractors"
        subtitle="Project-scoped contractors — entries and payments by month"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setAddContractorOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> Add Contractor
            </Button>
            <Button variant="warning" size="sm" onClick={() => setAddEntryOpen(true)} disabled={!effectiveProjectId}>
              <Plus className="h-4 w-4 mr-1" /> Add Entry
            </Button>
            {selectedContractor && (
              <Button variant="default" size="sm" onClick={() => setPaymentOpen(true)} disabled={selectedContractor.remaining <= 0}>
                <Banknote className="h-4 w-4 mr-1" /> Record Payment
              </Button>
            )}
            <PrintExportButton title="Contractors" printProjectName={selectedProjectName} printTargetId="contractors-content" />
          </div>
        }
      />

      <AddContractorDialog
        open={addContractorOpen}
        onOpenChange={setAddContractorOpen}
        restrictedProjectId={isSiteManager ? currentUser?.assignedProjectId : undefined}
        restrictedProjectName={isSiteManager ? currentUser?.assignedProjectName : undefined}
        projects={projects.map((p) => ({ id: p.id, name: p.name }))}
        onSuccess={() => { refetchContractors(); refetchLedger(); }}
      />
      <AddContractorEntryDialog
        open={addEntryOpen}
        onOpenChange={setAddEntryOpen}
        defaultContractorId={selectedContractor?.id}
        projectId={effectiveProjectId ?? ""}
        contractors={contractors}
        onSuccess={() => { refetchLedger(); refetchContractors(); }}
      />
      <EditContractorDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        contractor={editContractor}
        onSuccess={() => { refetchContractors(); setEditContractor(null); }}
      />
      <ContractorPaymentDialog
        open={paymentOpen}
        onOpenChange={setPaymentOpen}
        contractor={selectedContractor}
        remainingBalance={selectedContractor?.remaining}
        onSuccess={() => { refetchLedger(); refetchContractors(); }}
      />
      <AlertDialog open={!!deleteContractorState} onOpenChange={(open) => !open && setDeleteContractorState(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete contractor?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete &quot;{deleteContractorState?.name}&quot;. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteContractorConfirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={!!deleteEntryState} onOpenChange={(open) => !open && setDeleteEntryState(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete entry?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove this contractor entry. This may affect balances.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteEntry} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={!!deletePaymentState} onOpenChange={(open) => !open && setDeletePaymentState(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete payment?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove this payment record and restore the contractor balance.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeletePayment} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div id="contractors-content" className="space-y-4">
        <div className="flex flex-wrap items-end gap-4 p-4 border-2 border-border print-hidden">
          {canEditDelete && (
            <div className="min-w-[200px]">
              <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Project</Label>
              <Select
                value={selectedProjectId}
                onValueChange={(v) => {
                  setSelectedProjectId(v);
                  setSelectedContractorId(ALL_CONTRACTORS);
                  setPage(1);
                }}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  {projectsForSelector.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex-1 min-w-[220px] flex items-end gap-2">
            <div className="flex-1 min-w-0">
              <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Contractor</Label>
              <div className="mt-1">
                <Combobox
                  className="w-full min-w-[260px] h-10"
                  options={comboboxOptions}
                  value={selectedContractorId}
                  onValueChange={(v) => setSelectedContractorId(v ?? ALL_CONTRACTORS)}
                  placeholder="All Contractors"
                  searchPlaceholder="Search contractors…"
                  emptyText="No contractors found."
                  disabled={!effectiveProjectId || contractorsLoading}
                  renderValue={(opt) => (opt ? opt.label : "All Contractors")}
                />
              </div>
            </div>
            {selectedContractor && canEditDelete && (
              <div className="flex items-center gap-1 shrink-0 pb-0.5">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9"
                  onClick={() => { setEditContractor(selectedContractor); setEditOpen(true); }}
                  title="Edit contractor"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 text-destructive hover:text-destructive"
                  onClick={() => handleDeleteContractorClick(selectedContractor)}
                  disabled={selectedContractor.remaining > 0}
                  title={selectedContractor.remaining > 0 ? "Clear balance before deleting" : "Delete contractor"}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
          {selectedContractorId === ALL_CONTRACTORS && (
            <div className="flex items-center gap-2 print-hidden">
              <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Month</Label>
              <div className="flex items-center border-2 border-border">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 rounded-none"
                  onClick={() => setCurrentMonth(prevMonth(currentMonth))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="min-w-[140px] px-3 py-2 text-sm font-medium text-center">
                  {getMonthLabel(currentMonth)}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 rounded-none"
                  onClick={() => setCurrentMonth(nextMonth(currentMonth))}
                  disabled={!canGoNext}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>

        {!effectiveProjectId && (
          <p className="text-muted-foreground p-4">Select a project to view contractors and ledger.</p>
        )}

        {effectiveProjectId && (contractorsError || ledgerError) && (
          <p className="text-destructive text-sm p-4">{contractorsError ?? ledgerError}</p>
        )}

        {effectiveProjectId && !contractorsError && !ledgerError && (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 print-hidden">
              <StatCard label="Total Amount" value={kpiTotal} />
              <StatCard label="Paid Amount" value={kpiPaid} variant="success" />
              <StatCard label="Remaining Balance" value={kpiRemaining} variant={kpiRemainingVariant} />
            </div>

            <div className="border-2 border-border">
              <div className="border-b-2 border-border bg-secondary px-4 py-3">
                <h2 className="text-sm font-bold uppercase tracking-wider">
                  Ledger
                  {selectedContractor
                    ? ` — Full History (${selectedContractor.name})`
                    : ` — ${getMonthLabel(currentMonth)}`}
                </h2>
              </div>
              <div className="overflow-x-auto">
                {ledgerLoading ? (
                  <p className="px-4 py-8 text-center text-muted-foreground">Loading ledger…</p>
                ) : (
                  <table className="w-full text-base">
                    <thead>
                      <tr className="border-b-2 border-border bg-primary text-primary-foreground">
                        {selectedContractorId === ALL_CONTRACTORS && (
                          <th className="px-4 py-2.5 text-left text-sm font-bold uppercase tracking-wider">Contractor</th>
                        )}
                        {selectedContractorId !== ALL_CONTRACTORS && (
                          <th className="px-4 py-2.5 text-left text-sm font-bold uppercase tracking-wider">Month</th>
                        )}
                        <th className="px-4 py-2.5 text-left text-sm font-bold uppercase tracking-wider">Date</th>
                        <th className="px-4 py-2.5 text-left text-sm font-bold uppercase tracking-wider">Type</th>
                        <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Amount</th>
                        <th className="px-4 py-2.5 text-left text-sm font-bold uppercase tracking-wider">Remarks / Ref</th>
                        {canEditDelete && (
                          <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider print-hidden">Actions</th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {!ledger || ledger.rows.length === 0 ? (
                        <tr>
                          <td
                            colSpan={canEditDelete ? 6 : 5}
                            className="px-4 py-8 text-center text-muted-foreground"
                          >
                            {selectedContractor
                              ? `No entries or payments for ${selectedContractor.name}. Add an entry above.`
                              : `No entries or payments for this month. Add an entry above.`}
                          </td>
                        </tr>
                      ) : (
                        ledger.rows.map((row) => (
                          <tr
                            key={`${row.type}-${row.id}`}
                            className={`border-b border-border hover:bg-accent/50 transition-colors ${selectedContractorId === ALL_CONTRACTORS && row.contractorId ? "cursor-pointer" : ""}`}
                            onClick={() => handleRowClick(row)}
                            role={selectedContractorId === ALL_CONTRACTORS && row.contractorId ? "button" : undefined}
                          >
                            {selectedContractorId === ALL_CONTRACTORS && (
                              <td className="px-4 py-3">
                                <span className="font-bold">{row.contractorName ?? "—"}</span>
                              </td>
                            )}
                            {selectedContractorId !== ALL_CONTRACTORS && (
                              <td className="px-4 py-3 text-sm">{getMonthLabelFromDate(row.date)}</td>
                            )}
                            <td className="px-4 py-3 text-sm">{row.date}</td>
                            <td className="px-4 py-3">
                              <span
                                className={`text-xs font-bold uppercase px-1.5 py-0.5 rounded ${
                                  row.type === "payment" ? "bg-success/20 text-success" : "bg-primary/10"
                                }`}
                              >
                                {row.type === "payment" ? "Payment" : "Entry"}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-sm">{formatCurrency(row.amount)}</td>
                            <td className="px-4 py-3 text-sm text-muted-foreground">
                              {row.type === "payment" ? (row.referenceId ?? "—") : (row.remarks ?? "—")}
                            </td>
                            {canEditDelete && (
                              <td className="px-4 py-3 text-right print-hidden" onClick={(e) => e.stopPropagation()}>
                                {row.type === "entry" && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => setDeleteEntryState(row)}
                                    title="Delete entry"
                                  >
                                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                  </Button>
                                )}
                                {row.type === "payment" && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => setDeletePaymentState(row)}
                                    title="Delete payment"
                                  >
                                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                  </Button>
                                )}
                              </td>
                            )}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                )}
              </div>
              {ledger && ledger.rows.length > 0 && (
                <div className="print-hidden">
                  <TablePagination
                    pageSize={pageSize}
                    onPageSizeChange={handlePageSizeChange}
                    page={page}
                    totalPages={totalPages}
                    totalItems={ledger.total}
                    onPrevious={() => setPage((p) => Math.max(1, p - 1))}
                    onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
                    canPrevious={page > 1}
                    canNext={page < totalPages}
                    pageSizeOptions={PAGE_SIZE_OPTIONS}
                    startIndexOneBased={ledger.total === 0 ? 0 : (page - 1) * pageSize + 1}
                    endIndex={Math.min(page * pageSize, ledger.total)}
                  />
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
