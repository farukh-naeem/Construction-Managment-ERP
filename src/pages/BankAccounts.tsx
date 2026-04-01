import { useState, useEffect } from "react";
import Layout from "@/components/Layout";
import PageHeader from "@/components/PageHeader";
import StatusBadge from "@/components/StatusBadge";
import { formatCurrency } from "@/lib/mock-data";
import { useBankAccounts } from "@/hooks/useBankAccounts";
import { useBankTransactions } from "@/hooks/useBankTransactions";
import { useProjects } from "@/hooks/useProjects";
import { AddBankAccountDialog } from "@/components/dialogs/AddBankAccountDialog";
import { AddBankTransactionDialog } from "@/components/dialogs/AddBankTransactionDialog";
import { EditBankAccountDialog } from "@/components/dialogs/EditBankAccountDialog";
import { TablePagination } from "@/components/TablePagination";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Pencil, Trash2, Printer } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { deleteBankAccount } from "@/services/bankAccountService";
import { deleteBankTransaction, listBankTransactions } from "@/services/bankTransactionService";
import type { ApiBankAccount } from "@/services/bankAccountService";
import type { ApiBankTransaction } from "@/services/bankTransactionService";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

const PAGE_SIZE_OPTIONS = [12, 24, 50, 100];
const PRINT_FETCH_PAGE_SIZE = 100;

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDateForPrint(date: string) {
  return date;
}

function formatAmount(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

export default function BankAccounts() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "Super Admin";

  const { accounts, loading: accountsLoading, error: accountsError, refetch: refetchAccounts } = useBankAccounts();
  const { projects } = useProjects();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);
  const [searchQuery, setSearchQuery] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const { rows, total, loading: txLoading, refetch: refetchTx } = useBankTransactions({
    page,
    pageSize,
    search: searchQuery || undefined,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
  });

  const [addAccountOpen, setAddAccountOpen] = useState(false);
  const [addTxOpen, setAddTxOpen] = useState(false);
  const [editAccountOpen, setEditAccountOpen] = useState(false);
  const [editAccount, setEditAccount] = useState<ApiBankAccount | null>(null);
  const [deleteAccount, setDeleteAccount] = useState<ApiBankAccount | null>(null);
  const [deleteTx, setDeleteTx] = useState<ApiBankTransaction | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [printAccountId, setPrintAccountId] = useState<string | null>(null);
  const [printStartDate, setPrintStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [printEndDate, setPrintEndDate] = useState(new Date().toISOString().slice(0, 10));
  const [printLoading, setPrintLoading] = useState(false);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, startDate, endDate]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const startIndexOneBased = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const endIndex = Math.min(page * pageSize, total);

  const handleDeleteAccount = async () => {
    if (!deleteAccount) return;
    setDeleteLoading(true);
    try {
      await deleteBankAccount(deleteAccount.id);
      toast.success("Account deleted");
      setDeleteAccount(null);
      refetchAccounts();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete account");
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleDeleteTx = async () => {
    if (!deleteTx) return;
    setDeleteLoading(true);
    try {
      await deleteBankTransaction(deleteTx.id);
      toast.success("Transaction deleted");
      setDeleteTx(null);
      refetchTx();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete transaction");
    } finally {
      setDeleteLoading(false);
    }
  };

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setPage(1);
  };

  const handleSuccess = () => {
    refetchAccounts();
    refetchTx();
  };

  const handleOpenPrintDialog = () => {
    const today = new Date().toISOString().slice(0, 10);
    setPrintStartDate(today);
    setPrintEndDate(today);
    setPrintAccountId(accounts[0]?.id ?? null);
    setPrintDialogOpen(true);
  };

  const handlePrintBankReport = async () => {
    if (!printAccountId) {
      toast.error("Select a bank account");
      return;
    }
    if (!printStartDate || !printEndDate) {
      toast.error("Select date range");
      return;
    }
    if (printStartDate > printEndDate) {
      toast.error("Start date cannot be after end date");
      return;
    }

    const selectedAccount = accounts.find((a) => a.id === printAccountId);
    if (!selectedAccount) {
      toast.error("Selected bank account not found");
      return;
    }

    setPrintLoading(true);
    try {
      const firstPage = await listBankTransactions({
        page: 1,
        pageSize: PRINT_FETCH_PAGE_SIZE,
        startDate: printStartDate,
        endDate: printEndDate,
      });

      const allRows: ApiBankTransaction[] = [...firstPage.rows];
      const totalPages = Math.max(1, Math.ceil(firstPage.total / PRINT_FETCH_PAGE_SIZE));
      for (let currentPage = 2; currentPage <= totalPages; currentPage += 1) {
        const pageResult = await listBankTransactions({
          page: currentPage,
          pageSize: PRINT_FETCH_PAGE_SIZE,
          startDate: printStartDate,
          endDate: printEndDate,
        });
        allRows.push(...pageResult.rows);
      }

      const accountRows = allRows
        .filter((tx) => tx.accountId === printAccountId)
        .sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? -1 : 1));

      const projectColumns = projects.map((project) => ({ id: project.id, name: project.name }));
      const today = new Date().toISOString().slice(0, 10);
      const openingRowCells = projectColumns.map(() => `<td class="text-center">-</td>`).join("");

      const txRowsHtml = accountRows
        .map((tx) => {
          const isInflow = tx.type === "inflow";
          const isProjectOutflow = !isInflow && Boolean(tx.projectId);
          const particularsParts = isInflow
            ? [tx.source, tx.remarks, tx.referenceId]
            : isProjectOutflow
              ? [tx.referenceId, tx.remarks]
              : [tx.destination, tx.referenceId, tx.remarks];
          const particulars = particularsParts.filter(Boolean).join(" + ") || "-";
          const receiveCell = isInflow ? formatAmount(tx.amount) : "-";
          const projectCells = projectColumns
            .map((project) => {
              if (!isInflow && tx.projectId === project.id) {
                return `<td class="text-right amount">${formatAmount(tx.amount)}</td>`;
              }
              return `<td class="text-center">-</td>`;
            })
            .join("");

          return `
            <tr>
              <td>${escapeHtml(formatDateForPrint(tx.date))}</td>
              <td>${escapeHtml(particulars)}</td>
              <td class="text-right amount">${escapeHtml(receiveCell)}</td>
              ${projectCells}
            </tr>
          `;
        })
        .join("");

      const projectHeaderHtml = projectColumns.map((project) => `<th>${escapeHtml(project.name)}</th>`).join("");
      const tableRowsHtml = `
        <tr>
          <td>${escapeHtml(today)}</td>
          <td>Opening Balance</td>
          <td class="text-right amount">${formatAmount(selectedAccount.currentBalance)}</td>
          ${openingRowCells}
        </tr>
        ${txRowsHtml}
      `;

      const printWindow = window.open("", "_blank");
      if (!printWindow) {
        toast.error("Popup blocked. Please allow popups to print.");
        return;
      }

      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>${escapeHtml(selectedAccount.name)} Bank Report</title>
          <style>
            body { font-family: Arial, Helvetica, sans-serif; color: #000; padding: 20px; }
            .header { text-align: center; margin-bottom: 12px; }
            .header h1 { font-size: 18px; margin: 0 0 6px; }
            .header p { margin: 2px 0; font-size: 12px; }
            table { width: 100%; border-collapse: collapse; }
            th, td { border: 1px solid #000; padding: 6px 8px; font-size: 12px; vertical-align: top; }
            th { background: #efefef; text-transform: uppercase; }
            td.amount { white-space: nowrap; }
            .text-right { text-align: right; }
            .text-center { text-align: center; }
            @media print { body { padding: 0; } }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>${escapeHtml(selectedAccount.name)} (${escapeHtml(selectedAccount.accountNumber || "Account")})</h1>
            <p>Date Range: ${escapeHtml(printStartDate)} to ${escapeHtml(printEndDate)}</p>
          </div>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Particulars</th>
                <th>Receive</th>
                ${projectHeaderHtml}
              </tr>
            </thead>
            <tbody>
              ${tableRowsHtml}
            </tbody>
          </table>
        </body>
        </html>
      `);
      printWindow.document.close();
      printWindow.print();
      setPrintDialogOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to prepare print report");
    } finally {
      setPrintLoading(false);
    }
  };

  return (
    <Layout>
      <PageHeader
        title="Bank & Accounts"
        subtitle="Company-level bank account management"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={handleOpenPrintDialog}>
              <Printer className="h-4 w-4 mr-1" />
              Print
            </Button>
            <Button variant="outline" size="sm" onClick={() => setAddTxOpen(true)} disabled={!isSuperAdmin}>
              Add Transaction
            </Button>
            <Button variant="warning" size="sm" onClick={() => setAddAccountOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />Add Account
            </Button>
          </>
        }
      />
      <AddBankAccountDialog open={addAccountOpen} onOpenChange={setAddAccountOpen} onSuccess={handleSuccess} />
      <AddBankTransactionDialog
        open={addTxOpen}
        onOpenChange={setAddTxOpen}
        accounts={accounts}
        projects={projects}
        onSuccess={handleSuccess}
      />
      <EditBankAccountDialog
        open={editAccountOpen}
        onOpenChange={setEditAccountOpen}
        account={editAccount}
        onSuccess={handleSuccess}
      />
      <Dialog open={printDialogOpen} onOpenChange={setPrintDialogOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-lg">
          <DialogHeader>
            <DialogTitle>Print Bank Report</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Bank Account</Label>
              <Select
                value={printAccountId ?? ""}
                onValueChange={(value) => setPrintAccountId(value)}
              >
                <SelectTrigger className="mt-1 h-9">
                  <SelectValue placeholder="Select account" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((acc) => (
                    <SelectItem key={acc.id} value={acc.id}>
                      {acc.name} ({acc.accountNumber || "—"})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs">Start Date</Label>
                <Input
                  type="date"
                  value={printStartDate}
                  onChange={(e) => setPrintStartDate(e.target.value)}
                  className="mt-1 h-9"
                />
              </div>
              <div>
                <Label className="text-xs">End Date</Label>
                <Input
                  type="date"
                  value={printEndDate}
                  onChange={(e) => setPrintEndDate(e.target.value)}
                  className="mt-1 h-9"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setPrintDialogOpen(false)} disabled={printLoading}>
              Cancel
            </Button>
            <Button variant="warning" size="sm" onClick={handlePrintBankReport} disabled={printLoading}>
              {printLoading ? "Preparing..." : "Print"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div id="bank-content" className="space-y-6">
        {/* Account Cards */}
        {accountsLoading ? (
          <p className="text-muted-foreground py-8">Loading accounts…</p>
        ) : accountsError ? (
          <p className="text-destructive py-8">{accountsError}</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {accounts.map((acc) => (
              <div key={acc.id} className="rounded-xl border border-border/60 bg-card p-5 shadow-sm transition-all hover:shadow-md space-y-3">
                <div className="flex items-center justify-between">
                  <p className="font-semibold">{acc.name}</p>
                  <div className="flex items-center gap-1">
                    <span className="text-xs font-mono text-muted-foreground">{acc.accountNumber}</span>
                    {isSuperAdmin && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-foreground"
                          onClick={() => {
                            setEditAccount(acc);
                            setEditAccountOpen(true);
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => setDeleteAccount(acc)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                <p className="text-2xl font-bold">{formatCurrency(acc.currentBalance)}</p>
                <div className="flex gap-4 text-xs">
                  <span className="text-success">↑ {formatCurrency(acc.totalInflow)}</span>
                  <span className="text-destructive">↓ {formatCurrency(acc.totalOutflow)}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Transactions */}
        <div className="rounded-xl border border-border/60 bg-card overflow-hidden shadow-sm">
          <div className="border-b border-border/40 bg-muted/30 px-5 py-4 backdrop-blur-sm flex flex-wrap items-center gap-4">
            <h2 className="text-sm font-semibold tracking-tight">Transactions</h2>
            <div className="flex-1 flex flex-wrap items-center gap-3">
              <Input
                placeholder="Search…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="max-w-[180px] h-9"
              />
              <Input
                type="date"
                placeholder="Start Date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="max-w-[140px] h-9"
              />
              <Input
                type="date"
                placeholder="End Date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="max-w-[140px] h-9"
              />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-base">
              <thead>
                <tr className="border-b border-border/40 bg-muted/10 text-muted-foreground">
                  <th className="px-5 py-3 text-left text-sm font-medium">Date</th>
                  <th className="px-5 py-3 text-left text-sm font-medium">Type</th>
                  <th className="px-5 py-3 text-right text-sm font-medium">Amount</th>
                  <th className="px-5 py-3 text-left text-sm font-medium">Source</th>
                  <th className="px-5 py-3 text-left text-sm font-medium">Destination</th>
                  <th className="px-5 py-3 text-left text-sm font-medium">Mode</th>
                  <th className="px-5 py-3 text-left text-sm font-medium">Reference</th>
                  {isSuperAdmin && <th className="px-5 py-3 text-right text-sm font-medium print-hidden">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {txLoading ? (
                  <tr>
                    <td colSpan={isSuperAdmin ? 8 : 7} className="px-5 py-8 text-center text-muted-foreground">
                      Loading transactions…
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={isSuperAdmin ? 8 : 7} className="px-5 py-8 text-center text-muted-foreground">
                      No transactions found
                    </td>
                  </tr>
                ) : (
                  rows.map((tx) => (
                    <tr key={tx.id} className="border-b border-border/40 hover:bg-muted/30 transition-colors">
                      <td className="px-5 py-3.5 text-sm text-muted-foreground">{tx.date}</td>
                      <td className="px-5 py-3.5">
                        <StatusBadge status={tx.type === "inflow" ? "Inflow" : "Outflow"} />
                      </td>
                      <td className="px-5 py-3.5 text-right font-mono text-sm font-medium">{formatCurrency(tx.amount)}</td>
                      <td className="px-5 py-3.5 text-sm text-muted-foreground">{tx.source}</td>
                      <td className="px-5 py-3.5 text-sm text-muted-foreground">{tx.destination}</td>
                      <td className="px-5 py-3.5 text-sm text-muted-foreground">{tx.mode}</td>
                      <td className="px-5 py-3.5 text-sm font-mono text-muted-foreground/70">{[tx.referenceId, tx.remarks].filter(Boolean).join(" — ") || "—"}</td>
                      {isSuperAdmin && (
                        <td className="px-5 py-3.5 text-right print-hidden">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => setDeleteTx(tx)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
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
              pageSizeOptions={PAGE_SIZE_OPTIONS}
              startIndexOneBased={startIndexOneBased}
              endIndex={endIndex}
            />
          </div>
        </div>
      </div>

      <AlertDialog open={!!deleteAccount} onOpenChange={(open) => !open && setDeleteAccount(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete bank account?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {deleteAccount?.name}? This action cannot be undone. If there are linked transactions, deletion will be blocked.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteAccount}
              disabled={deleteLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:pointer-events-none disabled:opacity-50"
            >
              {deleteLoading ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteTx} onOpenChange={(open) => !open && setDeleteTx(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete transaction?</AlertDialogTitle>
            <AlertDialogDescription>
              This will reverse the transaction. Bank and project balances will be updated. If reversing would make any balance negative, deletion will be blocked.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteTx}
              disabled={deleteLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:pointer-events-none disabled:opacity-50"
            >
              {deleteLoading ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}
