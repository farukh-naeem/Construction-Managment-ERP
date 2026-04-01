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
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { deleteBankAccount } from "@/services/bankAccountService";
import { deleteBankTransaction } from "@/services/bankTransactionService";
import type { ApiBankAccount } from "@/services/bankAccountService";
import type { ApiBankTransaction } from "@/services/bankTransactionService";
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

  return (
    <Layout>
      <PageHeader
        title="Bank & Accounts"
        subtitle="Company-level bank account management"
        printTargetId="bank-content"
        actions={
          <>
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
