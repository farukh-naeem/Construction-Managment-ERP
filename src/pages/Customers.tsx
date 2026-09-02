import { useState, useMemo } from "react";
import Layout from "@/components/Layout";
import PageHeader from "@/components/PageHeader";
import { formatCurrency } from "@/lib/mock-data";
import { useCustomers } from "@/hooks/useCustomers";
import { useAuth } from "@/context/AuthContext";
import { useSelectedProject } from "@/context/SelectedProjectContext";
import { useProjects } from "@/hooks/useProjects";
import { AddCustomerDialog } from "@/components/dialogs/AddCustomerDialog";
import { EditCustomerDialog } from "@/components/dialogs/EditCustomerDialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { deleteCustomer, type ApiCustomer } from "@/services/customersService";
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
import { useTablePagination } from "@/hooks/useTablePagination";
import { TablePagination } from "@/components/TablePagination";

export default function Customers() {
  const { user } = useAuth();
  const { projects } = useProjects();
  const isSiteManager = user?.role === "Site Manager";

  const { selectedProjectId, setSelectedProjectId } = useSelectedProject();
  const [searchQuery, setSearchQuery] = useState("");
  const effectiveProjectId = selectedProjectId || null;

  const { customers, loading, error, refetch } = useCustomers(effectiveProjectId);

  const filteredCustomers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.phone.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q)
    );
  }, [customers, searchQuery]);

  const [addOpen, setAddOpen] = useState(false);
  const [editCustomer, setEditCustomer] = useState<ApiCustomer | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteCustomerState, setDeleteCustomerState] = useState<ApiCustomer | null>(null);
  const selectedProjectName = projects.find((p) => p.id === selectedProjectId)?.name ?? "Project";

  const canEditDelete = user?.role !== "Site Manager";
  const customersPagination = useTablePagination(filteredCustomers, { defaultPageSize: 12 });

  const handleDeleteClick = (c: ApiCustomer) => {
    if (c.balance < 0) {
      toast.error(
        `Cannot delete "${c.name}" — they owe ${formatCurrency(Math.abs(c.balance))}. Settle the receivable first.`
      );
      return;
    }
    if (c.balance > 0) {
      toast.error(
        `Cannot delete "${c.name}" — they hold an unused credit of ${formatCurrency(c.balance)}. Resolve it first.`
      );
      return;
    }
    setDeleteCustomerState(c);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteCustomerState) return;
    try {
      await deleteCustomer(deleteCustomerState.id);
      toast.success("Customer deleted");
      setDeleteCustomerState(null);
      refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete customer");
      setDeleteCustomerState(null);
    }
  };

  return (
    <Layout>
      <PageHeader
        title="Customers"
        subtitle="Buyers, receivables & payments received"
        printProjectName={selectedProjectName}
        printTargetId="customers-table"
        actions={
          <Button variant="warning" size="sm" onClick={() => setAddOpen(true)} disabled={!effectiveProjectId}>
            <Plus className="h-4 w-4 mr-1" />Add Customer
          </Button>
        }
      />

      <AddCustomerDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        projectId={effectiveProjectId}
        onSuccess={refetch}
      />
      <EditCustomerDialog
        open={editOpen}
        onOpenChange={(open) => {
          setEditOpen(open);
          if (!open) setEditCustomer(null);
        }}
        customer={editCustomer}
        onSave={refetch}
      />

      <AlertDialog open={!!deleteCustomerState} onOpenChange={(open) => !open && setDeleteCustomerState(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete customer?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete &quot;{deleteCustomerState?.name}&quot;. This action cannot be undone.
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

      <div className="flex flex-wrap items-end gap-4 mb-4 p-4 border-2 border-border">
        {projects.length > 0 && (
          <div>
            <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Project</Label>
            <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
              <SelectTrigger className="mt-1 w-[220px]"><SelectValue placeholder="Select project" /></SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="flex-1 min-w-[220px] max-w-xs">
          <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Search</Label>
          <Input
            className="mt-1"
            placeholder="Name, phone, description"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </div>
      </div>

      {!effectiveProjectId && projects.length > 0 && (
        <p className="text-muted-foreground mb-4">Select a project to view and manage customers.</p>
      )}
      {projects.length === 0 && (
        <p className="text-muted-foreground mb-4">
          {isSiteManager ? "You are not assigned to any project. Contact an admin." : "No projects yet."}
        </p>
      )}
      {error && <p className="text-destructive text-sm mb-4">{error}</p>}

      <div id="customers-table" className="border-2 border-border">
        <div className="overflow-x-auto">
          <table className="w-full text-base">
            <thead>
              <tr className="border-b-2 border-border bg-primary text-primary-foreground">
                <th className="px-4 py-2.5 text-left text-sm font-bold uppercase tracking-wider">Customer</th>
                <th className="px-4 py-2.5 text-left text-sm font-bold uppercase tracking-wider">Phone</th>
                <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Total Sold</th>
                <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Total Received</th>
                <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Receivable</th>
                <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Credit</th>
                {canEditDelete && (
                  <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider print-hidden">Actions</th>
                )}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={canEditDelete ? 7 : 6} className="px-4 py-8 text-center text-muted-foreground">Loading…</td>
                </tr>
              ) : customersPagination.paginatedItems.length === 0 ? (
                <tr>
                  <td colSpan={canEditDelete ? 7 : 6} className="px-4 py-8 text-center text-muted-foreground">
                    {customers.length === 0
                      ? "No customers for this project yet. Add a customer to get started."
                      : "No customers match your search."}
                  </td>
                </tr>
              ) : (
                customersPagination.paginatedItems.map((c) => {
                  const receivable = Math.max(0, -c.balance);
                  const credit = Math.max(0, c.balance);
                  return (
                    <tr key={c.id} className="border-b border-border hover:bg-accent/50 transition-colors">
                      <td className="px-4 py-3">
                        <Link to={`/customers/${c.id}`} className="font-bold hover:underline">{c.name}</Link>
                        <p className="text-xs text-muted-foreground">{c.description}</p>
                      </td>
                      <td className="px-4 py-3 text-sm font-mono">{c.phone}</td>
                      <td className="px-4 py-3 text-right font-mono text-sm">{formatCurrency(c.totalSold)}</td>
                      <td className="px-4 py-3 text-right font-mono text-sm text-success">{formatCurrency(c.totalReceived)}</td>
                      <td className="px-4 py-3 text-right font-mono text-sm text-destructive">
                        {receivable > 0 ? formatCurrency(receivable) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm text-info">
                        {credit > 0 ? formatCurrency(credit) : "—"}
                      </td>
                      {canEditDelete && (
                        <td className="px-4 py-3 text-right print-hidden">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => { setEditCustomer(c); setEditOpen(true); }}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDeleteClick(c)}
                              disabled={c.balance !== 0}
                              title={
                                c.balance < 0
                                  ? "Cannot delete — outstanding receivable"
                                  : c.balance > 0
                                    ? "Cannot delete — unused credit"
                                    : "Delete customer"
                              }
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {effectiveProjectId && filteredCustomers.length > 0 && (
          <div className="print-hidden">
            <TablePagination
              pageSize={customersPagination.pageSize}
              onPageSizeChange={customersPagination.setPageSize}
              page={customersPagination.page}
              totalPages={customersPagination.totalPages}
              totalItems={customersPagination.totalItems}
              onPrevious={customersPagination.goPrev}
              onNext={customersPagination.goNext}
              canPrevious={customersPagination.canPrev}
              canNext={customersPagination.canNext}
              pageSizeOptions={customersPagination.pageSizeOptions}
              startIndexOneBased={customersPagination.startIndexOneBased}
              endIndex={customersPagination.endIndex}
            />
          </div>
        )}
      </div>
    </Layout>
  );
}
