import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import Layout from "@/components/Layout";
import PageHeader from "@/components/PageHeader";
import { formatCurrency } from "@/lib/mock-data";
import { useConsumableItems } from "@/hooks/useConsumableItems";
import { useStockConsumption } from "@/hooks/useStockConsumption";
import { useProjects } from "@/hooks/useProjects";
import { useAuth } from "@/context/AuthContext";
import { useSelectedProject } from "@/context/SelectedProjectContext";
import { AddConsumableItemDialog } from "@/components/dialogs/AddConsumableItemDialog";
import { EditConsumableItemDialog } from "@/components/dialogs/EditConsumableItemDialog";
import { StockConsumptionDialog } from "@/components/dialogs/StockConsumptionDialog";
import { Button } from "@/components/ui/button";
import { Plus, Minus, Pencil, Trash2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
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
import { toast } from "sonner";
import { deleteConsumableItem, type ApiConsumableItem } from "@/services/consumableItemsService";
import { deleteStockConsumption, type ApiStockConsumption } from "@/services/stockConsumptionService";
import { useTablePagination } from "@/hooks/useTablePagination";
import { TablePagination } from "@/components/TablePagination";

export default function ConsumableInventory() {
  const { user } = useAuth();
  const { projects } = useProjects();
  const isSiteManager = user?.role === "Site Manager";
  const assignedProjectId = user?.assignedProjectId ?? null;

  const { selectedProjectId, setSelectedProjectId } = useSelectedProject();
  const [searchQuery, setSearchQuery] = useState("");
  const effectiveProjectId = isSiteManager ? assignedProjectId : (selectedProjectId || null);

  const { items, loading: itemsLoading, refetch: refetchItems } = useConsumableItems(effectiveProjectId);
  const { entries: consumptionEntries, loading: consumptionLoading, refetch: refetchConsumption } = useStockConsumption(effectiveProjectId);

  const canEditDelete = !isSiteManager;

  const projectOptions = useMemo(() => {
    if (isSiteManager && assignedProjectId) {
      const p = projects.find((pr) => pr.id === assignedProjectId);
      return p ? [{ id: p.id, name: p.name }] : [];
    }
    return projects;
  }, [isSiteManager, assignedProjectId, projects]);

  const [addItemOpen, setAddItemOpen] = useState(false);
  const [editItem, setEditItem] = useState<ApiConsumableItem | null>(null);
  const [deleteItemState, setDeleteItemState] = useState<ApiConsumableItem | null>(null);
  const [consumptionOpen, setConsumptionOpen] = useState(false);
  const [editConsumption, setEditConsumption] = useState<ApiStockConsumption | null>(null);
  const [deleteConsumptionState, setDeleteConsumptionState] = useState<ApiStockConsumption | null>(null);
  const selectedProjectName = isSiteManager
    ? (projects.find((p) => p.id === assignedProjectId)?.name ?? "Project")
    : (projects.find((p) => p.id === selectedProjectId)?.name ?? "Project");

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return items;

    return items.filter((item) => {
      return (
        item.name.toLowerCase().includes(q) ||
        item.unit.toLowerCase().includes(q)
      );
    });
  }, [items, searchQuery]);

  const itemsPagination = useTablePagination(filteredItems, { defaultPageSize: 12 });
  const consumptionPagination = useTablePagination(consumptionEntries, { defaultPageSize: 12 });

  const handleDeleteItemConfirm = async () => {
    if (!deleteItemState) return;
    try {
      await deleteConsumableItem(deleteItemState.id);
      toast.success("Item deleted");
      setDeleteItemState(null);
      refetchItems();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete item");
      setDeleteItemState(null);
    }
  };

  const handleDeleteConsumptionConfirm = async () => {
    if (!deleteConsumptionState) return;
    try {
      await deleteStockConsumption(deleteConsumptionState.id);
      toast.success("Consumption entry deleted — stock restored");
      setDeleteConsumptionState(null);
      refetchItems();
      refetchConsumption();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete consumption entry");
      setDeleteConsumptionState(null);
    }
  };

  return (
    <Layout>
      <PageHeader
        title="Consumable Inventory"
        subtitle="Materials that reduce with usage — per project"
        printProjectName={selectedProjectName}
        printTargetId="consumable-tabs"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setConsumptionOpen(true)} disabled={!effectiveProjectId}>
              <Minus className="h-4 w-4 mr-1" /> Stock Consumption
            </Button>
            <Button variant="warning" size="sm" onClick={() => setAddItemOpen(true)} disabled={!effectiveProjectId}>
              <Plus className="h-4 w-4 mr-1" /> Add Item
            </Button>
          </>
        }
      />

      {/* Project selector */}
      <div className="flex flex-wrap items-end gap-4 mb-4">
        {!isSiteManager && (
          <div className="flex items-center gap-3">
            <Label className="text-sm font-semibold uppercase tracking-wider">Project</Label>
            <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
              <SelectTrigger className="w-64">
                <SelectValue placeholder="Select project" />
              </SelectTrigger>
              <SelectContent>
                {projectOptions.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="flex-1 min-w-[220px] max-w-xs">
          <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Search Items</Label>
          <Input
            className="mt-1"
            placeholder="Name or unit"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </div>
      </div>

      <AddConsumableItemDialog
        open={addItemOpen}
        onOpenChange={setAddItemOpen}
        projectId={effectiveProjectId}
        onSuccess={refetchItems}
      />
      <EditConsumableItemDialog
        open={!!editItem}
        onOpenChange={(open) => !open && setEditItem(null)}
        item={editItem}
        onSave={() => { setEditItem(null); refetchItems(); }}
      />
      <StockConsumptionDialog
        open={consumptionOpen}
        onOpenChange={setConsumptionOpen}
        projectId={effectiveProjectId}
        consumableItems={items}
        editEntry={null}
        onSuccess={() => { refetchItems(); refetchConsumption(); }}
      />
      {editConsumption && (
        <StockConsumptionDialog
          open={!!editConsumption}
          onOpenChange={(open) => !open && setEditConsumption(null)}
          projectId={effectiveProjectId}
          consumableItems={items}
          editEntry={editConsumption}
          onSuccess={() => { setEditConsumption(null); refetchItems(); refetchConsumption(); }}
        />
      )}

      {/* Delete item dialog */}
      <AlertDialog open={!!deleteItemState} onOpenChange={(open) => !open && setDeleteItemState(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete item?</AlertDialogTitle>
            <AlertDialogDescription>
              Delete "{deleteItemState?.name}"? This cannot be undone. Items with ledger or consumption entries cannot be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteItemConfirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete consumption dialog */}
      <AlertDialog open={!!deleteConsumptionState} onOpenChange={(open) => !open && setDeleteConsumptionState(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete consumption entry?</AlertDialogTitle>
            <AlertDialogDescription>
              This will reverse the stock deduction for all items in this entry.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConsumptionConfirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete &amp; Restore Stock
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Tabs defaultValue="inventory" id="consumable-tabs">
        <TabsList>
          <TabsTrigger value="inventory">Item list</TabsTrigger>
          <TabsTrigger value="consumption">Stock consumption</TabsTrigger>
        </TabsList>

        <TabsContent value="inventory">
          <div className="border-2 border-border mt-4">
            <div className="overflow-x-auto">
              <table className="w-full text-base">
                <thead>
                  <tr className="border-b-2 border-border bg-primary text-primary-foreground">
                    <th className="px-4 py-2.5 text-left text-sm font-bold uppercase tracking-wider">Item</th>
                    <th className="px-4 py-2.5 text-left text-sm font-bold uppercase tracking-wider">Unit</th>
                    <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Current Stock</th>
                    <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Total Purchased</th>
                    <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Total Amount</th>
                    <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Paid</th>
                    <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Pending</th>
                    {canEditDelete && (
                      <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider print-hidden">Actions</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {itemsLoading ? (
                    <tr><td colSpan={canEditDelete ? 8 : 7} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>
                  ) : !effectiveProjectId ? (
                    <tr><td colSpan={canEditDelete ? 8 : 7} className="px-4 py-8 text-center text-muted-foreground">Select a project to view items.</td></tr>
                  ) : items.length === 0 ? (
                    <tr><td colSpan={canEditDelete ? 8 : 7} className="px-4 py-8 text-center text-muted-foreground">No consumable items for this project. Add one to get started.</td></tr>
                  ) : itemsPagination.paginatedItems.length === 0 ? (
                    <tr><td colSpan={canEditDelete ? 8 : 7} className="px-4 py-8 text-center text-muted-foreground">No items match your search.</td></tr>
                  ) : (
                    itemsPagination.paginatedItems.map((item) => (
                      <tr key={item.id} className="border-b border-border hover:bg-accent/50 transition-colors">
                        <td className="px-4 py-3">
                          <Link to={`/inventory/consumable/${item.id}`} className="font-bold hover:underline">
                            {item.name}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-sm uppercase">{item.unit}</td>
                        <td className="px-4 py-3 text-right font-mono text-sm font-bold">{item.currentStock.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right font-mono text-sm">{item.totalPurchased.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right font-mono text-sm">{formatCurrency(item.totalAmount)}</td>
                        <td className="px-4 py-3 text-right font-mono text-sm text-success">{formatCurrency(item.totalPaid)}</td>
                        <td className="px-4 py-3 text-right font-mono text-sm text-destructive">{item.totalPending > 0 ? formatCurrency(item.totalPending) : "—"}</td>
                        {canEditDelete && (
                      <td className="px-4 py-3 text-right print-hidden">
                            <div className="flex items-center justify-end gap-1">
                              <Button variant="ghost" size="icon" onClick={() => setEditItem(item)}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" onClick={() => setDeleteItemState(item)}>
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
            {effectiveProjectId && items.length > 0 && (
              <div className="print-hidden">
                <TablePagination
                  pageSize={itemsPagination.pageSize}
                  onPageSizeChange={itemsPagination.setPageSize}
                  page={itemsPagination.page}
                  totalPages={itemsPagination.totalPages}
                  totalItems={itemsPagination.totalItems}
                  onPrevious={itemsPagination.goPrev}
                  onNext={itemsPagination.goNext}
                  canPrevious={itemsPagination.canPrev}
                  canNext={itemsPagination.canNext}
                  pageSizeOptions={itemsPagination.pageSizeOptions}
                  startIndexOneBased={itemsPagination.startIndexOneBased}
                  endIndex={itemsPagination.endIndex}
                />
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="consumption">
          <div className="border-2 border-border mt-4">
            <div className="border-b-2 border-border bg-secondary px-4 py-3">
              <h2 className="text-sm font-bold uppercase tracking-wider">Consumption history</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-base">
                <thead>
                  <tr className="border-b-2 border-border bg-primary text-primary-foreground">
                    <th className="px-4 py-2.5 text-left text-sm font-bold uppercase tracking-wider">Date</th>
                    <th className="px-4 py-2.5 text-left text-sm font-bold uppercase tracking-wider">Items consumed</th>
                    <th className="px-4 py-2.5 text-left text-sm font-bold uppercase tracking-wider">Remarks</th>
                    {canEditDelete && (
                      <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider print-hidden">Actions</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {consumptionLoading ? (
                    <tr><td colSpan={canEditDelete ? 4 : 3} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>
                  ) : !effectiveProjectId ? (
                    <tr><td colSpan={canEditDelete ? 4 : 3} className="px-4 py-8 text-center text-muted-foreground">Select a project.</td></tr>
                  ) : consumptionEntries.length === 0 ? (
                    <tr>
                      <td colSpan={canEditDelete ? 4 : 3} className="px-4 py-8 text-center text-muted-foreground">
                        No consumption recorded yet. Use "Stock Consumption" to add entries.
                      </td>
                    </tr>
                  ) : (
                    consumptionPagination.paginatedItems.map((sc) => (
                      <tr key={sc.id} className="border-b border-border hover:bg-accent/50">
                        <td className="px-4 py-3 text-sm">{sc.date}</td>
                        <td className="px-4 py-3 text-sm">{sc.items.map((i) => `${i.itemName} (${i.quantityUsed} ${i.unit})`).join(", ")}</td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">{sc.remarks || "—"}</td>
                        {canEditDelete && (
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button variant="ghost" size="icon" onClick={() => setEditConsumption(sc)}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" onClick={() => setDeleteConsumptionState(sc)}>
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
            {effectiveProjectId && consumptionEntries.length > 0 && (
              <div className="print-hidden">
                <TablePagination
                  pageSize={consumptionPagination.pageSize}
                  onPageSizeChange={consumptionPagination.setPageSize}
                  page={consumptionPagination.page}
                  totalPages={consumptionPagination.totalPages}
                  totalItems={consumptionPagination.totalItems}
                  onPrevious={consumptionPagination.goPrev}
                  onNext={consumptionPagination.goNext}
                  canPrevious={consumptionPagination.canPrev}
                  canNext={consumptionPagination.canNext}
                  pageSizeOptions={consumptionPagination.pageSizeOptions}
                  startIndexOneBased={consumptionPagination.startIndexOneBased}
                  endIndex={consumptionPagination.endIndex}
                />
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </Layout>
  );
}
