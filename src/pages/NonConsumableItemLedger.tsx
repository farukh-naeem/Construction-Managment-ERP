import { useState, useEffect, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import Layout from "@/components/Layout";
import PageHeader from "@/components/PageHeader";
import StatCard from "@/components/StatCard";
import { formatCurrency } from "@/lib/mock-data";
import { formatDisplayDate } from "@/lib/pktDate";
import { useNonConsumableLedger } from "@/hooks/useNonConsumableLedger";
import {
  getNonConsumableItem,
  type ApiNonConsumableItem,
  type InUseByProjectEntry,
} from "@/services/nonConsumableItemService";
import {
  deleteNonConsumableLedgerEntry,
  type ApiNonConsumableLedgerEntry,
  type NonConsumableEventType,
} from "@/services/nonConsumableLedgerService";
import { AddNonConsumableEntryDialog } from "@/components/dialogs/AddNonConsumableEntryDialog";
import { TablePagination } from "@/components/TablePagination";
import { Button } from "@/components/ui/button";
import { Plus, ArrowLeft, Pencil, Trash2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useProjects } from "@/hooks/useProjects";
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

const EVENT_TYPE_LABELS: Record<NonConsumableEventType, string> = {
  Purchase: "Purchase (Add to Company Store)",
  AssignToProject: "Assign to Project",
  ReturnToCompany: "Return to Company",
  Repair: "Repair / Maintenance",
  ReturnFromRepair: "Return from Repair",
  MarkLost: "Mark Lost",
};

const PAGE_SIZE_OPTIONS = [12, 24, 50, 100];

export default function NonConsumableItemLedger() {
  const { itemId } = useParams<{ itemId: string }>();

  const { user } = useAuth();
  const { projects } = useProjects();
  const canEditDelete = user?.role !== "Site Manager";
  const projectOptions = projects;

  const [item, setItem] = useState<ApiNonConsumableItem | null>(null);
  const [itemLoading, setItemLoading] = useState(true);

  useEffect(() => {
    if (!itemId) return;
    setItemLoading(true);
    getNonConsumableItem(itemId)
      .then(setItem)
      .catch(() => setItem(null))
      .finally(() => setItemLoading(false));
  }, [itemId]);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);

  const { entries, total, loading: ledgerLoading, refetch } = useNonConsumableLedger(
    itemId ?? "",
    page,
    pageSize
  );

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const startIndexOneBased = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const endIndex = Math.min(page * pageSize, total);

  const [addEntryOpen, setAddEntryOpen] = useState(false);
  const [editEntry, setEditEntry] = useState<ApiNonConsumableLedgerEntry | null>(null);
  const [deleteEntry, setDeleteEntry] = useState<ApiNonConsumableLedgerEntry | null>(null);

  const handleDeleteConfirm = async () => {
    if (!deleteEntry || !itemId) return;
    try {
      await deleteNonConsumableLedgerEntry(itemId, deleteEntry.id);
      toast.success("Ledger entry deleted — balances updated");
      setDeleteEntry(null);
      refetch();
      getNonConsumableItem(itemId).then(setItem).catch(() => null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete entry");
      setDeleteEntry(null);
    }
  };

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setPage(1);
  };

  const refreshItem = () => {
    if (itemId) getNonConsumableItem(itemId).then(setItem).catch(() => null);
  };

  if (itemLoading) {
    return (
      <Layout>
        <p className="text-muted-foreground p-6">Loading…</p>
      </Layout>
    );
  }

  if (!item) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-12">
          <p className="text-muted-foreground">Item not found.</p>
          <Link
            to="/inventory/non-consumable"
            className="ml-2 text-primary hover:underline"
          >
            Back to list
          </Link>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <Link
        to="/inventory/non-consumable"
        className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft className="h-3 w-3" /> Back to Non-Consumable
      </Link>

      <PageHeader
        title={`${item.name} — Asset Ledger`}
        subtitle={`Category: ${item.category}`}
        printTargetId="nc-ledger"
        actions={
          <Button variant="warning" size="sm" onClick={() => setAddEntryOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Add Entry
          </Button>
        }
      />

      <AddNonConsumableEntryDialog
        open={addEntryOpen}
        onOpenChange={setAddEntryOpen}
        itemId={item.id}
        itemName={item.name}
        projects={projectOptions}
        inUseByProject={Object.fromEntries(
          (item.inUseByProject ?? []).map((e: InUseByProjectEntry) => [e.projectId, e.quantity])
        )}
        companyStore={item.companyStore}
        inUse={item.inUse}
        underRepair={item.underRepair}
        onSuccess={() => {
          refetch();
          refreshItem();
        }}
      />
      {editEntry && (
        <AddNonConsumableEntryDialog
          open={!!editEntry}
          onOpenChange={(open) => !open && setEditEntry(null)}
          itemId={item.id}
          itemName={item.name}
          projects={projectOptions}
          inUseByProject={Object.fromEntries(
            (item.inUseByProject ?? []).map((e: InUseByProjectEntry) => [e.projectId, e.quantity])
          )}
          companyStore={item.companyStore}
          inUse={item.inUse}
          underRepair={item.underRepair}
          editEntry={editEntry}
          onSuccess={() => {
            setEditEntry(null);
            refetch();
            refreshItem();
          }}
        />
      )}

      <AlertDialog open={!!deleteEntry} onOpenChange={(open) => !open && setDeleteEntry(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete ledger entry?</AlertDialogTitle>
            <AlertDialogDescription>
              This will reverse the movement and restore quantities. For Purchase entries, deletion
              is blocked if the quantity has been distributed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete Entry
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 mb-6">
        <StatCard label="Total Quantity" value={String(item.totalQuantity)} variant="info" />
        <StatCard
          label="Company Store (Available)"
          value={String(item.companyStore)}
          variant="success"
        />
        <StatCard
          label="In Use (Projects)"
          value={
            item.inUse > 0 && (item.inUseByProject?.length ?? 0) > 0 ? (
              <span className="block">
                <span className="font-bold">{item.inUse}</span>
                <ul className="mt-1 text-xs font-normal space-y-0.5 text-muted-foreground">
                  {(item.inUseByProject ?? []).map((e) => (
                    <li key={e.projectId}>
                      {e.quantity} — {e.projectName}
                    </li>
                  ))}
                </ul>
              </span>
            ) : (
              String(item.inUse)
            )
          }
          variant="info"
        />
        <StatCard label="Under Repair" value={String(item.underRepair)} variant="warning" />
        <StatCard label="Lost" value={String(item.lost)} variant="destructive" />
      </div>

      <div id="nc-ledger" className="border-2 border-border">
        <div className="border-b-2 border-border bg-secondary px-4 py-3">
          <h2 className="text-sm font-bold uppercase tracking-wider">Movement history</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-base">
            <thead>
              <tr className="border-b-2 border-border bg-primary text-primary-foreground">
                <th className="px-3 py-2.5 text-left text-sm font-bold uppercase tracking-wider">
                  Date
                </th>
                <th className="px-3 py-2.5 text-left text-sm font-bold uppercase tracking-wider">
                  Event Type
                </th>
                <th className="px-3 py-2.5 text-right text-sm font-bold uppercase tracking-wider">
                  Qty
                </th>
                <th className="px-3 py-2.5 text-right text-sm font-bold uppercase tracking-wider">
                  Cost
                </th>
                <th className="px-3 py-2.5 text-left text-sm font-bold uppercase tracking-wider">
                  Project / Expense Project
                </th>
                <th className="px-3 py-2.5 text-left text-sm font-bold uppercase tracking-wider">
                  Remarks
                </th>
                {canEditDelete && (
                  <th className="px-3 py-2.5 text-right text-sm font-bold uppercase tracking-wider print-hidden">
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {ledgerLoading ? (
                <tr>
                  <td
                    colSpan={canEditDelete ? 7 : 6}
                    className="px-4 py-8 text-center text-muted-foreground"
                  >
                    Loading…
                  </td>
                </tr>
              ) : entries.length === 0 ? (
                <tr>
                  <td
                    colSpan={canEditDelete ? 7 : 6}
                    className="px-4 py-8 text-center text-muted-foreground"
                  >
                    No ledger entries yet. Add an entry to start tracking.
                  </td>
                </tr>
              ) : (
                entries.map((entry) => (
                  <tr
                    key={entry.id}
                    className="border-b border-border hover:bg-accent/50 transition-colors"
                  >
                    <td className="px-3 py-3 text-sm">{formatDisplayDate(entry.date)}</td>
                    <td className="px-3 py-3 text-sm font-bold">
                      {EVENT_TYPE_LABELS[entry.eventType] ?? entry.eventType}
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-sm">{entry.quantity}</td>
                    <td className="px-3 py-3 text-right font-mono text-sm">
                      {entry.totalCost != null ? formatCurrency(entry.totalCost) : "—"}
                    </td>
                    <td className="px-3 py-3 text-sm">
                      {entry.expenseProjectName ?? entry.projectToName ?? entry.projectFromName ?? "—"}
                    </td>
                    <td className="px-3 py-3 text-sm text-muted-foreground">
                      {entry.remarks ?? "—"}
                    </td>
                    {canEditDelete && (
                      <td className="px-3 py-3 text-right print-hidden">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setEditEntry(entry)}
                            title="Edit"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeleteEntry(entry)}
                            title="Delete"
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
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
        {!ledgerLoading && entries.length > 0 && (
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
