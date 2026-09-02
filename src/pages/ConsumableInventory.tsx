import { useState, useMemo, useEffect } from "react";
import { Link } from "react-router-dom";
import Layout from "@/components/Layout";
import PageHeader from "@/components/PageHeader";
import { formatCurrency, formatQuantity } from "@/lib/mock-data";
import { useConsumableItems } from "@/hooks/useConsumableItems";
import { useStockConsumption } from "@/hooks/useStockConsumption";
import { useProjects } from "@/hooks/useProjects";
import { useAuth } from "@/context/AuthContext";
import { useSelectedProject } from "@/context/SelectedProjectContext";
import { AddConsumableItemDialog } from "@/components/dialogs/AddConsumableItemDialog";
import { EditConsumableItemDialog } from "@/components/dialogs/EditConsumableItemDialog";
import { StockConsumptionDialog } from "@/components/dialogs/StockConsumptionDialog";
import { SellItemsDialog } from "@/components/dialogs/SellItemsDialog";
import { BulkAddLedgerEntryDialog } from "@/components/dialogs/BulkAddLedgerEntryDialog";
import { Button } from "@/components/ui/button";
import { Plus, Pencil, Trash2, ShoppingCart } from "lucide-react";
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
import { useCustomerSales } from "@/hooks/useCustomerSales";
import { useSalesReport } from "@/hooks/useSalesReport";
import { SALES_REPORT_COLUMNS, SALES_REPORT_GROUPS, SALES_REPORT_PRINT_CSS } from "./salesReportColumns";
import { deleteCustomerSale, type ApiCustomerSale } from "@/services/customerSaleService";
import { useTablePagination } from "@/hooks/useTablePagination";
import { TablePagination } from "@/components/TablePagination";
import { useVendors } from "@/hooks/useVendors";
import { getConsumableRunningBill, type ApiConsumableRunningBill } from "@/services/consumableRunningBillService";
import PrintExportButton from "@/components/PrintExportButton";
import { formatDisplayDate, todayPKT } from "@/lib/pktDate";

export default function ConsumableInventory() {
  const { user } = useAuth();
  const { projects } = useProjects();
  const isSiteManager = user?.role === "Site Manager";

  const { selectedProjectId, setSelectedProjectId } = useSelectedProject();
  const [searchQuery, setSearchQuery] = useState("");
  const effectiveProjectId = selectedProjectId || null;

  const { items, loading: itemsLoading, refetch: refetchItems } = useConsumableItems(effectiveProjectId);
  const { entries: consumptionEntries, loading: consumptionLoading, refetch: refetchConsumption } = useStockConsumption(effectiveProjectId);
  const { vendors } = useVendors(effectiveProjectId);
  const { sales, loading: salesLoading, refetch: refetchSales } = useCustomerSales(effectiveProjectId);

  const canEditDelete = !isSiteManager;

  const [addItemOpen, setAddItemOpen] = useState(false);
  const [bulkPurchaseOpen, setBulkPurchaseOpen] = useState(false);
  const [editItem, setEditItem] = useState<ApiConsumableItem | null>(null);
  const [deleteItemState, setDeleteItemState] = useState<ApiConsumableItem | null>(null);
  const [consumptionOpen, setConsumptionOpen] = useState(false);
  const [sellOpen, setSellOpen] = useState(false);
  const [deleteSaleState, setDeleteSaleState] = useState<ApiCustomerSale | null>(null);
  const [salesStart, setSalesStart] = useState("");
  const [salesEnd, setSalesEnd] = useState("");
  const [reportStart, setReportStart] = useState("");
  const [reportEnd, setReportEnd] = useState("");
  const { report, loading: reportLoading, error: reportError } = useSalesReport(
    effectiveProjectId,
    reportStart || undefined,
    reportEnd || undefined
  );
  const [editConsumption, setEditConsumption] = useState<ApiStockConsumption | null>(null);
  const [deleteConsumptionState, setDeleteConsumptionState] = useState<ApiStockConsumption | null>(null);
  const [billVendorId, setBillVendorId] = useState("");
  const [billStart, setBillStart] = useState(todayPKT());
  const [billEnd, setBillEnd] = useState(todayPKT());
  const [billLabel, setBillLabel] = useState("");
  const [runningBill, setRunningBill] = useState<ApiConsumableRunningBill | null>(null);
  const [billLoading, setBillLoading] = useState(false);
  const [billError, setBillError] = useState<string | null>(null);
  const [selectedBillRows, setSelectedBillRows] = useState<Set<string>>(new Set());
  const selectedProjectName = projects.find((p) => p.id === selectedProjectId)?.name ?? "Project";

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return items;

    return items.filter((item) => {
      return (
        item.name.toLowerCase().includes(q)
      );
    });
  }, [items, searchQuery]);

  const itemsPagination = useTablePagination(filteredItems, { defaultPageSize: 12 });
  const consumptionPagination = useTablePagination(consumptionEntries, { defaultPageSize: 12 });
  // Sales tab date filter — sale dates are "YYYY-MM-DD" so plain string compare is correct.
  const filteredSales = useMemo(() => {
    if (!salesStart && !salesEnd) return sales;
    return sales.filter(
      (sale) => (!salesStart || sale.date >= salesStart) && (!salesEnd || sale.date <= salesEnd)
    );
  }, [sales, salesStart, salesEnd]);

  const salesTotals = useMemo(
    () =>
      filteredSales.reduce(
        (totals, sale) => ({
          amount: totals.amount + sale.totalAmount,
          received: totals.received + sale.paidAmount,
        }),
        { amount: 0, received: 0 }
      ),
    [filteredSales]
  );

  const salesPagination = useTablePagination(filteredSales, { defaultPageSize: 12 });

  useEffect(() => {
    if (!effectiveProjectId || !billVendorId || !billStart || !billEnd) {
      setRunningBill(null); setBillError(null); return;
    }
    let cancelled = false;
    setBillLoading(true); setBillError(null);
    getConsumableRunningBill({ projectId: effectiveProjectId, vendorId: billVendorId, periodStart: billStart, periodEnd: billEnd })
      .then((bill) => {
        if (cancelled) return;
        setRunningBill(bill);
        setSelectedBillRows(new Set(bill.rows.map((row) => row.id)));
      })
      .catch((err) => !cancelled && (setRunningBill(null), setBillError(err instanceof Error ? err.message : "Failed to generate bill")))
      .finally(() => !cancelled && setBillLoading(false));
    return () => { cancelled = true; };
  }, [effectiveProjectId, billVendorId, billStart, billEnd]);

  const selectedBillData = useMemo(() => {
    const rows = runningBill?.rows.filter((row) => selectedBillRows.has(row.id)) ?? [];
    const summary = rows.reduce((total, row) => ({
      quantity: total.quantity + row.quantity,
      previousQuantity: total.previousQuantity + row.previousQuantity,
      totalQuantity: total.totalQuantity + row.totalQuantity,
      thisBill: total.thisBill + row.thisBill,
      previousBill: total.previousBill + row.previousBill,
      totalAmount: total.totalAmount + row.totalAmount,
    }), { quantity: 0, previousQuantity: 0, totalQuantity: 0, thisBill: 0, previousBill: 0, totalAmount: 0 });
    const advances = runningBill?.summary ?? { thisBillAdvance: 0, previousBillAdvance: 0 };
    return { rows, summary, advances };
  }, [runningBill, selectedBillRows]);

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

  const handleDeleteSaleConfirm = async () => {
    if (!deleteSaleState) return;
    try {
      await deleteCustomerSale(deleteSaleState.saleId);
      toast.success("Sale deleted — stock restored");
      setDeleteSaleState(null);
      refetchItems();
      refetchSales();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete sale");
      setDeleteSaleState(null);
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
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setBulkPurchaseOpen(true)} disabled={!effectiveProjectId}>Bulk Purchase</Button>
            <Button variant="warning" size="sm" onClick={() => setAddItemOpen(true)} disabled={!effectiveProjectId}>
              <Plus className="h-4 w-4 mr-1" /> Add Item
            </Button>
            <Button variant="outline" size="sm" onClick={() => setSellOpen(true)} disabled={!effectiveProjectId}>
              <ShoppingCart className="h-4 w-4 mr-1" /> Sell Items
            </Button>
          </>
        }
      />

      {/* Project selector */}
      <div className="flex flex-wrap items-end gap-4 mb-4">
        {projects.length > 0 && (
          <div className="flex items-center gap-3">
            <Label className="text-sm font-semibold uppercase tracking-wider">Project</Label>
            <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
              <SelectTrigger className="w-64">
                <SelectValue placeholder="Select project" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
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
            placeholder="Item name"
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
      <BulkAddLedgerEntryDialog open={bulkPurchaseOpen} onOpenChange={setBulkPurchaseOpen} projectId={effectiveProjectId} onSuccess={refetchItems} />
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

      <SellItemsDialog
        open={sellOpen}
        onOpenChange={setSellOpen}
        projectId={effectiveProjectId}
        consumableItems={items}
        onSuccess={() => { refetchItems(); refetchSales(); }}
      />

      {/* Delete sale dialog */}
      <AlertDialog open={!!deleteSaleState} onOpenChange={(open) => !open && setDeleteSaleState(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this sale?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes every item line in the sale, restores their stock, and removes the charge from
              {" "}{deleteSaleState?.customerName}&apos;s balance.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteSaleConfirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete &amp; Restore Stock
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
          <TabsTrigger value="sales">Sales</TabsTrigger>
          <TabsTrigger value="sales-report">Sales Report</TabsTrigger>
          <TabsTrigger value="generate-bill">Generate Bill</TabsTrigger>
        </TabsList>

        <TabsContent value="inventory">
          <div className="border-2 border-border mt-4">
            <div className="overflow-x-auto">
              <table className="w-full text-base">
                <thead>
                  <tr className="border-b-2 border-border bg-primary text-primary-foreground">
                    <th className="px-4 py-2.5 text-left text-sm font-bold uppercase tracking-wider">Item</th>
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
                    <tr><td colSpan={canEditDelete ? 7 : 6} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>
                  ) : !effectiveProjectId ? (
                    <tr><td colSpan={canEditDelete ? 7 : 6} className="px-4 py-8 text-center text-muted-foreground">Select a project to view items.</td></tr>
                  ) : items.length === 0 ? (
                    <tr><td colSpan={canEditDelete ? 7 : 6} className="px-4 py-8 text-center text-muted-foreground">No consumable items for this project. Add one to get started.</td></tr>
                  ) : itemsPagination.paginatedItems.length === 0 ? (
                    <tr><td colSpan={canEditDelete ? 7 : 6} className="px-4 py-8 text-center text-muted-foreground">No items match your search.</td></tr>
                  ) : (
                    itemsPagination.paginatedItems.map((item) => (
                      <tr key={item.id} className="border-b border-border hover:bg-accent/50 transition-colors">
                        <td className="px-4 py-3">
                          <Link to={`/inventory/consumable/${item.id}`} className="font-bold hover:underline">
                            {item.name}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-sm font-bold">{formatQuantity(item.currentStock)}</td>
                        <td className="px-4 py-3 text-right font-mono text-sm">{formatQuantity(item.totalPurchased)}</td>
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
                        <td className="px-4 py-3 text-sm">{formatDisplayDate(sc.date)}</td>
                        <td className="px-4 py-3 text-sm">{sc.items.map((i) => `${i.itemName} (${formatQuantity(i.quantityUsed)} ${i.unit})`).join(", ")}</td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">{sc.remarks || "—"}</td>
                        {canEditDelete && !sc.machineId && (
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
                        {canEditDelete && sc.machineId && <td className="px-4 py-3 text-right text-xs text-muted-foreground">Managed from machinery</td>}
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

        <TabsContent value="sales">
          <div className="print-hidden flex flex-wrap items-end gap-4 mt-4 border-2 border-border p-4">
            <div>
              <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Start date</Label>
              <Input className="mt-1 w-44" type="date" value={salesStart} onChange={(event) => setSalesStart(event.target.value)} />
            </div>
            <div>
              <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">End date</Label>
              <Input className="mt-1 w-44" type="date" value={salesEnd} min={salesStart} onChange={(event) => setSalesEnd(event.target.value)} />
            </div>
            {(salesStart || salesEnd) && (
              <Button type="button" variant="outline" size="sm" onClick={() => { setSalesStart(""); setSalesEnd(""); }}>
                Clear filter
              </Button>
            )}
            <div className="ml-auto">
              <PrintExportButton
                title="Stock Sold to Customers"
                subtitle={salesStart || salesEnd ? `${formatDisplayDate(salesStart, "Start")} to ${formatDisplayDate(salesEnd, "End")}` : undefined}
                printProjectName={selectedProjectName}
                printTargetId="consumable-sales-table"
              />
            </div>
          </div>

          <div id="consumable-sales-table" className="border-2 border-border mt-4">
            <div className="border-b-2 border-border bg-secondary px-4 py-3">
              <h2 className="text-sm font-bold uppercase tracking-wider">Stock sold to customers</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-base">
                <thead>
                  <tr className="border-b-2 border-border bg-primary text-primary-foreground">
                    <th className="px-4 py-2.5 text-left text-sm font-bold uppercase tracking-wider">Date</th>
                    <th className="px-4 py-2.5 text-left text-sm font-bold uppercase tracking-wider">Customer</th>
                    <th className="px-4 py-2.5 text-left text-sm font-bold uppercase tracking-wider">Items sold</th>
                    <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Amount</th>
                    <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Received</th>
                    {canEditDelete && (
                      <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider print-hidden">Actions</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {salesLoading ? (
                    <tr><td colSpan={canEditDelete ? 6 : 5} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>
                  ) : !effectiveProjectId ? (
                    <tr><td colSpan={canEditDelete ? 6 : 5} className="px-4 py-8 text-center text-muted-foreground">Select a project.</td></tr>
                  ) : filteredSales.length === 0 ? (
                    <tr>
                      <td colSpan={canEditDelete ? 6 : 5} className="px-4 py-8 text-center text-muted-foreground">
                        {sales.length === 0
                          ? "No stock sold yet. Use \u201CSell Items\u201D to record a sale."
                          : "No sales in the selected date range."}
                      </td>
                    </tr>
                  ) : (
                    salesPagination.paginatedItems.map((sale) => (
                      <tr key={sale.saleId} className="border-b border-border hover:bg-accent/50">
                        <td className="px-4 py-3 text-sm">{formatDisplayDate(sale.date)}</td>
                        <td className="px-4 py-3 text-sm">
                          <Link to={`/customers/${sale.customerId}`} className="font-bold hover:underline">
                            {sale.customerName}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {sale.items.map((i) => `${i.itemName} (${formatQuantity(i.quantity)} ${i.unit})`).join(", ")}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-sm text-destructive">{formatCurrency(sale.totalAmount)}</td>
                        <td className="px-4 py-3 text-right font-mono text-sm text-success">
                          {sale.paidAmount > 0 ? formatCurrency(sale.paidAmount) : "—"}
                        </td>
                        {canEditDelete && (
                          <td className="px-4 py-3 text-right print-hidden">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setDeleteSaleState(sale)}
                              disabled={sale.paidAmount > 0}
                              title={sale.paidAmount > 0 ? "Delete the linked payment from the customer ledger first" : "Delete sale"}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
                {filteredSales.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-border bg-muted/30 font-bold">
                      <td colSpan={3} className="px-4 py-3 text-right text-sm">Total</td>
                      <td className="px-4 py-3 text-right font-mono text-sm text-destructive">{formatCurrency(salesTotals.amount)}</td>
                      <td className="px-4 py-3 text-right font-mono text-sm text-success">
                        {salesTotals.received > 0 ? formatCurrency(salesTotals.received) : "—"}
                      </td>
                      {canEditDelete && <td className="print-hidden" />}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            {effectiveProjectId && filteredSales.length > 0 && (
              <div className="print-hidden">
                <TablePagination
                  pageSize={salesPagination.pageSize}
                  onPageSizeChange={salesPagination.setPageSize}
                  page={salesPagination.page}
                  totalPages={salesPagination.totalPages}
                  totalItems={salesPagination.totalItems}
                  onPrevious={salesPagination.goPrev}
                  onNext={salesPagination.goNext}
                  canPrevious={salesPagination.canPrev}
                  canNext={salesPagination.canNext}
                  pageSizeOptions={salesPagination.pageSizeOptions}
                  startIndexOneBased={salesPagination.startIndexOneBased}
                  endIndex={salesPagination.endIndex}
                />
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="sales-report">
          <div className="print-hidden flex flex-wrap items-end gap-4 mt-4 border-2 border-border p-4">
            <div>
              <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Start date</Label>
              <Input className="mt-1 w-44" type="date" value={reportStart} onChange={(event) => setReportStart(event.target.value)} />
            </div>
            <div>
              <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">End date</Label>
              <Input className="mt-1 w-44" type="date" value={reportEnd} min={reportStart} onChange={(event) => setReportEnd(event.target.value)} />
            </div>
            {(reportStart || reportEnd) && (
              <Button type="button" variant="outline" size="sm" onClick={() => { setReportStart(""); setReportEnd(""); }}>
                Clear filter
              </Button>
            )}
            <div className="ml-auto">
              <PrintExportButton
                title="Purchase & Sales Report"
                subtitle={reportStart || reportEnd ? `${formatDisplayDate(reportStart, "Start")} to ${formatDisplayDate(reportEnd, "End")}` : undefined}
                printProjectName={selectedProjectName}
                printTargetId="consumable-sales-report"
                additionalPrintCss={SALES_REPORT_PRINT_CSS}
              />
            </div>
          </div>

          <div id="consumable-sales-report" className="border-2 border-border mt-4">
            <div className="border-b-2 border-border bg-secondary px-4 py-3">
              <h2 className="text-sm font-bold uppercase tracking-wider">Purchase &amp; sales report</h2>
              <p className="text-xs text-muted-foreground mt-1">
                Cost of items sold is valued at the latest purchase rate on or before the sale date.
                Each day&apos;s project expense is charged once, to that day&apos;s first sale.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="sales-report-table w-full min-w-[1080px] table-fixed border-collapse">
                <colgroup>
                  {SALES_REPORT_COLUMNS.map((col) => (
                    <col key={col.key} style={{ width: col.width }} />
                  ))}
                </colgroup>
                <thead>
                  <tr className="bg-primary text-primary-foreground">
                    {SALES_REPORT_GROUPS.map((group, index) => (
                      <th
                        key={group.label || `group-${index}`}
                        colSpan={group.span}
                        className={`px-2 py-2 text-center text-[10px] font-bold uppercase tracking-wider break-words border-b border-primary-foreground/30 ${index > 0 ? "group-start border-l-2 border-border" : ""}`}
                      >
                        {group.label}
                      </th>
                    ))}
                  </tr>
                  <tr className="border-b-2 border-border bg-primary text-primary-foreground">
                    {SALES_REPORT_COLUMNS.map((col) => (
                      <th
                        key={col.key}
                        className={`px-1.5 py-2 text-[10px] font-bold uppercase leading-tight break-words ${col.align === "right" ? "text-right" : "text-left"} ${col.groupStart ? "group-start border-l-2 border-border" : ""}`}
                      >
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {reportLoading ? (
                    <tr><td colSpan={SALES_REPORT_COLUMNS.length} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>
                  ) : !effectiveProjectId ? (
                    <tr><td colSpan={SALES_REPORT_COLUMNS.length} className="px-4 py-8 text-center text-muted-foreground">Select a project.</td></tr>
                  ) : reportError ? (
                    <tr><td colSpan={SALES_REPORT_COLUMNS.length} className="px-4 py-8 text-center text-destructive">{reportError}</td></tr>
                  ) : !report || report.rows.length === 0 ? (
                    <tr>
                      <td colSpan={SALES_REPORT_COLUMNS.length} className="px-4 py-8 text-center text-muted-foreground">
                        No purchases, sales or expenses in this period.
                      </td>
                    </tr>
                  ) : (
                    report.rows.map((row) => (
                      <tr key={`${row.kind}-${row.id}`} className="border-b border-border hover:bg-accent/50 transition-colors">
                        {SALES_REPORT_COLUMNS.map((col) => (
                          <td
                            key={col.key}
                            className={`px-1.5 py-2 text-[10px] ${col.align === "right" ? "text-right font-mono tabular-nums whitespace-nowrap" : "break-words"} ${col.groupStart ? "group-start border-l-2 border-border" : ""} ${col.cellClass?.(row) ?? ""}`}
                          >
                            {col.cell(row)}
                          </td>
                        ))}
                      </tr>
                    ))
                  )}
                </tbody>
                {report && report.rows.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-border bg-muted/30 font-bold">
                      <td colSpan={3} className="px-1.5 py-2.5 text-right text-[10px]">Total</td>
                      {SALES_REPORT_COLUMNS.slice(3).map((col) => (
                        <td
                          key={col.key}
                          className={`px-1.5 py-2.5 text-[10px] ${col.align === "right" ? "text-right font-mono tabular-nums whitespace-nowrap" : "break-words"} ${col.groupStart ? "group-start border-l-2 border-border" : ""} ${col.totalClass?.(report.totals) ?? ""}`}
                        >
                          {col.total ? col.total(report.totals) : null}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="generate-bill">
          <div className="mt-4 space-y-4">
            <div className="print-hidden flex flex-wrap items-end gap-4 border-2 border-border p-4">
              <div className="min-w-[240px]">
                <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Vendor</Label>
                <Select value={billVendorId} onValueChange={setBillVendorId}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select vendor" /></SelectTrigger>
                  <SelectContent>{vendors.map((vendor) => <SelectItem key={vendor.id} value={vendor.id}>{vendor.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Start date</Label>
                <Input className="mt-1 w-44" type="date" value={billStart} onChange={(event) => setBillStart(event.target.value)} />
              </div>
              <div>
                <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">End date / bill date</Label>
                <Input className="mt-1 w-44" type="date" value={billEnd} onChange={(event) => setBillEnd(event.target.value)} />
              </div>
              <div className="min-w-[220px]">
                <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Running bill label</Label>
                <Input className="mt-1" value={billLabel} onChange={(event) => setBillLabel(event.target.value)} placeholder="e.g. 1st Running Bill" />
              </div>
            </div>

            {!effectiveProjectId ? (
              <div className="border-2 border-border p-8 text-center text-muted-foreground">Select a project to generate a bill.</div>
            ) : !billVendorId ? (
              <div className="border-2 border-border p-8 text-center text-muted-foreground">Select a vendor to show its purchased items.</div>
            ) : billLoading ? (
              <div className="border-2 border-border p-8 text-center text-muted-foreground">Generating bill…</div>
            ) : billError ? (
              <div className="border-2 border-destructive p-8 text-center text-destructive">{billError}</div>
            ) : runningBill && (
              <div id="consumable-running-bill" className="border-2 border-border bg-card p-4 sm:p-6">
                <header className="running-bill-details mb-4 border-b border-border pb-4 text-sm sm:text-base">
                  <div className="grid grid-cols-1 gap-y-2 sm:grid-cols-2 sm:gap-x-12" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 48px" }}>
                    <p><strong>Project Name:</strong> {selectedProjectName}</p>
                    <p className="sm:text-right">{billLabel}</p>
                    <p><strong>Vendor:</strong> {runningBill.vendorName}</p>
                    <p className="sm:text-right"><strong>Date:</strong> {formatDisplayDate(billEnd)}</p>
                  </div>
                </header>
                <div className="mb-3 flex justify-end print-hidden">
                  <PrintExportButton title="Consumable Running Bill" printProjectName={selectedProjectName} printTargetId="consumable-running-bill" omitDefaultHeader additionalPrintCss={`
                    table.consumable-running-bill-table { table-layout: fixed; }
                    .consumable-running-bill-table th, .consumable-running-bill-table td { padding: 6px 7px; font-size: 10px; overflow: hidden; }
                    .consumable-running-bill-table th { white-space: normal !important; overflow-wrap: anywhere; word-break: break-word; line-height: 1.15; font-size: 9px; }
                    .consumable-running-bill-table td { white-space: nowrap; }
                    .running-bill-details { margin: 0 0 12px; padding: 0 0 8px; border-bottom: 1px solid #000; font-size: 12px; }
                    .running-bill-details > div { display: grid !important; grid-template-columns: 1fr 1fr !important; gap: 6px 36px !important; }
                    .running-bill-details p { margin: 0; }
                    .running-bill-details p:nth-child(even) { text-align: right; }
                    .running-bill-signatures { display: flex; justify-content: flex-end; margin: 128px 8% 0; font-size: 12px; break-inside: avoid; page-break-inside: avoid; }
                    .running-bill-signature { width: 38%; text-align: center; }
                    .running-bill-signature-line { border-top: 1px solid #000; margin-bottom: 6px; min-height: 28px; }
                  `} preparePrintContent={(printContent) => {
                    printContent.querySelectorAll("table.consumable-running-bill-table").forEach((table) => {
                      table.querySelectorAll(".bill-selector-column").forEach((cell) => cell.remove());
                      table.querySelectorAll("tbody tr").forEach((row) => {
                        const leadingCell = row.querySelector(":scope > td[colspan]") as HTMLTableCellElement | null;
                        if (leadingCell && leadingCell.colSpan > 1) leadingCell.colSpan -= 1;
                      });
                    });
                    return printContent;
                  }} />
                </div>
                <div className="overflow-x-auto">
                  <table className="consumable-running-bill-table w-full min-w-[950px] border-collapse text-sm [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-2 [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-2">
                    <thead className="bg-primary text-primary-foreground">
                      <tr>
                        <th className="bill-selector-column w-9 text-center"><input className="bill-selector-control" type="checkbox" checked={runningBill.rows.length > 0 && selectedBillRows.size === runningBill.rows.length} onChange={(event) => setSelectedBillRows(event.target.checked ? new Set(runningBill.rows.map((row) => row.id)) : new Set())} aria-label="Select all items" /></th>
                        <th className="text-left">Item Name</th><th className="text-right">Qty</th><th className="text-right">Previous Qty</th><th className="text-right">Total Qty</th><th className="text-right">Rate (Unit Price)</th><th className="text-right">This Bill</th><th className="text-right">Previous Bill</th><th className="text-right">Total Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runningBill.rows.length === 0 ? <tr><td colSpan={9} className="py-8 text-center text-muted-foreground">No purchases for this vendor up to the selected bill date.</td></tr> : selectedBillData.rows.map((row) => <tr key={row.id}>
                        <td className="bill-selector-column text-center"><input className="bill-selector-control" type="checkbox" checked={selectedBillRows.has(row.id)} onChange={(event) => setSelectedBillRows((current) => { const next = new Set(current); if (event.target.checked) next.add(row.id); else next.delete(row.id); return next; })} aria-label={`Include ${row.itemName}`} /></td>
                        <td>{row.itemName}</td><td className="text-right font-mono">{row.quantity ? formatQuantity(row.quantity) : "—"}</td><td className="text-right font-mono">{row.previousQuantity ? formatQuantity(row.previousQuantity) : "—"}</td><td className="text-right font-mono">{row.totalQuantity ? formatQuantity(row.totalQuantity) : "—"}</td><td className="text-right font-mono">{formatCurrency(row.rate)}</td><td className="text-right font-mono">{row.thisBill ? formatCurrency(row.thisBill) : "—"}</td><td className="text-right font-mono">{row.previousBill ? formatCurrency(row.previousBill) : "—"}</td><td className="text-right font-mono font-semibold">{row.totalAmount ? formatCurrency(row.totalAmount) : "—"}</td>
                      </tr>)}
                      {selectedBillData.rows.length > 0 && <>
                        <tr className="bg-muted/40 font-bold"><td colSpan={2} className="text-left">Total</td><td className="text-right font-mono">{selectedBillData.summary.quantity ? formatQuantity(selectedBillData.summary.quantity) : "—"}</td><td className="text-right font-mono">{selectedBillData.summary.previousQuantity ? formatQuantity(selectedBillData.summary.previousQuantity) : "—"}</td><td className="text-right font-mono">{selectedBillData.summary.totalQuantity ? formatQuantity(selectedBillData.summary.totalQuantity) : "—"}</td><td>—</td><td className="text-right font-mono">{selectedBillData.summary.thisBill ? formatCurrency(selectedBillData.summary.thisBill) : "—"}</td><td className="text-right font-mono">{selectedBillData.summary.previousBill ? formatCurrency(selectedBillData.summary.previousBill) : "—"}</td><td className="text-right font-mono">{formatCurrency(selectedBillData.summary.totalAmount)}</td></tr>
                        <tr className="bg-muted/20 font-semibold"><td colSpan={6}>Less Advance</td><td className="text-right font-mono">{selectedBillData.advances.thisBillAdvance ? formatCurrency(selectedBillData.advances.thisBillAdvance) : "—"}</td><td className="text-right font-mono">{selectedBillData.advances.previousBillAdvance ? formatCurrency(selectedBillData.advances.previousBillAdvance) : "—"}</td><td className="text-right font-mono">{selectedBillData.advances.thisBillAdvance + selectedBillData.advances.previousBillAdvance ? formatCurrency(selectedBillData.advances.thisBillAdvance + selectedBillData.advances.previousBillAdvance) : "—"}</td></tr>
                        <tr className="bg-muted/40 font-bold"><td colSpan={6}>Balance</td><td className="text-right font-mono">{formatCurrency(selectedBillData.summary.thisBill - selectedBillData.advances.thisBillAdvance)}</td><td className="text-right font-mono">{formatCurrency(selectedBillData.summary.previousBill - selectedBillData.advances.previousBillAdvance)}</td><td className="text-right font-mono">{formatCurrency(selectedBillData.summary.totalAmount - selectedBillData.advances.thisBillAdvance - selectedBillData.advances.previousBillAdvance)}</td></tr>
                      </>}
                    </tbody>
                  </table>
                </div>
                <div className="running-bill-signatures mt-24 flex justify-end px-[8%] text-center text-sm">
                  <div className="running-bill-signature w-[38%]">
                    <div className="running-bill-signature-line min-h-7 border-t border-foreground" />
                    <span>Checked By</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </Layout>
  );
}
