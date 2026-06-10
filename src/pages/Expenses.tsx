import { useState, useEffect, useMemo } from "react";
import Layout from "@/components/Layout";
import PageHeader from "@/components/PageHeader";
import StatCard from "@/components/StatCard";
import { formatCurrency } from "@/lib/mock-data";
import { useAuth } from "@/context/AuthContext";
import { useSelectedProject } from "@/context/SelectedProjectContext";
import { useProjects } from "@/hooks/useProjects";
import { useExpenses, useExpenseCategories } from "@/hooks/useExpenses";
import { AddExpenseDialog } from "@/components/dialogs/AddExpenseDialog";
import { EditExpenseDialog } from "@/components/dialogs/EditExpenseDialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Plus, Pencil, Trash2 } from "lucide-react";
import { Receipt } from "lucide-react";
import { toast } from "sonner";
import { deleteExpense } from "@/services/expensesService";
import type { ApiExpense } from "@/services/expensesService";

const DEFAULT_PAGE_SIZE = 12;
const PAGE_SIZE_OPTIONS = [12, 24, 50, 100];

const EXPENSES_PRINT_CSS = `
  .expenses-prev-header {
    display: block !important;
    font-size: 11px;
    font-weight: 600;
    padding: 6px 0 10px;
    border-bottom: 1px solid #000;
    margin-bottom: 6px;
  }
`;

export default function Expenses() {
  const { user: currentUser } = useAuth();
  const { projects } = useProjects();
  const isSiteManager = currentUser?.role === "Site Manager";
  const assignedProjectId = currentUser?.assignedProjectId ?? null;
  const assignedProjectName = currentUser?.assignedProjectName ?? null;

  const { selectedProjectId, setSelectedProjectId } = useSelectedProject();
  const [addOpen, setAddOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const effectiveProjectId = isSiteManager ? assignedProjectId : (selectedProjectId || null);

  const dateRangeActive = !!startDate;
  const showPrevCard = dateRangeActive;
  const showTotalCol = dateRangeActive;

  const { expenses, total, totalAmount, previousTotal, loading, error, refetch } = useExpenses({
    projectId: effectiveProjectId,
    search: searchQuery,
    category: categoryFilter,
    page,
    pageSize: dateRangeActive ? 500 : pageSize,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
  });

  const [categoriesRefreshKey, setCategoriesRefreshKey] = useState(0);
  const categories = useExpenseCategories(effectiveProjectId, categoriesRefreshKey);

  const [editExpense, setEditExpense] = useState<ApiExpense | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteExpenseState, setDeleteExpenseState] = useState<ApiExpense | null>(null);

  const canEditDelete = !isSiteManager;

  const handleSuccess = () => {
    refetch();
    setCategoriesRefreshKey((k) => k + 1);
  };

  const handleDeleteClick = (exp: ApiExpense) => {
    setDeleteExpenseState(exp);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteExpenseState) return;
    try {
      await deleteExpense(deleteExpenseState.id);
      toast.success("Expense deleted");
      setDeleteExpenseState(null);
      handleSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete expense");
    }
  };

  const comboboxOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [
      { value: "all", label: "All categories" },
      ...categories.map((c) => ({ value: c, label: c })),
    ];
    return opts;
  }, [categories]);

  const projectsForSelector = useMemo(
    () => projects.filter((p) => p.status === "Active" || p.status === "On Hold"),
    [projects]
  );

  const subtitle =
    isSiteManager && assignedProjectName
      ? `Project-level expense tracking — ${assignedProjectName}`
      : effectiveProjectId
        ? `Project-level expense tracking — ${projects.find((p) => p.id === effectiveProjectId)?.name ?? "Project"}`
        : "Project-level expense tracking — Select project";
  const selectedProjectName = isSiteManager
    ? (assignedProjectName ?? "Project")
    : (projects.find((p) => p.id === effectiveProjectId)?.name ?? "Project");

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const startIndexOneBased = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const endIndex = Math.min(page * pageSize, total);

  const runningTotals = useMemo(() => {
    let acc = previousTotal;
    return expenses.map((e) => { acc += e.amount; return acc; });
  }, [expenses, previousTotal]);

  const canAdd = !!effectiveProjectId;

  useEffect(() => {
    setPage(1);
  }, [searchQuery, categoryFilter, startDate, endDate]);

  useEffect(() => {
    if (endDate && startDate && endDate < startDate) {
      setEndDate(startDate);
    }
  }, [startDate, endDate]);

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setPage(1);
  };

  return (
    <Layout>
      <PageHeader
        title="Expenses"
        subtitle={subtitle}
        printProjectName={selectedProjectName}
        printTargetId="expenses-table"
        printOptions={{ additionalPrintCss: EXPENSES_PRINT_CSS }}
        actions={
          <Button
            variant="warning"
            size="sm"
            onClick={() => setAddOpen(true)}
            disabled={!canAdd}
          >
            <Plus className="h-4 w-4 mr-1" />Add Expense
          </Button>
        }
      />
      <AddExpenseDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        projectId={effectiveProjectId}
        categoriesRefreshKey={categoriesRefreshKey}
        onSuccess={handleSuccess}
      />
      <EditExpenseDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        expense={editExpense}
        projectId={effectiveProjectId}
        categoriesRefreshKey={categoriesRefreshKey}
        onSave={handleSuccess}
      />
      <AlertDialog open={!!deleteExpenseState} onOpenChange={(open) => !open && setDeleteExpenseState(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete expense?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete &quot;{deleteExpenseState?.description}&quot; ({formatCurrency(deleteExpenseState?.amount ?? 0)}). This action cannot be undone.
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
      <div className="flex flex-wrap items-end gap-4 p-4 border-2 border-border mb-4 print-hidden">
        {!isSiteManager && (
          <div className="min-w-[200px]">
            <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Project</Label>
            <Select value={selectedProjectId || ""} onValueChange={(v) => { setSelectedProjectId(v); setPage(1); }}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Select project" />
              </SelectTrigger>
              <SelectContent>
                {projectsForSelector.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">Filter expenses by project</p>
          </div>
        )}
        {isSiteManager && assignedProjectName && (
          <div className="min-w-[200px]">
            <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Project</Label>
            <p className="mt-1.5 text-sm font-medium">{assignedProjectName}</p>
          </div>
        )}
        <div className="flex-1 min-w-[220px] max-w-xs">
          <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Search</Label>
          <Input
            className="mt-1"
            placeholder="Description..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="min-w-[200px]">
          <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Category</Label>
          <Combobox
            options={comboboxOptions}
            value={categoryFilter}
            onValueChange={(v) => setCategoryFilter(v ?? "all")}
            placeholder="All categories"
            searchPlaceholder="Search category..."
          />
        </div>
        <div className="min-w-[180px]">
          <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Start date</Label>
          <Input
            type="date"
            className="mt-1"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        <div className="min-w-[180px]">
          <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">End date</Label>
          <Input
            type="date"
            className="mt-1"
            value={endDate}
            min={startDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
      </div>

      {!isSiteManager && !effectiveProjectId && (
        <p className="text-muted-foreground mb-4">Select a project to view expenses.</p>
      )}

      {isSiteManager && !assignedProjectId && (
        <p className="text-muted-foreground mb-4">You are not assigned to a project. Contact an admin.</p>
      )}

      {error && <p className="text-destructive text-sm mb-4">{error}</p>}

      {effectiveProjectId && !(isSiteManager && !assignedProjectId) && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-4">
          <StatCard label="Total Expense" value={formatCurrency(totalAmount)} icon={<Receipt className="h-4 w-4" />} variant="warning" title={formatCurrency(totalAmount)} />
          <StatCard label="Total Records" value={String(total)} variant="default" />
          {showPrevCard && (
            <StatCard label="Previous (before range)" value={formatCurrency(previousTotal)} variant="default" title={formatCurrency(previousTotal)} />
          )}
        </div>
      )}

      {effectiveProjectId && !(isSiteManager && !assignedProjectId) ? (
        <div id="expenses-table" className="border-2 border-border">
          {showPrevCard && (
            <div className="expenses-prev-header hidden">
              Previous (before {startDate}){categoryFilter !== "all" ? ` — ${categoryFilter}` : ""}: {formatCurrency(previousTotal)}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-base">
              <thead>
                <tr className="border-b-2 border-border bg-primary text-primary-foreground">
                  <th className="px-4 py-2.5 text-left text-sm font-bold uppercase tracking-wider">Date</th>
                  <th className="px-4 py-2.5 text-left text-sm font-bold uppercase tracking-wider">Description</th>
                  <th className="px-4 py-2.5 text-left text-sm font-bold uppercase tracking-wider">Category</th>
                  <th className="px-4 py-2.5 text-left text-sm font-bold uppercase tracking-wider">Mode</th>
                  <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Amount</th>
                  {showTotalCol && <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Total</th>}
                  {canEditDelete && <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider print-hidden">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={(canEditDelete ? 6 : 5) + (showTotalCol ? 1 : 0)} className="px-4 py-8 text-center text-muted-foreground">
                      Loading…
                    </td>
                  </tr>
                ) : expenses.length === 0 ? (
                  <tr>
                    <td colSpan={(canEditDelete ? 6 : 5) + (showTotalCol ? 1 : 0)} className="px-4 py-8 text-center text-muted-foreground">
                      No expenses match your filters.
                    </td>
                  </tr>
                ) : (
                  expenses.map((exp, i) => (
                    <tr key={exp.id} className="border-b border-border hover:bg-accent/50 transition-colors">
                      <td className="px-4 py-3 text-sm">{exp.date}</td>
                      <td className="px-4 py-3 font-bold text-sm">{exp.description}</td>
                      <td className="px-4 py-3 text-sm uppercase text-muted-foreground">{exp.category}</td>
                      <td className="px-4 py-3 text-sm">{exp.paymentMode}</td>
                      <td className="px-4 py-3 text-right font-mono text-sm font-bold">{formatCurrency(exp.amount)}</td>
                      {showTotalCol && (
                        <td className="px-4 py-3 text-right font-mono text-sm font-bold">{formatCurrency(runningTotals[i])}</td>
                      )}
                      {canEditDelete && (
                        <td className="px-4 py-3 text-right print-hidden">
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setEditExpense(exp); setEditOpen(true); }} title="Edit">
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => handleDeleteClick(exp)} title="Delete">
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
          {!loading && total > 0 && !dateRangeActive && (
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
      ) : null}
    </Layout>
  );
}
