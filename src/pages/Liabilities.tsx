import { useState, useMemo, useEffect } from "react";
import Layout from "@/components/Layout";
import PageHeader from "@/components/PageHeader";
import StatCard from "@/components/StatCard";
import { ChartCard } from "@/components/charts/ChartCard";
import { formatCurrency } from "@/lib/mock-data";
import { useAuth } from "@/context/AuthContext";
import { useSelectedProject } from "@/context/SelectedProjectContext";
import { useProjects } from "@/hooks/useProjects";
import { useVendors } from "@/hooks/useVendors";
import { useEmployees } from "@/hooks/useEmployees";
import { useMachines } from "@/hooks/useMachines";
import { useContractors } from "@/hooks/useContractors";
import { VendorPaymentDialog } from "@/components/dialogs/VendorPaymentDialog";
import { ContractorPaymentDialog } from "@/components/dialogs/ContractorPaymentDialog";
import { MachinePaymentDialog } from "@/components/dialogs/MachinePaymentDialog";
import { EmployeeLiabilityPaymentDialog } from "@/components/dialogs/EmployeeLiabilityPaymentDialog";
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
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { Link } from "react-router-dom";
import { Banknote, Loader2 } from "lucide-react";
import type { ApiVendor } from "@/services/vendorsService";
import type { ApiContractorWithTotals } from "@/services/contractorsService";
import type { ApiMachineWithTotals } from "@/services/machinesService";
import type { ApiEmployeeWithSnapshot } from "@/services/employeesService";

const LIABILITY_PIE_COLORS = ["hsl(var(--destructive))", "hsl(var(--warning))", "hsl(var(--chart-3))", "hsl(var(--chart-4))"];

export default function Liabilities() {
  const { user } = useAuth();
  const { projects } = useProjects();
  const { selectedProjectId, setSelectedProjectId } = useSelectedProject();
  const isSiteManager = user?.role === "Site Manager";

  const effectiveProjectId = selectedProjectId || null;
  const projectIdForApi = effectiveProjectId ?? undefined;

  const [entityFilter, setEntityFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Only apply the date filter server-side once both ends are set (or leave it open-ended if the
  // caller wants a from-only/to-only range) — an empty string must not turn into "" !== undefined.
  const dateFromForApi = dateFrom || undefined;
  const dateToForApi = dateTo || undefined;

  const { vendors, loading: vendorsLoading, refetch: refetchVendors } = useVendors(projectIdForApi, dateFromForApi, dateToForApi);
  const { employees, loading: employeesLoading, refetch: refetchEmployees } = useEmployees(projectIdForApi, undefined, "Regular", dateFromForApi, dateToForApi);
  const { machines, loading: machinesLoading, refetch: refetchMachines } = useMachines(projectIdForApi, 1, 500, dateFromForApi, dateToForApi);
  const { contractors, loading: contractorsLoading, refetch: refetchContractors } = useContractors(projectIdForApi, dateFromForApi, dateToForApi);

  const projectsForSelector = useMemo(
    () => projects.filter((p) => p.status === "Active" || p.status === "On Hold" || p.status === "Completed"),
    [projects]
  );

  // Payment dialog state
  const [vendorPaymentVendor, setVendorPaymentVendor] = useState<ApiVendor | null>(null);
  const [contractorPaymentContractor, setContractorPaymentContractor] = useState<ApiContractorWithTotals | null>(null);
  const [machinePaymentMachine, setMachinePaymentMachine] = useState<ApiMachineWithTotals | null>(null);
  const [employeePaymentEmployee, setEmployeePaymentEmployee] = useState<ApiEmployeeWithSnapshot | null>(null);

  const showVendors = entityFilter === "all" || entityFilter === "vendor";
  const showContractors = entityFilter === "all" || entityFilter === "contractor";
  const showEmployees = entityFilter === "all" || entityFilter === "employee";
  const showMachines = entityFilter === "all" || entityFilter === "machinery";

  const vendorDues = useMemo(() => (showVendors ? vendors.reduce((s, v) => s + v.remaining, 0) : 0), [vendors, showVendors]);
  const contractorDues = useMemo(() => (showContractors ? contractors.reduce((s, c) => s + c.remaining, 0) : 0), [contractors, showContractors]);
  const salaryDues = useMemo(() => (showEmployees ? employees.reduce((s, e) => s + (e.totalDue ?? 0), 0) : 0), [employees, showEmployees]);
  const machineryDues = useMemo(() => (showMachines ? machines.reduce((s, m) => s + m.totalPending, 0) : 0), [machines, showMachines]);
  const totalLiabilities = vendorDues + contractorDues + salaryDues + machineryDues;

  const liabilityBreakdownData = useMemo(() => {
    if (totalLiabilities === 0) return [];
    return [
      { name: "Vendor Dues", value: vendorDues, amount: vendorDues },
      { name: "Contractor Dues", value: contractorDues, amount: contractorDues },
      { name: "Salary Dues", value: salaryDues, amount: salaryDues },
      { name: "Machinery Dues", value: machineryDues, amount: machineryDues },
    ].filter((d) => d.value > 0);
  }, [totalLiabilities, vendorDues, contractorDues, salaryDues, machineryDues]);

  const topEntitiesData = useMemo(() => {
    const items: { name: string; pending: number; type: string }[] = [];
    if (showVendors) {
      vendors
        .filter((v) => v.remaining > 0)
        .forEach((v) => items.push({ name: v.name.length > 18 ? v.name.slice(0, 16) + "…" : v.name, pending: v.remaining, type: "Vendor" }));
    }
    if (showContractors) {
      contractors
        .filter((c) => c.remaining > 0)
        .forEach((c) => items.push({ name: c.name.length > 18 ? c.name.slice(0, 16) + "…" : c.name, pending: c.remaining, type: "Contractor" }));
    }
    if (showEmployees) {
      employees
        .filter((e) => (e.totalDue ?? 0) > 0)
        .forEach((e) => items.push({ name: e.name.length > 18 ? e.name.slice(0, 16) + "…" : e.name, pending: e.totalDue ?? 0, type: "Employee" }));
    }
    if (showMachines) {
      machines
        .filter((m) => m.totalPending > 0)
        .forEach((m) => items.push({ name: m.name.length > 18 ? m.name.slice(0, 16) + "…" : m.name, pending: m.totalPending, type: "Machinery" }));
    }
    return items.sort((a, b) => b.pending - a.pending).slice(0, 10);
  }, [vendors, contractors, employees, machines, showVendors, showContractors, showEmployees, showMachines]);

  const filteredVendors = showVendors ? vendors.filter((v) => v.remaining > 0) : [];
  const filteredContractors = showContractors ? contractors.filter((c) => c.remaining > 0) : [];
  const filteredEmployees = showEmployees ? employees.filter((e) => (e.totalDue ?? 0) > 0) : [];
  const filteredMachines = showMachines ? machines.filter((m) => m.totalPending > 0) : [];

  // Column totals for the footer of each table — summed from the same filtered rows the
  // table renders, so they always agree with what is on the page (and on the printout).
  const sumBy = <T,>(rows: T[], pick: (row: T) => number) => rows.reduce((sum, row) => sum + pick(row), 0);
  const vendorTotals = {
    billed: sumBy(filteredVendors, (v) => v.totalBilled),
    paid: sumBy(filteredVendors, (v) => v.totalPaid),
    pending: sumBy(filteredVendors, (v) => v.remaining),
  };
  const contractorTotals = {
    total: sumBy(filteredContractors, (c) => c.totalAmount),
    paid: sumBy(filteredContractors, (c) => c.totalPaid),
    pending: sumBy(filteredContractors, (c) => c.remaining),
  };
  const employeeTotals = {
    paid: sumBy(filteredEmployees, (e) => e.totalPaid ?? 0),
    due: sumBy(filteredEmployees, (e) => e.totalDue ?? 0),
  };
  const machineTotals = {
    cost: sumBy(filteredMachines, (m) => m.totalCost),
    paid: sumBy(filteredMachines, (m) => m.totalPaid),
    pending: sumBy(filteredMachines, (m) => m.totalPending),
  };

  // Grand total across all four tables. Salary has no billed column of its own, so its
  // obligation is Paid + Due — the same identity the other three already satisfy
  // (billed = paid + pending). That keeps the grand row internally consistent:
  // billed === paid + pending.
  const grandTotals = {
    billed:
      vendorTotals.billed +
      contractorTotals.total +
      (employeeTotals.paid + employeeTotals.due) +
      machineTotals.cost,
    paid: vendorTotals.paid + contractorTotals.paid + employeeTotals.paid + machineTotals.paid,
    pending:
      vendorTotals.pending + contractorTotals.pending + employeeTotals.due + machineTotals.pending,
  };

  const selectedProjectName = projects.find((p) => p.id === effectiveProjectId)?.name ?? "Project";

  const refetchAll = () => {
    refetchVendors();
    refetchContractors();
    refetchMachines();
    refetchEmployees();
  };

  const refetchAllAfterEmployeePayment = () => {
    refetchVendors();
    refetchContractors();
    refetchMachines();
    refetchEmployees({ silent: true });
  };

  const showProjectSelector = projectsForSelector.length > 0;
  const hasProjectSelected = !!effectiveProjectId;
  const showNoProjectMessage = projectsForSelector.length > 0 && !effectiveProjectId;

  return (
    <Layout>
      <PageHeader
        title="Liabilities"
        subtitle={hasProjectSelected ? `Outstanding payments & dues — ${selectedProjectName}` : "Outstanding payments & dues across entities"}
        printTargetId="liabilities-content"
      />

      <div className="flex flex-wrap items-end gap-4 mb-6 p-4 border-2 border-border">
        {showProjectSelector && (
          <div>
            <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Project</Label>
            <Select value={selectedProjectId || ""} onValueChange={setSelectedProjectId}>
              <SelectTrigger className="mt-1 w-[200px]">
                <SelectValue placeholder="Select project…" />
              </SelectTrigger>
              <SelectContent>
                {projectsForSelector.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div>
          <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Entity</Label>
          <Select value={entityFilter} onValueChange={setEntityFilter}>
            <SelectTrigger className="mt-1 w-[180px]">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All entities</SelectItem>
              <SelectItem value="vendor">Vendors only</SelectItem>
              <SelectItem value="contractor">Contractors only</SelectItem>
              <SelectItem value="employee">Employees only</SelectItem>
              <SelectItem value="machinery">Machinery only</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Date from</Label>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="mt-1 w-[140px]" />
        </div>
        <div>
          <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Date to</Label>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="mt-1 w-[140px]" />
        </div>
      </div>

      <div id="liabilities-content" className="space-y-6">
        {showNoProjectMessage ? (
          <p className="text-sm text-muted-foreground bg-muted/50 border border-border rounded-lg px-4 py-3">
            Select a project above to view liabilities.
          </p>
        ) : (
        <>
        <div className="print-hidden grid grid-cols-2 gap-4 sm:grid-cols-5">
          <StatCard label="Total Liabilities" value={formatCurrency(totalLiabilities)} variant="destructive" />
          <StatCard label="Vendor Dues" value={formatCurrency(vendorDues)} variant="warning" />
          <StatCard label="Contractor Dues" value={formatCurrency(contractorDues)} variant="warning" />
          <StatCard label="Salary Dues" value={formatCurrency(salaryDues)} variant="warning" />
          <StatCard label="Machinery Dues" value={formatCurrency(machineryDues)} variant="warning" />
        </div>

        {/* Charts — no inner padding, auto-scale to avoid overflow */}
        <div className="print-hidden grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartCard title="Liability Breakdown" subtitle="Share of total outstanding by category" noContentPadding>
            {liabilityBreakdownData.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8">No outstanding liabilities</p>
            ) : (
              <div className="w-full h-full min-h-[260px] aspect-[4/3] max-h-[380px] overflow-visible">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart margin={{ top: 8, right: 8, left: 8, bottom: 36 }}>
                    <Pie
                      data={liabilityBreakdownData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="45%"
                      innerRadius="40%"
                      outerRadius="70%"
                      paddingAngle={3}
                    >
                      {liabilityBreakdownData.map((_, i) => (
                        <Cell key={i} fill={LIABILITY_PIE_COLORS[i % LIABILITY_PIE_COLORS.length]} stroke="hsl(var(--border))" strokeWidth={1} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={{ fontSize: 12 }} />
                    <Legend
                      layout="horizontal"
                      align="center"
                      verticalAlign="bottom"
                      wrapperStyle={{ paddingTop: 8 }}
                      formatter={(value, entry: { payload?: { value?: number } }) => {
                        const val = entry?.payload?.value ?? 0;
                        const pct = totalLiabilities > 0 ? (100 * val / totalLiabilities).toFixed(0) : "0";
                        return <span className="text-xs">{value} ({pct}%)</span>;
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </ChartCard>
          <ChartCard title="Top 10 by Pending Amount" subtitle="Entities with highest dues" noContentPadding>
            {topEntitiesData.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8">No pending dues</p>
            ) : (
              <div className="w-full h-full min-h-[260px] aspect-[4/3] max-h-[380px] overflow-visible">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topEntitiesData} margin={{ top: 4, right: 4, left: 0, bottom: 48 }} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis type="number" tickFormatter={(v) => (v >= 1e7 ? `${(v / 1e7).toFixed(1)}Cr` : v >= 1e5 ? `${(v / 1e5).toFixed(1)}L` : `${(v / 1e3).toFixed(0)}K`)} className="text-xs" />
                    <YAxis type="category" dataKey="name" width={88} tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(v: number) => formatCurrency(v)} />
                    <Bar dataKey="pending" name="Pending" radius={[0, 2, 2, 0]} fill="hsl(var(--destructive) / 0.85)" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </ChartCard>
        </div>

        {/* Vendor Dues */}
        <div className="border-2 border-border">
          <div className="border-b-2 border-border bg-secondary px-4 py-3">
            <h2 className="text-sm font-bold uppercase tracking-wider">Vendor Pending Payments</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-base">
              <thead>
                <tr className="border-b-2 border-border bg-primary text-primary-foreground">
                  <th className="px-4 py-2.5 text-left text-sm font-bold uppercase tracking-wider">Vendor</th>
                  <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Billed</th>
                  <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Paid</th>
                  <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Pending</th>
                  <th className="print-hidden px-4 py-2.5 text-center text-sm font-bold uppercase tracking-wider">Action</th>
                </tr>
              </thead>
              <tbody>
                {vendorsLoading ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading vendors…
                      </span>
                    </td>
                  </tr>
                ) : (
                filteredVendors.map((v) => (
                  <tr key={v.id} className="border-b border-border hover:bg-accent/50">
                    <td className="px-4 py-3">
                      <Link to={`/vendors/${v.id}?returnTo=liabilities`} className="font-bold hover:underline">{v.name}</Link>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm">{formatCurrency(v.totalBilled)}</td>
                    <td className="px-4 py-3 text-right font-mono text-sm text-success">{formatCurrency(v.totalPaid)}</td>
                    <td className="px-4 py-3 text-right font-mono text-sm text-destructive font-bold">{formatCurrency(v.remaining)}</td>
                    <td className="print-hidden px-4 py-3 text-center">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        disabled={v.remaining <= 0}
                        onClick={() => setVendorPaymentVendor(v)}
                      >
                        <Banknote className="h-3.5 w-3.5" />
                        Pay
                      </Button>
                    </td>
                  </tr>
                )))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/30 font-bold">
                  <td className="px-4 py-3 text-right text-sm">Total</td>
                  <td className="px-4 py-3 text-right font-mono text-sm">{formatCurrency(vendorTotals.billed)}</td>
                  <td className="px-4 py-3 text-right font-mono text-sm text-success">{formatCurrency(vendorTotals.paid)}</td>
                  <td className="px-4 py-3 text-right font-mono text-sm text-destructive">{formatCurrency(vendorTotals.pending)}</td>
                  <td className="print-hidden" />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Contractor Dues */}
        <div className="border-2 border-border">
          <div className="border-b-2 border-border bg-secondary px-4 py-3">
            <h2 className="text-sm font-bold uppercase tracking-wider">Contractor Pending Payments</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-base">
              <thead>
                <tr className="border-b-2 border-border bg-primary text-primary-foreground">
                  <th className="px-4 py-2.5 text-left text-sm font-bold uppercase tracking-wider">Contractor</th>
                  <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Total</th>
                  <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Paid</th>
                  <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Pending</th>
                  <th className="print-hidden px-4 py-2.5 text-center text-sm font-bold uppercase tracking-wider">Action</th>
                </tr>
              </thead>
              <tbody>
                {contractorsLoading ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading contractors…
                      </span>
                    </td>
                  </tr>
                ) : (
                filteredContractors.map((c) => (
                  <tr key={c.id} className="border-b border-border hover:bg-accent/50">
                    <td className="px-4 py-3">
                      <Link to={`/contractors?contractorId=${c.id}&returnTo=liabilities`} className="font-bold hover:underline">{c.name}</Link>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm">{formatCurrency(c.totalAmount)}</td>
                    <td className="px-4 py-3 text-right font-mono text-sm text-success">{formatCurrency(c.totalPaid)}</td>
                    <td className="px-4 py-3 text-right font-mono text-sm text-destructive font-bold">{formatCurrency(c.remaining)}</td>
                    <td className="print-hidden px-4 py-3 text-center">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        disabled={c.remaining <= 0}
                        onClick={() => setContractorPaymentContractor(c)}
                      >
                        <Banknote className="h-3.5 w-3.5" />
                        Pay
                      </Button>
                    </td>
                  </tr>
                )))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/30 font-bold">
                  <td className="px-4 py-3 text-right text-sm">Total</td>
                  <td className="px-4 py-3 text-right font-mono text-sm">{formatCurrency(contractorTotals.total)}</td>
                  <td className="px-4 py-3 text-right font-mono text-sm text-success">{formatCurrency(contractorTotals.paid)}</td>
                  <td className="px-4 py-3 text-right font-mono text-sm text-destructive">{formatCurrency(contractorTotals.pending)}</td>
                  <td className="print-hidden" />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Salary Dues — Fixed and Daily in one table */}
        <div className="border-2 border-border">
          <div className="border-b-2 border-border bg-secondary px-4 py-3">
            <h2 className="text-sm font-bold uppercase tracking-wider">Salary Dues</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-base">
              <thead>
                <tr className="border-b-2 border-border bg-primary text-primary-foreground">
                  <th className="px-4 py-2.5 text-left text-sm font-bold uppercase tracking-wider">Employee</th>
                  <th className="px-4 py-2.5 text-left text-sm font-bold uppercase tracking-wider">Type</th>
                  <th className="px-4 py-2.5 text-left text-sm font-bold uppercase tracking-wider">Project</th>
                  <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Total Paid (All Months)</th>
                  <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Due (All Months)</th>
                  <th className="print-hidden px-4 py-2.5 text-center text-sm font-bold uppercase tracking-wider">Action</th>
                </tr>
              </thead>
              <tbody>
                {employeesLoading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading employees…
                      </span>
                    </td>
                  </tr>
                ) : filteredEmployees.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                      No outstanding salary dues.
                    </td>
                  </tr>
                ) : (
                filteredEmployees.map((e) => (
                  <tr key={e.id} className="border-b border-border hover:bg-accent/50">
                    <td className="px-4 py-3">
                      <Link to={`/employees/${e.id}?returnTo=liabilities`} className="font-bold hover:underline">{e.name}</Link>
                    </td>
                    <td className="px-4 py-3 text-sm">{e.type}</td>
                    <td className="px-4 py-3 text-sm">{e.project}</td>
                    <td className="px-4 py-3 text-right font-mono text-sm">{formatCurrency(e.totalPaid ?? 0)}</td>
                    <td className="px-4 py-3 text-right font-mono text-sm text-destructive font-bold">{formatCurrency(e.totalDue ?? 0)}</td>
                    <td className="print-hidden px-4 py-3 text-center">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        disabled={(e.totalDue ?? 0) <= 0}
                        onClick={() => setEmployeePaymentEmployee(e)}
                      >
                        <Banknote className="h-3.5 w-3.5" />
                        Pay
                      </Button>
                    </td>
                  </tr>
                )))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/30 font-bold">
                  <td colSpan={3} className="px-4 py-3 text-right text-sm">Total</td>
                  <td className="px-4 py-3 text-right font-mono text-sm">{formatCurrency(employeeTotals.paid)}</td>
                  <td className="px-4 py-3 text-right font-mono text-sm text-destructive">{formatCurrency(employeeTotals.due)}</td>
                  <td className="print-hidden" />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Machinery Dues */}
        <div className="border-2 border-border">
          <div className="border-b-2 border-border bg-secondary px-4 py-3">
            <h2 className="text-sm font-bold uppercase tracking-wider">Machinery Pending Payments</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-base">
              <thead>
                <tr className="border-b-2 border-border bg-primary text-primary-foreground">
                  <th className="px-4 py-2.5 text-left text-sm font-bold uppercase tracking-wider">Machine</th>
                  <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Total Cost</th>
                  <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Paid</th>
                  <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Pending</th>
                  <th className="print-hidden px-4 py-2.5 text-center text-sm font-bold uppercase tracking-wider">Action</th>
                </tr>
              </thead>
              <tbody>
                {machinesLoading ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading machinery…
                      </span>
                    </td>
                  </tr>
                ) : (
                filteredMachines.map((m) => (
                  <tr key={m.id} className="border-b border-border hover:bg-accent/50">
                    <td className="px-4 py-3">
                      <Link to={`/machinery/${m.id}?returnTo=liabilities`} className="font-bold hover:underline">{m.name}</Link>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm">{formatCurrency(m.totalCost)}</td>
                    <td className="px-4 py-3 text-right font-mono text-sm text-success">{formatCurrency(m.totalPaid)}</td>
                    <td className="px-4 py-3 text-right font-mono text-sm text-destructive font-bold">{formatCurrency(m.totalPending)}</td>
                    <td className="print-hidden px-4 py-3 text-center">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        disabled={m.totalPending <= 0}
                        onClick={() => setMachinePaymentMachine(m)}
                      >
                        <Banknote className="h-3.5 w-3.5" />
                        Pay
                      </Button>
                    </td>
                  </tr>
                )))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/30 font-bold">
                  <td className="px-4 py-3 text-right text-sm">Total</td>
                  <td className="px-4 py-3 text-right font-mono text-sm">{formatCurrency(machineTotals.cost)}</td>
                  <td className="px-4 py-3 text-right font-mono text-sm text-success">{formatCurrency(machineTotals.paid)}</td>
                  <td className="px-4 py-3 text-right font-mono text-sm text-destructive">{formatCurrency(machineTotals.pending)}</td>
                  <td className="print-hidden" />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Grand total — the four tables' column totals combined */}
        <div className="border-2 border-border">
          <div className="border-b-2 border-border bg-secondary px-4 py-3">
            <h2 className="text-sm font-bold uppercase tracking-wider">Grand Total — All Liabilities</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-base">
              <thead>
                <tr className="border-b-2 border-border bg-primary text-primary-foreground">
                  <th className="px-4 py-2.5 text-left text-sm font-bold uppercase tracking-wider">Grand Total</th>
                  <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Billed / Total</th>
                  <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Paid</th>
                  <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Pending / Due</th>
                </tr>
              </thead>
              <tbody>
                <tr className="bg-muted/30 font-bold">
                  <td className="px-4 py-3 text-sm">Vendors + Contractors + Salaries + Machinery</td>
                  <td className="px-4 py-3 text-right font-mono text-sm">{formatCurrency(grandTotals.billed)}</td>
                  <td className="px-4 py-3 text-right font-mono text-sm text-success">{formatCurrency(grandTotals.paid)}</td>
                  <td className="px-4 py-3 text-right font-mono text-sm text-destructive">{formatCurrency(grandTotals.pending)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Payment dialogs — reuse existing dialogs */}
      {vendorPaymentVendor && (
        <VendorPaymentDialog
          open
          onOpenChange={(open) => !open && setVendorPaymentVendor(null)}
          vendor={vendorPaymentVendor}
          onSuccess={refetchAll}
        />
      )}
      <ContractorPaymentDialog
        open={!!contractorPaymentContractor}
        onOpenChange={(open) => !open && setContractorPaymentContractor(null)}
        contractor={contractorPaymentContractor}
        remainingBalance={contractorPaymentContractor?.remaining ?? 0}
        onSuccess={refetchAll}
      />
      <MachinePaymentDialog
        open={!!machinePaymentMachine}
        onOpenChange={(open) => !open && setMachinePaymentMachine(null)}
        machine={machinePaymentMachine}
        remainingBalance={machinePaymentMachine?.totalPending ?? 0}
        onSuccess={refetchAll}
      />
      <EmployeeLiabilityPaymentDialog
        open={!!employeePaymentEmployee}
        onOpenChange={(open) => !open && setEmployeePaymentEmployee(null)}
        employee={employeePaymentEmployee}
        onSuccess={refetchAllAfterEmployeePayment}
      />
        </>
        )}
      </div>
    </Layout>
  );
}
