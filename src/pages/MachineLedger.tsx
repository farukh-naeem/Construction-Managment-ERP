import { useState, useEffect } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import Layout from "@/components/Layout";
import PageHeader from "@/components/PageHeader";
import StatCard from "@/components/StatCard";
import { formatCurrencyDecimal } from "@/lib/mock-data";
import { formatDisplayDate } from "@/lib/pktDate";
import { getMachine } from "@/services/machinesService";
import { useMachineLedger } from "@/hooks/useMachineLedger";
import { AddMachineLedgerEntryDialog } from "@/components/dialogs/AddMachineLedgerEntryDialog";
import { MachinePaymentDialog } from "@/components/dialogs/MachinePaymentDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Plus, ArrowLeft, Banknote, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteMachineLedgerEntry, deleteMachinePayment } from "@/services/machinesService";
import { useAuth } from "@/context/AuthContext";
import type { ApiMachineWithTotals, ApiMachineLedgerEntryRow, ApiMachineLedgerPaymentRow } from "@/services/machinesService";
import { useDieselItem } from "@/hooks/useDieselItem";

const DEFAULT_PAGE_SIZE = 12;
const PAGE_SIZE_OPTIONS = [12, 24, 50, 100];

export default function MachineLedger() {
  const { machineId } = useParams();
  const [searchParams] = useSearchParams();
  const returnTo = searchParams.get("returnTo");
  const backToPath = returnTo === "liabilities" ? "/liabilities" : returnTo === "receivables" ? "/receivables" : "/machinery";
  const backLabel = returnTo === "liabilities" ? "Back to Liabilities" : returnTo === "receivables" ? "Back to Receivables" : "Back to Machinery";
  const { user: currentUser } = useAuth();
  const canDeleteEntry = currentUser?.role !== "Site Manager";

  const [machine, setMachine] = useState<ApiMachineWithTotals | null>(null);
  const { dieselItem, refetch: refetchDiesel } = useDieselItem(machine?.projectId);
  const [machineLoading, setMachineLoading] = useState(true);
  const [addEntryOpen, setAddEntryOpen] = useState(false);
  const [addPaymentOpen, setAddPaymentOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [deleteEntryState, setDeleteEntryState] = useState<ApiMachineLedgerEntryRow | null>(null);
  const [deletePaymentState, setDeletePaymentState] = useState<ApiMachineLedgerPaymentRow | null>(null);

  const { rows, total, totalHours, totalCost, totalPaid, remaining, previousBalance, loading, error, refetch } =
    useMachineLedger(machineId, page, pageSize, startDate || undefined, endDate || undefined);
  // remaining is clamped to 0 by the backend, so paid-over-cost only shows up as a gap here — recover it as an advance.
  const advance = Math.max(0, totalPaid - totalCost);

  const handleStartDateChange = (value: string) => {
    setStartDate(value);
    setPage(1);
  };

  const handleEndDateChange = (value: string) => {
    setEndDate(value);
    setPage(1);
  };

  useEffect(() => {
    if (!machineId) {
      setMachine(null);
      setMachineLoading(false);
      return;
    }
    let cancelled = false;
    setMachineLoading(true);
    getMachine(machineId)
      .then((m) => {
        if (!cancelled) setMachine(m);
      })
      .catch(() => {
        if (!cancelled) setMachine(null);
      })
      .finally(() => {
        if (!cancelled) setMachineLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [machineId]);

  const handleSuccess = () => {
    refetch();
    if (machineId) {
      getMachine(machineId).then(setMachine);
    }
    void refetchDiesel();
  };

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setPage(1);
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const startIndexOneBased = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const endIndex = Math.min(page * pageSize, total);

  const handleDeleteEntryClick = (entry: ApiMachineLedgerEntryRow) => {
    setDeleteEntryState(entry);
  };

  const handleDeleteEntryConfirm = async () => {
    if (!deleteEntryState || !machineId) return;
    try {
      await deleteMachineLedgerEntry(machineId, deleteEntryState.id);
      toast.success("Ledger entry deleted");
      setDeleteEntryState(null);
      handleSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete entry");
    }
  };

  const handleDeletePaymentClick = (payment: ApiMachineLedgerPaymentRow) => {
    setDeletePaymentState(payment);
  };

  const handleDeletePaymentConfirm = async () => {
    if (!deletePaymentState || !machineId) return;
    try {
      await deleteMachinePayment(machineId, deletePaymentState.id);
      toast.success("Payment deleted");
      setDeletePaymentState(null);
      handleSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete payment");
    }
  };

  if (!machineId) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-12">
          <p className="text-muted-foreground">Invalid machine.</p>
          <Link to={backToPath} className="ml-2 text-primary hover:underline">{backLabel}</Link>
        </div>
      </Layout>
    );
  }

  if (machineLoading && !machine) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-12">
          <p className="text-muted-foreground">Loading…</p>
        </div>
      </Layout>
    );
  }

  if (!machine) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-12">
          <p className="text-muted-foreground">Machine not found.</p>
          <Link to={backToPath} className="ml-2 text-primary hover:underline">{backLabel}</Link>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <Link to={backToPath} className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="h-3 w-3" /> {backLabel}
      </Link>

      <PageHeader
        title={`${machine.name} — Ledger`}
        subtitle={`${machine.ownership} | Rate: ${formatCurrencyDecimal(machine.hourlyRate)}/hr`}
        printTargetId="machine-ledger"
        actions={
          <div className="flex gap-2">
            <Button variant="warning" size="sm" onClick={() => setAddEntryOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />Add Entry
            </Button>
            <Button variant="outline" size="sm" onClick={() => setAddPaymentOpen(true)}>
              <Banknote className="h-4 w-4 mr-1" />Add Payment
            </Button>
          </div>
        }
      />

      <AddMachineLedgerEntryDialog
        open={addEntryOpen}
        onOpenChange={setAddEntryOpen}
        machine={machine}
        dieselItem={dieselItem}
        onSuccess={handleSuccess}
      />
      <MachinePaymentDialog
        open={addPaymentOpen}
        onOpenChange={setAddPaymentOpen}
        machine={machine}
        remainingBalance={remaining}
        onSuccess={handleSuccess}
      />
      <AlertDialog open={!!deleteEntryState} onOpenChange={(open) => !open && setDeleteEntryState(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete ledger entry?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the entry ({formatDisplayDate(deleteEntryState?.date)}, {deleteEntryState?.hoursWorked} hrs, {formatCurrencyDecimal(deleteEntryState?.totalCost ?? 0)}). Balances will be recalculated. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteEntryConfirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
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
              This will remove the payment record ({formatDisplayDate(deletePaymentState?.date)}, {formatCurrencyDecimal(deletePaymentState?.amount ?? 0)}). Balances will be recalculated. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeletePaymentConfirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="flex flex-wrap items-end gap-3 mb-4 print-hidden">
        <div className="min-w-[180px]">
          <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Start date</Label>
          <Input
            type="date"
            className="mt-1"
            value={startDate}
            onChange={(e) => handleStartDateChange(e.target.value)}
          />
        </div>
        <div className="min-w-[180px]">
          <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">End date</Label>
          <Input
            type="date"
            className="mt-1"
            value={endDate}
            min={startDate}
            onChange={(e) => handleEndDateChange(e.target.value)}
          />
        </div>
        {(startDate || endDate) && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setStartDate("");
              setEndDate("");
              setPage(1);
            }}
          >
            Clear filter
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5 mb-6 print-hidden">
        <StatCard label="Total Hours" value={totalHours.toString()} variant="info" />
        <StatCard label="Total Diesel (L)" value={(machine.totalDiesel ?? 0).toString()} variant="info" />
        <StatCard label="Total Cost" value={formatCurrencyDecimal(totalCost)} />
        <StatCard label="Total Paid" value={formatCurrencyDecimal(totalPaid)} variant="success" />
        {advance > 0 ? (
          <StatCard label="Advance" value={formatCurrencyDecimal(advance)} variant="success" />
        ) : (
          <StatCard label="Pending" value={formatCurrencyDecimal(remaining)} variant={remaining > 0 ? "destructive" : "default"} />
        )}
        {startDate && (
          <StatCard label="Previous Balance" value={formatCurrencyDecimal(previousBalance)} variant="default" />
        )}
      </div>

      <div id="machine-ledger" className="border-2 border-border">
        <div className="overflow-x-auto">
          <table className="w-full text-base">
            <thead>
              <tr className="border-b-2 border-border bg-primary text-primary-foreground">
                <th className="px-4 py-2.5 text-left text-sm font-bold uppercase tracking-wider">Date</th>
                <th className="px-4 py-2.5 text-left text-sm font-bold uppercase tracking-wider">Remarks</th>
                <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Hours</th>
                <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Total Cost</th>
                <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Paid</th>
                <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Total</th>
                {canDeleteEntry && (
                  <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider print-hidden">Actions</th>
                )}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={canDeleteEntry ? 7 : 6} className="px-4 py-8 text-center text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={canDeleteEntry ? 7 : 6} className="px-4 py-8 text-center text-destructive">
                    {error}
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={canDeleteEntry ? 7 : 6} className="px-4 py-8 text-center text-muted-foreground">
                    No ledger entries yet.
                  </td>
                </tr>
              ) : (
                rows.map((row) =>
                  row.type === "entry" ? (
                    <tr key={`entry-${row.id}`} className="border-b border-border hover:bg-accent/50 transition-colors">
                      <td className="px-4 py-3 text-sm">{formatDisplayDate(row.date)}</td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">{row.remarks || "—"}</td>
                      <td className="px-4 py-3 text-right font-mono text-sm">{row.hoursWorked}</td>
                      <td className="px-4 py-3 text-right font-mono text-sm font-bold">{formatCurrencyDecimal(row.totalCost)}</td>
                      <td className="px-4 py-3 text-right font-mono text-sm text-muted-foreground">—</td>
                      <td className="px-4 py-3 text-right font-mono text-sm font-bold">{formatCurrencyDecimal(row.runningTotal)}</td>
                      {canDeleteEntry && (
                        <td className="px-4 py-3 text-right print-hidden">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => handleDeleteEntryClick(row)}
                            aria-label="Delete entry"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </td>
                      )}
                    </tr>
                  ) : (
                    <tr key={`payment-${row.id}`} className="border-b border-border hover:bg-accent/50 transition-colors bg-muted/30">
                      <td className="px-4 py-3 text-sm">{formatDisplayDate(row.date)}</td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        Payment{row.paymentMethod ? ` (${row.paymentMethod})` : ""}{row.referenceId ? ` — ${row.referenceId}` : ""}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm">—</td>
                      <td className="px-4 py-3 text-right font-mono text-sm">—</td>
                      <td className="px-4 py-3 text-right font-mono text-sm text-success">{formatCurrencyDecimal(row.amount)}</td>
                      <td className="px-4 py-3 text-right font-mono text-sm font-bold">{formatCurrencyDecimal(row.runningTotal)}</td>
                      {canDeleteEntry && (
                        <td className="px-4 py-3 text-right print-hidden">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => handleDeletePaymentClick(row)}
                            aria-label="Delete payment"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </td>
                      )}
                    </tr>
                  )
                )
              )}
            </tbody>
            {!loading && !error && rows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/30 font-bold">
                  <td colSpan={2} className="px-4 py-3 text-right text-sm uppercase tracking-wider">Total</td>
                  <td className="px-4 py-3 text-right font-mono text-sm">{totalHours}</td>
                  <td className="px-4 py-3 text-right font-mono text-sm">{formatCurrencyDecimal(totalCost)}</td>
                  <td className="px-4 py-3 text-right font-mono text-sm text-success">{formatCurrencyDecimal(totalPaid)}</td>
                  <td className="px-4 py-3" />
                  {canDeleteEntry && <td className="print-hidden" />}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <div className="print-hidden">
          <TablePagination
            pageSize={pageSize}
            onPageSizeChange={handlePageSizeChange}
            page={page}
            totalPages={totalPages}
            totalItems={total}
            onPrevious={() => setPage((p) => Math.max(1, p - 1))}
            onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
            canPrevious={page > 1}
            canNext={page < totalPages}
            startIndexOneBased={startIndexOneBased}
            endIndex={endIndex}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
          />
        </div>
      </div>
    </Layout>
  );
}
