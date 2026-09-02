import { useState } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import Layout from "@/components/Layout";
import PageHeader from "@/components/PageHeader";
import StatCard from "@/components/StatCard";
import { formatCurrency, formatQuantity } from "@/lib/mock-data";
import { formatDisplayDate } from "@/lib/pktDate";
import { useCustomers } from "@/hooks/useCustomers";
import { useCustomerLedger } from "@/hooks/useCustomerLedger";
import { CustomerPaymentDialog } from "@/components/dialogs/CustomerPaymentDialog";
import { TablePagination } from "@/components/TablePagination";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/AuthContext";
import { deleteCustomerPayment } from "@/services/customerPaymentService";
import { deleteCustomerSale } from "@/services/customerSaleService";
import { toast } from "sonner";
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

const PAGE_SIZE_OPTIONS = [12, 24, 50, 100];

export default function CustomerLedger() {
  const { customerId } = useParams<{ customerId: string }>();
  const [searchParams] = useSearchParams();
  const fromReceivables = searchParams.get("returnTo") === "receivables";
  const { user } = useAuth();
  const canEditDelete = user?.role !== "Site Manager";

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const { customers, loading: customerLoading, refetch: refetchCustomers } = useCustomers();
  const customer = customers.find((c) => c.id === customerId);

  const { ledger, loading: ledgerLoading, refetch } = useCustomerLedger(
    customerId ?? "",
    page,
    pageSize,
    startDate || undefined,
    endDate || undefined
  );

  const handleStartDateChange = (value: string) => {
    setStartDate(value);
    setPage(1);
  };

  const handleEndDateChange = (value: string) => {
    setEndDate(value);
    setPage(1);
  };

  const total = ledger?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const startIndexOneBased = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const endIndex = Math.min(page * pageSize, total);

  const [paymentOpen, setPaymentOpen] = useState(false);
  const [deletePaymentId, setDeletePaymentId] = useState<string | null>(null);
  const [deleteSaleId, setDeleteSaleId] = useState<string | null>(null);

  const refreshAll = () => {
    refetch();
    refetchCustomers();
  };

  const handleDeletePayment = async () => {
    if (!deletePaymentId || !customerId) return;
    try {
      await deleteCustomerPayment(customerId, deletePaymentId);
      toast.success("Payment deleted — bank inflow reversed");
      setDeletePaymentId(null);
      refreshAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete payment");
      setDeletePaymentId(null);
    }
  };

  const handleDeleteSale = async () => {
    if (!deleteSaleId) return;
    try {
      await deleteCustomerSale(deleteSaleId);
      toast.success("Sale deleted — stock restored");
      setDeleteSaleId(null);
      refreshAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete sale");
      setDeleteSaleId(null);
    }
  };

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setPage(1);
  };

  if (!customerId) return null;
  if (customerLoading) return <Layout><p className="text-muted-foreground p-6">Loading customer…</p></Layout>;
  if (!customer) return <Layout><p className="text-destructive p-6">Customer not found.</p></Layout>;

  const totalSold = ledger?.totalSold ?? customer.totalSold;
  const totalReceived = ledger?.totalReceived ?? customer.totalReceived;
  const signedBalance = ledger?.balance ?? customer.balance;
  const receivable = Math.max(0, -signedBalance);
  const credit = Math.max(0, signedBalance);
  const displayedTotals = (ledger?.rows ?? []).reduce(
    (totals, row) => ({
      sold: totals.sold + (row.type === "sale" ? row.totalPrice ?? 0 : 0),
      received: totals.received + (row.type === "payment" ? row.amount ?? 0 : 0),
    }),
    { sold: 0, received: 0 }
  );

  return (
    <Layout>
      <Link
        to={fromReceivables ? "/receivables" : "/customers"}
        className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft className="h-3 w-3" /> {fromReceivables ? "Back to Receivables" : "Back to Customers"}
      </Link>

      <PageHeader
        title={`${customer.name} — Ledger`}
        subtitle={customer.description}
        printTargetId="customer-ledger"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="warning" size="sm" onClick={() => setPaymentOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />Record Payment
            </Button>
          </div>
        }
      />

      <CustomerPaymentDialog
        open={paymentOpen}
        onOpenChange={setPaymentOpen}
        customer={{ ...customer, totalSold, totalReceived, balance: signedBalance }}
        onSuccess={refreshAll}
      />

      <AlertDialog open={!!deletePaymentId} onOpenChange={(open) => !open && setDeletePaymentId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete payment record?</AlertDialogTitle>
            <AlertDialogDescription>
              This reverses the payment, removes the matching bank inflow, and lowers the customer's balance.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeletePayment} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete Payment
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteSaleId} onOpenChange={(open) => !open && setDeleteSaleId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this sale?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes every item line recorded in the same sale, restores their stock, and removes the
              charge from the customer's balance.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteSale} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete &amp; Restore Stock
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="flex flex-wrap items-end gap-3 mb-4 print-hidden">
        <div className="min-w-[180px]">
          <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Start date</Label>
          <Input type="date" className="mt-1" value={startDate} onChange={(e) => handleStartDateChange(e.target.value)} />
        </div>
        <div className="min-w-[180px]">
          <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">End date</Label>
          <Input type="date" className="mt-1" value={endDate} min={startDate} onChange={(e) => handleEndDateChange(e.target.value)} />
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

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-6">
        <StatCard label="Total Sold" value={formatCurrency(totalSold)} />
        <StatCard label="Total Received" value={formatCurrency(totalReceived)} variant="success" />
        <StatCard
          label="Running Balance"
          value={formatCurrency(signedBalance)}
          variant={signedBalance < 0 ? "destructive" : "success"}
        />
        {receivable > 0 && <StatCard label="Receivable" value={formatCurrency(receivable)} variant="destructive" />}
        {credit > 0 && <StatCard label="Credit" value={formatCurrency(credit)} variant="success" />}
        {startDate && (
          <StatCard label="Previous Balance" value={formatCurrency(ledger?.previousBalance ?? 0)} />
        )}
      </div>

      <div id="customer-ledger" className="border-2 border-border">
        <div className="overflow-x-auto">
          {ledgerLoading ? (
            <p className="px-4 py-8 text-center text-muted-foreground">Loading ledger…</p>
          ) : (
            <table className="w-full text-base">
              <thead>
                <tr className="border-b-2 border-border bg-primary text-primary-foreground">
                  <th className="px-4 py-2.5 text-left text-sm font-bold uppercase tracking-wider">Date</th>
                  <th className="px-4 py-2.5 text-left text-sm font-bold uppercase tracking-wider">Method</th>
                  <th className="px-4 py-2.5 text-left text-sm font-bold uppercase tracking-wider">Item / Reference</th>
                  <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Qty</th>
                  <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Unit Price</th>
                  <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Sale Amount</th>
                  <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Received</th>
                  <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Balance</th>
                  {canEditDelete && (
                    <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider print-hidden">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {!ledger || ledger.rows.length === 0 ? (
                  <tr>
                    <td colSpan={canEditDelete ? 9 : 8} className="px-4 py-8 text-center text-muted-foreground">
                      No transactions for this customer yet.
                    </td>
                  </tr>
                ) : (
                  <>
                    {ledger.rows.map((row) => (
                      <tr key={`${row.type}-${row.id}`} className="border-b border-border hover:bg-accent/50 transition-colors">
                        <td className="px-4 py-3 text-sm">{formatDisplayDate(row.date)}</td>
                        <td className="px-4 py-3 text-sm">
                          {row.type === "payment"
                            ? [row.paymentMethod, row.accountName].filter(Boolean).join(" — ")
                            : "—"}
                        </td>
                        <td className="px-4 py-3 text-sm font-bold">
                          {row.type === "sale" ? row.itemName : (row.remarks || row.referenceId || "—")}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-sm">
                          {row.type === "sale" ? formatQuantity(row.quantity!) : "—"}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-sm">
                          {row.type === "sale" ? formatCurrency(row.unitPrice!) : "—"}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-sm text-destructive">
                          {row.type === "sale" ? formatCurrency(row.totalPrice!) : "—"}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-sm text-success">
                          {row.type === "payment" ? formatCurrency(row.amount!) : "—"}
                        </td>
                        <td className={`px-4 py-3 text-right font-mono text-sm font-bold ${row.runningTotal < 0 ? "text-destructive" : ""}`}>
                          {formatCurrency(row.runningTotal)}
                        </td>
                        {canEditDelete && (
                          <td className="px-4 py-3 text-right print-hidden">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() =>
                                row.type === "payment"
                                  ? setDeletePaymentId(row.id)
                                  : setDeleteSaleId(row.saleId ?? null)
                              }
                              title={row.type === "payment" ? "Delete payment" : "Delete the whole sale"}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </td>
                        )}
                      </tr>
                    ))}
                    <tr className="border-t-2 border-border bg-muted/30 font-bold">
                      <td colSpan={5} className="px-4 py-3 text-right text-sm">Total</td>
                      <td className="px-4 py-3 text-right font-mono text-sm text-destructive">
                        {formatCurrency(displayedTotals.sold)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm text-success">
                        {formatCurrency(displayedTotals.received)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm">
                        {formatCurrency((ledger?.previousBalance ?? 0) + displayedTotals.received - displayedTotals.sold)}
                      </td>
                      {canEditDelete && <td className="print-hidden" />}
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          )}
        </div>
        {!ledgerLoading && ledger && ledger.rows.length > 0 && (
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
              pageSizeOptions={PAGE_SIZE_OPTIONS}
              startIndexOneBased={startIndexOneBased}
              endIndex={endIndex}
            />
          </div>
        )}
      </div>
    </Layout>
  );
}
