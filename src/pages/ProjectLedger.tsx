import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import Layout from "@/components/Layout";
import PageHeader from "@/components/PageHeader";
import StatCard from "@/components/StatCard";
import { formatCurrency } from "@/lib/mock-data";
import { useProjectLedger } from "@/hooks/useProjectLedger";
import { ManualBalanceAdjustmentDialog } from "@/components/dialogs/ManualBalanceAdjustmentDialog";
import { TablePagination } from "@/components/TablePagination";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Plus, Pencil, Trash2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { deleteProjectBalanceAdjustment } from "@/services/projectLedgerService";
import type { ProjectLedgerRow } from "@/services/projectLedgerService";
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

export default function ProjectLedger() {
  const { projectId } = useParams<{ projectId: string }>();
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "Super Admin";

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);

  const { ledger, loading, error, refetch } = useProjectLedger(projectId ?? undefined, { page, pageSize });

  const [addAdjustmentOpen, setAddAdjustmentOpen] = useState(false);
  const [editAdjustment, setEditAdjustment] = useState<ProjectLedgerRow | null>(null);
  const [deleteAdjustment, setDeleteAdjustment] = useState<ProjectLedgerRow | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const total = ledger?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const startIndexOneBased = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const endIndex = Math.min(page * pageSize, total);

  const handleDeleteAdjustment = async () => {
    if (!deleteAdjustment || !projectId) return;
    setDeleteLoading(true);
    try {
      await deleteProjectBalanceAdjustment(projectId, deleteAdjustment.id);
      toast.success("Adjustment deleted");
      setDeleteAdjustment(null);
      refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete adjustment");
    } finally {
      setDeleteLoading(false);
    }
  };

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setPage(1);
  };

  if (!projectId) return null;

  return (
    <Layout>
      <Link
        to="/projects"
        className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft className="h-3 w-3" /> Back to Projects
      </Link>

      <PageHeader
        title={`${ledger?.projectName ?? "Project"} — Ledger`}
        subtitle="Bank-linked transactions and manual balance adjustments"
        printTargetId="project-ledger"
        actions={
          isSuperAdmin && (
            <Button variant="warning" size="sm" onClick={() => setAddAdjustmentOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> Manual Balance Adjustment
            </Button>
          )
        }
      />

      <ManualBalanceAdjustmentDialog
        open={addAdjustmentOpen}
        onOpenChange={setAddAdjustmentOpen}
        projectId={projectId}
        projectName={ledger?.projectName}
        currentBalance={ledger?.balance ?? 0}
        onSuccess={() => { setAddAdjustmentOpen(false); refetch(); }}
      />
      <ManualBalanceAdjustmentDialog
        open={!!editAdjustment}
        onOpenChange={(open) => !open && setEditAdjustment(null)}
        projectId={projectId}
        projectName={ledger?.projectName}
        currentBalance={ledger?.balance ?? 0}
        adjustment={editAdjustment}
        onSuccess={() => { setEditAdjustment(null); refetch(); }}
      />

      {loading ? (
        <p className="text-muted-foreground py-8">Loading ledger…</p>
      ) : error ? (
        <p className="text-destructive py-8">{error}</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 mb-6">
            <StatCard
              label="Current Project Balance"
              value={formatCurrency(ledger?.balance ?? 0)}
              icon={<span className="text-xl font-bold">$</span>}
            />
          </div>

          <div className="rounded-xl border border-border/60 bg-card overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-base">
                <thead>
                  <tr className="border-b border-border/40 bg-muted/10 text-muted-foreground">
                    <th className="px-5 py-3 text-left text-sm font-medium">Date</th>
                    <th className="px-5 py-3 text-left text-sm font-medium">Type</th>
                    <th className="px-5 py-3 text-right text-sm font-medium">Amount</th>
                    <th className="px-5 py-3 text-left text-sm font-medium">Source</th>
                    <th className="px-5 py-3 text-left text-sm font-medium">Destination</th>
                    <th className="px-5 py-3 text-left text-sm font-medium">Reference / Remarks</th>
                    {isSuperAdmin && <th className="px-5 py-3 text-right text-sm font-medium print-hidden">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {!ledger?.rows?.length ? (
                    <tr>
                      <td colSpan={isSuperAdmin ? 7 : 6} className="px-5 py-8 text-center text-muted-foreground">
                        No ledger entries yet
                      </td>
                    </tr>
                  ) : (
                    ledger.rows.map((row) => (
                      <tr key={row.id} className="border-b border-border/40 hover:bg-muted/30 transition-colors">
                        <td className="px-5 py-3.5 text-sm text-muted-foreground">{row.date}</td>
                        <td className="px-5 py-3.5 text-sm">
                          {row.type === "bank_outflow" ? "Bank Outflow" : "Manual Adjustment"}
                        </td>
                        <td className="px-5 py-3.5 text-right font-mono text-sm font-medium">
                          {row.amount >= 0 ? (
                            <span className="text-success">+{formatCurrency(row.amount)}</span>
                          ) : (
                            <span className="text-destructive">{formatCurrency(row.amount)}</span>
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-sm text-muted-foreground">{row.source ?? "—"}</td>
                        <td className="px-5 py-3.5 text-sm text-muted-foreground">{row.destination ?? "—"}</td>
                        <td className="px-5 py-3.5 text-sm text-muted-foreground">
                          {row.type === "bank_outflow"
                            ? ([row.referenceId, row.remarks].filter(Boolean).join(" — ") || "—")
                            : (row.remarks ?? "—")}
                        </td>
                        {isSuperAdmin && (
                          <td className="px-5 py-3.5 text-right print-hidden">
                            {row.type === "manual_adjustment" ? (
                              <div className="flex justify-end gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                  onClick={() => setEditAdjustment(row)}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                  onClick={() => setDeleteAdjustment(row)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
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
        </>
      )}

      <AlertDialog open={!!deleteAdjustment} onOpenChange={(open) => !open && setDeleteAdjustment(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete manual balance adjustment?</AlertDialogTitle>
            <AlertDialogDescription>
              This will reverse the adjustment and update the project balance. If reversing would make the balance negative, deletion will be blocked.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteAdjustment}
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
