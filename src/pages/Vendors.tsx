import { useState, useMemo, useEffect } from "react";
import Layout from "@/components/Layout";
import PageHeader from "@/components/PageHeader";
import { formatCurrency } from "@/lib/mock-data";
import { useVendors } from "@/hooks/useVendors";
import { useAuth } from "@/context/AuthContext";
import { useSelectedProject } from "@/context/SelectedProjectContext";
import { useProjects } from "@/hooks/useProjects";
import { AddVendorDialog } from "@/components/dialogs/AddVendorDialog";
import { EditVendorDialog } from "@/components/dialogs/EditVendorDialog";
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
import { deleteVendor } from "@/services/vendorsService";
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
import type { ApiVendor } from "@/services/vendorsService";
import { useTablePagination } from "@/hooks/useTablePagination";
import { TablePagination } from "@/components/TablePagination";

export default function Vendors() {
  const { user } = useAuth();
  const { projects } = useProjects();
  const isSiteManager = user?.role === "Site Manager";
  const assignedProjectId = user?.assignedProjectId ?? null;

  const { selectedProjectId, setSelectedProjectId } = useSelectedProject();
  const [searchQuery, setSearchQuery] = useState("");
  const effectiveProjectId = isSiteManager ? assignedProjectId : (selectedProjectId || null);

  const { vendors, loading, error, refetch } = useVendors(effectiveProjectId);

  const filteredVendors = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return vendors;

    return vendors.filter((v) => {
      return (
        v.name.toLowerCase().includes(q) ||
        (v.phone && v.phone.toLowerCase().includes(q)) ||
        (v.description && v.description.toLowerCase().includes(q))
      );
    });
  }, [vendors, searchQuery]);

  const projectOptions = useMemo(() => {
    if (isSiteManager && assignedProjectId) {
      const p = projects.find((pr) => pr.id === assignedProjectId);
      return p ? [{ id: p.id, name: p.name }] : [];
    }
    return projects;
  }, [isSiteManager, assignedProjectId, projects]);
  const [addOpen, setAddOpen] = useState(false);
  const [editVendor, setEditVendor] = useState<ApiVendor | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteVendorState, setDeleteVendorState] = useState<ApiVendor | null>(null);
  const selectedProjectName = isSiteManager
    ? (projects.find((p) => p.id === assignedProjectId)?.name ?? "Project")
    : (projects.find((p) => p.id === selectedProjectId)?.name ?? "Project");

  const canEditDelete = user?.role !== "Site Manager";
  const vendorsPagination = useTablePagination(filteredVendors, { defaultPageSize: 12 });

  const handleDeleteClick = (v: ApiVendor) => {
    if (v.remaining > 0) {
      toast.error(`Cannot delete "${v.name}" — they have remaining amount of ${formatCurrency(v.remaining)}. Clear the outstanding balance first.`);
      return;
    }
    setDeleteVendorState(v);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteVendorState) return;
    try {
      await deleteVendor(deleteVendorState.id);
      toast.success("Vendor deleted");
      setDeleteVendorState(null);
      refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete vendor");
    }
  };

  return (
    <Layout>
      <PageHeader
        title="Vendors"
        subtitle="Supplier & vendor management"
        printProjectName={selectedProjectName}
        printTargetId="vendors-table"
        actions={<Button variant="warning" size="sm" onClick={() => setAddOpen(true)} disabled={!effectiveProjectId}><Plus className="h-4 w-4 mr-1" />Add Vendor</Button>}
      />
      <AddVendorDialog open={addOpen} onOpenChange={setAddOpen} projectId={effectiveProjectId} onSuccess={refetch} />
      <EditVendorDialog open={editOpen} onOpenChange={setEditOpen} vendor={editVendor} onSave={refetch} />
      <AlertDialog open={!!deleteVendorState} onOpenChange={(open) => !open && setDeleteVendorState(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete vendor?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete &quot;{deleteVendorState?.name}&quot;. This action cannot be undone.
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
        {!isSiteManager && (
          <div>
            <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Project</Label>
            <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
              <SelectTrigger className="mt-1 w-[220px]">
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
          <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Search</Label>
          <Input
            className="mt-1"
            placeholder="Name, phone, description"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </div>
      </div>

      {!effectiveProjectId && !isSiteManager && (
        <p className="text-muted-foreground mb-4">Select a project to view and manage vendors.</p>
      )}

      {isSiteManager && !assignedProjectId && (
        <p className="text-muted-foreground mb-4">You are not assigned to a project. Contact an admin.</p>
      )}

      {error && <p className="text-destructive text-sm mb-4">{error}</p>}
      {effectiveProjectId && loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : effectiveProjectId ? (
        <div id="vendors-table" className="border-2 border-border">
          <div className="overflow-x-auto">
            <table className="w-full text-base">
              <thead>
                <tr className="border-b-2 border-border bg-primary text-primary-foreground">
                  <th className="px-4 py-2.5 text-left text-sm font-bold uppercase tracking-wider">Vendor</th>
                  <th className="px-4 py-2.5 text-left text-sm font-bold uppercase tracking-wider">Phone</th>
                  <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Total Billed</th>
                  <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Total Paid</th>
                  <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Remaining</th>
                {canEditDelete && <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider print-hidden">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {vendorsPagination.paginatedItems.length === 0 ? (
                  <tr>
                    <td
                      colSpan={canEditDelete ? 6 : 5}
                      className="px-4 py-8 text-center text-muted-foreground"
                    >
                      {vendors.length === 0
                        ? "No vendors for this project yet. Add a vendor to get started."
                        : "No vendors match your search."}
                    </td>
                  </tr>
                ) : (
                  vendorsPagination.paginatedItems.map((v) => (
                    <tr key={v.id} className="border-b border-border hover:bg-accent/50 transition-colors">
                      <td className="px-4 py-3">
                        <Link to={`/vendors/${v.id}`} className="font-bold hover:underline">{v.name}</Link>
                        <p className="text-xs text-muted-foreground">{v.description}</p>
                      </td>
                      <td className="px-4 py-3 text-sm font-mono">{v.phone}</td>
                      <td className="px-4 py-3 text-right font-mono text-sm">{formatCurrency(v.totalBilled)}</td>
                      <td className="px-4 py-3 text-right font-mono text-sm text-success">{formatCurrency(v.totalPaid)}</td>
                      <td className="px-4 py-3 text-right font-mono text-sm text-destructive">{v.remaining > 0 ? formatCurrency(v.remaining) : "—"}</td>
                  {canEditDelete && (
                    <td className="px-4 py-3 text-right print-hidden">
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setEditVendor(v); setEditOpen(true); }} title="Edit">
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              onClick={() => handleDeleteClick(v)}
                              title={v.remaining > 0 ? "Cannot delete: outstanding balance" : "Delete"}
                              disabled={v.remaining > 0}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
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
          {vendors.length > 0 && (
            <div className="print-hidden">
              <TablePagination
                pageSize={vendorsPagination.pageSize}
                onPageSizeChange={vendorsPagination.setPageSize}
                page={vendorsPagination.page}
                totalPages={vendorsPagination.totalPages}
                totalItems={vendorsPagination.totalItems}
                onPrevious={vendorsPagination.goPrev}
                onNext={vendorsPagination.goNext}
                canPrevious={vendorsPagination.canPrev}
                canNext={vendorsPagination.canNext}
                pageSizeOptions={vendorsPagination.pageSizeOptions}
                startIndexOneBased={vendorsPagination.startIndexOneBased}
                endIndex={vendorsPagination.endIndex}
              />
            </div>
          )}
        </div>
      ) : null}
    </Layout>
  );
}
