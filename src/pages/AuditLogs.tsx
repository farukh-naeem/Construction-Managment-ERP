import { useState, useEffect, useCallback } from "react";
import Layout from "@/components/Layout";
import { formatDisplayDateTime } from "@/lib/pktDate";
import PageHeader from "@/components/PageHeader";
import StatusBadge from "@/components/StatusBadge";
import {
  listAuditLogs,
  getAuditLogFilterOptions,
  type ApiAuditLog,
  type AuditLogFilterOptions,
} from "@/services/auditLogsService";
import { TablePagination } from "@/components/TablePagination";
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
import { X } from "lucide-react";
import { toast } from "sonner";

const PAGE_SIZE_OPTIONS = [12, 24, 50, 100];
const DEFAULT_PAGE_SIZE = 12;

const MODULE_LABELS: Record<string, string> = {
  projects: "Projects",
  machinery: "Machinery",
  machinery_ledger: "Machinery Ledger",
  machinery_payments: "Machinery Payments",
  employees: "Employees",
  vendors: "Vendors",
  vendor_payments: "Vendor Payments",
  contractors: "Contractors",
  contractor_entries: "Contractor Entries",
  contractor_payments: "Contractor Payments",
  consumable_items: "Consumable Items",
  item_ledger: "Consumable Ledger",
  non_consumable_inventory: "Non-Consumable Inventory",
  non_consumable_ledger: "Non-Consumable Ledger",
  stock_consumption: "Stock Consumption",
  expenses: "Expenses",
  project_ledger: "Project Ledger",
  bank_transactions: "Bank Transactions",
  clients: "Clients",
  users: "Users",
};

function moduleLabel(module: string): string {
  return MODULE_LABELS[module] ?? module;
}

export default function AuditLogs() {
  const [logs, setLogs] = useState<ApiAuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const [filterOptions, setFilterOptions] = useState<AuditLogFilterOptions>({ modules: [], users: [], projects: [] });

  const [moduleFilter, setModuleFilter] = useState<string>("all");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [userFilter, setUserFilter] = useState<string>("all");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [searchInput, setSearchInput] = useState<string>("");

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  useEffect(() => {
    getAuditLogFilterOptions()
      .then(setFilterOptions)
      .catch(() => setFilterOptions({ modules: [], users: [], projects: [] }));
  }, []);

  // Debounce free-text search so we don't fire a request per keystroke.
  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const fetchLogs = useCallback(async () => {
    try {
      const params: Parameters<typeof listAuditLogs>[0] = { page, pageSize };
      if (moduleFilter !== "all") params.module = moduleFilter;
      if (actionFilter !== "all") params.action = actionFilter;
      if (userFilter !== "all") params.userId = userFilter;
      if (projectFilter !== "all") params.projectId = projectFilter;
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;
      if (search) params.search = search;
      const res = await listAuditLogs(params);
      setLogs(res.logs);
      setTotal(res.total);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load audit logs");
    } finally {
      setLoading(false);
    }
  }, [moduleFilter, actionFilter, userFilter, projectFilter, startDate, endDate, search, page, pageSize]);

  useEffect(() => {
    setPage(1);
  }, [moduleFilter, actionFilter, userFilter, projectFilter, startDate, endDate, search]);

  useEffect(() => {
    setLoading(true);
    fetchLogs();
  }, [fetchLogs]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const startIndexOneBased = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const endIndex = Math.min(page * pageSize, total);

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setPage(1);
  };

  const hasActiveFilters =
    moduleFilter !== "all" ||
    actionFilter !== "all" ||
    userFilter !== "all" ||
    projectFilter !== "all" ||
    !!startDate ||
    !!endDate ||
    !!search;

  const clearFilters = () => {
    setModuleFilter("all");
    setActionFilter("all");
    setUserFilter("all");
    setProjectFilter("all");
    setStartDate("");
    setEndDate("");
    setSearchInput("");
    setSearch("");
  };

  return (
    <Layout>
      <PageHeader
        title="Audit Logs"
        subtitle="System-wide activity trail — Super Admin access"
        printTargetId="audit-table"
      />
      <div className="flex flex-wrap items-end gap-4 mb-6">
        <div>
          <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Project</Label>
          <Select value={projectFilter} onValueChange={setProjectFilter}>
            <SelectTrigger className="mt-1 w-[180px]">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All projects</SelectItem>
              {filterOptions.projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">User</Label>
          <Select value={userFilter} onValueChange={setUserFilter}>
            <SelectTrigger className="mt-1 w-[180px]">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All users</SelectItem>
              {filterOptions.users.map((u) => (
                <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Module</Label>
          <Select value={moduleFilter} onValueChange={setModuleFilter}>
            <SelectTrigger className="mt-1 w-[180px]">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All modules</SelectItem>
              {filterOptions.modules.map((m) => (
                <SelectItem key={m} value={m}>{moduleLabel(m)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Action</Label>
          <Select value={actionFilter} onValueChange={setActionFilter}>
            <SelectTrigger className="mt-1 w-[140px]">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="create">Create</SelectItem>
              <SelectItem value="update">Edit</SelectItem>
              <SelectItem value="delete">Delete</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">From</Label>
          <Input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="mt-1 w-[160px]"
          />
        </div>
        <div>
          <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">To</Label>
          <Input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="mt-1 w-[160px]"
          />
        </div>
        <div className="flex-1 min-w-[200px]">
          <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Search</Label>
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Description, entity, user, project…"
            className="mt-1"
          />
        </div>
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1">
            <X className="h-3.5 w-3.5" /> Clear filters
          </Button>
        )}
      </div>
      <div id="audit-table" className="border-2 border-border">
        <div className="overflow-x-auto">
          <table className="w-full text-base">
            <thead>
              <tr className="border-b-2 border-border bg-primary text-primary-foreground">
                <th className="px-4 py-2.5 text-left text-sm font-bold uppercase tracking-wider">Timestamp</th>
                <th className="px-4 py-2.5 text-left text-sm font-bold uppercase tracking-wider">User</th>
                <th className="px-4 py-2.5 text-left text-sm font-bold uppercase tracking-wider">Role</th>
                <th className="px-4 py-2.5 text-left text-sm font-bold uppercase tracking-wider">Action</th>
                <th className="px-4 py-2.5 text-left text-sm font-bold uppercase tracking-wider">Module</th>
                <th className="px-4 py-2.5 text-left text-sm font-bold uppercase tracking-wider">Project</th>
                <th className="px-4 py-2.5 text-left text-sm font-bold uppercase tracking-wider">Description</th>
                <th className="px-4 py-2.5 text-left text-sm font-bold uppercase tracking-wider">Changes</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                    No audit log entries match these filters.
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="border-b border-border hover:bg-accent/50 transition-colors">
                    <td className="px-4 py-3 text-sm font-mono">{formatDisplayDateTime(log.timestamp)}</td>
                    <td className="px-4 py-3 text-sm">{log.user}</td>
                    <td className="px-4 py-3 text-sm uppercase text-muted-foreground">{log.role}</td>
                    <td className="px-4 py-3"><StatusBadge status={log.action} /></td>
                    <td className="px-4 py-3 text-sm font-bold">{moduleLabel(log.module)}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{log.projectName ?? "—"}</td>
                    <td className="px-4 py-3 text-sm">{log.description}</td>
                    <td className="px-4 py-3 text-sm">
                      {log.oldValue && log.newValue && (
                        <span>
                          <span className="text-destructive line-through">{log.oldValue}</span>
                          {" → "}
                          <span className="text-success">{log.newValue}</span>
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {!loading && logs.length > 0 && (
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
        )}
      </div>
    </Layout>
  );
}
