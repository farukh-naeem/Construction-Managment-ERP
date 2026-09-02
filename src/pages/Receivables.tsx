import { useState, useMemo } from "react";
import Layout from "@/components/Layout";
import PageHeader from "@/components/PageHeader";
import StatCard from "@/components/StatCard";
import { ChartCard } from "@/components/charts/ChartCard";
import { formatCurrency } from "@/lib/mock-data";
import { useSelectedProject } from "@/context/SelectedProjectContext";
import { useProjects } from "@/hooks/useProjects";
import { useVendors } from "@/hooks/useVendors";
import { useEmployees } from "@/hooks/useEmployees";
import { useMachines } from "@/hooks/useMachines";
import { useContractors } from "@/hooks/useContractors";
import { useCustomers } from "@/hooks/useCustomers";
import { CustomerPaymentDialog } from "@/components/dialogs/CustomerPaymentDialog";
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
import type { ApiCustomer } from "@/services/customersService";
import type { ApiVendor } from "@/services/vendorsService";
import type { ApiContractorWithTotals } from "@/services/contractorsService";
import type { ApiMachineWithTotals } from "@/services/machinesService";
import type { ApiEmployee } from "@/services/employeesService";

const RECEIVABLE_PIE_COLORS = [
  "hsl(var(--success))",
  "hsl(var(--info))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

// Per-entity receivable amount. Vendors carry an explicit stored advanceBalance; contractors keep
// a signed remaining (negative = we are ahead); machines and employees expose a dedicated
// totalAdvance; customers keep a signed balance (negative = they owe us).
const vendorAdvance = (v: ApiVendor) => v.advanceBalance ?? 0;
const contractorAdvance = (c: ApiContractorWithTotals) => Math.max(0, -c.remaining);
const employeeAdvance = (e: ApiEmployee) => e.totalAdvance ?? 0;
const machineAdvance = (m: ApiMachineWithTotals) => m.totalAdvance ?? 0;
const customerOutstanding = (c: ApiCustomer) => Math.max(0, -c.balance);

const shortName = (name: string) => (name.length > 18 ? name.slice(0, 16) + "…" : name);

/** Mirror image of Liabilities: everything the project is owed rather than everything it owes.
 *  For vendors/contractors/machinery/employees that means unconsumed advances — money already
 *  handed over that no bill, entry or worked day has absorbed yet. For customers it means goods
 *  sold that have not been paid for. */
export default function Receivables() {
  const { projects } = useProjects();
  const { selectedProjectId, setSelectedProjectId } = useSelectedProject();

  const effectiveProjectId = selectedProjectId || null;
  const projectIdForApi = effectiveProjectId ?? undefined;

  const [entityFilter, setEntityFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const dateFromForApi = dateFrom || undefined;
  const dateToForApi = dateTo || undefined;

  const { vendors, loading: vendorsLoading, refetch: refetchVendors } = useVendors(projectIdForApi, dateFromForApi, dateToForApi);
  const { employees, loading: employeesLoading, refetch: refetchEmployees } = useEmployees(projectIdForApi, undefined, "Regular", dateFromForApi, dateToForApi);
  const { machines, loading: machinesLoading, refetch: refetchMachines } = useMachines(projectIdForApi, 1, 500, dateFromForApi, dateToForApi);
  const { contractors, loading: contractorsLoading, refetch: refetchContractors } = useContractors(projectIdForApi, dateFromForApi, dateToForApi);
  const { customers, loading: customersLoading, refetch: refetchCustomers } = useCustomers(projectIdForApi, dateFromForApi, dateToForApi);

  const projectsForSelector = useMemo(
    () => projects.filter((p) => p.status === "Active" || p.status === "On Hold" || p.status === "Completed"),
    [projects]
  );

  const [customerReceiptCustomer, setCustomerReceiptCustomer] = useState<ApiCustomer | null>(null);

  const showVendors = entityFilter === "all" || entityFilter === "vendor";
  const showContractors = entityFilter === "all" || entityFilter === "contractor";
  const showEmployees = entityFilter === "all" || entityFilter === "employee";
  const showMachines = entityFilter === "all" || entityFilter === "machinery";
  const showCustomers = entityFilter === "all" || entityFilter === "customer";

  const vendorReceivables = useMemo(() => (showVendors ? vendors.reduce((s, v) => s + vendorAdvance(v), 0) : 0), [vendors, showVendors]);
  const contractorReceivables = useMemo(() => (showContractors ? contractors.reduce((s, c) => s + contractorAdvance(c), 0) : 0), [contractors, showContractors]);
  const employeeReceivables = useMemo(() => (showEmployees ? employees.reduce((s, e) => s + employeeAdvance(e), 0) : 0), [employees, showEmployees]);
  const machineryReceivables = useMemo(() => (showMachines ? machines.reduce((s, m) => s + machineAdvance(m), 0) : 0), [machines, showMachines]);
  const customerReceivables = useMemo(() => (showCustomers ? customers.reduce((s, c) => s + customerOutstanding(c), 0) : 0), [customers, showCustomers]);
  const totalReceivables =
    vendorReceivables + contractorReceivables + employeeReceivables + machineryReceivables + customerReceivables;

  const receivableBreakdownData = useMemo(() => {
    if (totalReceivables === 0) return [];
    return [
      { name: "Vendor Advances", value: vendorReceivables },
      { name: "Contractor Advances", value: contractorReceivables },
      { name: "Employee Advances", value: employeeReceivables },
      { name: "Machinery Advances", value: machineryReceivables },
      { name: "Customer Dues", value: customerReceivables },
    ].filter((d) => d.value > 0);
  }, [totalReceivables, vendorReceivables, contractorReceivables, employeeReceivables, machineryReceivables, customerReceivables]);

  const topEntitiesData = useMemo(() => {
    const items: { name: string; receivable: number; type: string }[] = [];
    if (showVendors) {
      vendors.filter((v) => vendorAdvance(v) > 0).forEach((v) => items.push({ name: shortName(v.name), receivable: vendorAdvance(v), type: "Vendor" }));
    }
    if (showContractors) {
      contractors.filter((c) => contractorAdvance(c) > 0).forEach((c) => items.push({ name: shortName(c.name), receivable: contractorAdvance(c), type: "Contractor" }));
    }
    if (showEmployees) {
      employees.filter((e) => employeeAdvance(e) > 0).forEach((e) => items.push({ name: shortName(e.name), receivable: employeeAdvance(e), type: "Employee" }));
    }
    if (showMachines) {
      machines.filter((m) => machineAdvance(m) > 0).forEach((m) => items.push({ name: shortName(m.name), receivable: machineAdvance(m), type: "Machinery" }));
    }
    if (showCustomers) {
      customers.filter((c) => customerOutstanding(c) > 0).forEach((c) => items.push({ name: shortName(c.name), receivable: customerOutstanding(c), type: "Customer" }));
    }
    return items.sort((a, b) => b.receivable - a.receivable).slice(0, 10);
  }, [vendors, contractors, employees, machines, customers, showVendors, showContractors, showEmployees, showMachines, showCustomers]);

  const filteredVendors = showVendors ? vendors.filter((v) => vendorAdvance(v) > 0) : [];
  const filteredContractors = showContractors ? contractors.filter((c) => contractorAdvance(c) > 0) : [];
  const filteredEmployees = showEmployees ? employees.filter((e) => employeeAdvance(e) > 0) : [];
  const filteredMachines = showMachines ? machines.filter((m) => machineAdvance(m) > 0) : [];
  const filteredCustomers = showCustomers ? customers.filter((c) => customerOutstanding(c) > 0) : [];

  // Column totals for the footer of each table — summed from the same filtered rows the table
  // renders, so they always agree with what is on the page (and on the printout).
  const sumBy = <T,>(rows: T[], pick: (row: T) => number) => rows.reduce((sum, row) => sum + pick(row), 0);
  const vendorTotals = {
    billed: sumBy(filteredVendors, (v) => v.totalBilled),
    paid: sumBy(filteredVendors, (v) => v.totalPaid),
    advance: sumBy(filteredVendors, vendorAdvance),
  };
  const contractorTotals = {
    total: sumBy(filteredContractors, (c) => c.totalAmount),
    paid: sumBy(filteredContractors, (c) => c.totalPaid),
    advance: sumBy(filteredContractors, contractorAdvance),
  };
  const employeeTotals = {
    paid: sumBy(filteredEmployees, (e) => e.totalPaid ?? 0),
    advance: sumBy(filteredEmployees, employeeAdvance),
  };
  const machineTotals = {
    cost: sumBy(filteredMachines, (m) => m.totalCost),
    paid: sumBy(filteredMachines, (m) => m.totalPaid),
    advance: sumBy(filteredMachines, machineAdvance),
  };
  const customerTotals = {
    sold: sumBy(filteredCustomers, (c) => c.totalSold),
    received: sumBy(filteredCustomers, (c) => c.totalReceived),
    outstanding: sumBy(filteredCustomers, customerOutstanding),
  };

  // Grand total across all five tables. Employees have no billed column of their own, so what they
  // earned is Paid - Advance — the same identity the other three advance tables already satisfy
  // (paid = billed + advance). Customers are the one category where the money runs the other way:
  // "Sold"/"Received" are their billed/paid analogues, and their receivable is Sold - Received.
  const grandTotals = {
    billed:
      vendorTotals.billed +
      contractorTotals.total +
      (employeeTotals.paid - employeeTotals.advance) +
      machineTotals.cost +
      customerTotals.sold,
    paid:
      vendorTotals.paid +
      contractorTotals.paid +
      employeeTotals.paid +
      machineTotals.paid +
      customerTotals.received,
    receivable:
      vendorTotals.advance +
      contractorTotals.advance +
      employeeTotals.advance +
      machineTotals.advance +
      customerTotals.outstanding,
  };

  const selectedProjectName = projects.find((p) => p.id === effectiveProjectId)?.name ?? "Project";

  const refetchAll = () => {
    refetchVendors();
    refetchContractors();
    refetchMachines();
    refetchEmployees();
    refetchCustomers();
  };

  const showProjectSelector = projectsForSelector.length > 0;
  const hasProjectSelected = !!effectiveProjectId;
  const showNoProjectMessage = projectsForSelector.length > 0 && !effectiveProjectId;

  return (
    <Layout>
      <PageHeader
        title="Receivables"
        subtitle={hasProjectSelected ? `Advances & amounts owed to us — ${selectedProjectName}` : "Advances & amounts owed to us across entities"}
        printTargetId="receivables-content"
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
              <SelectItem value="customer">Customers only</SelectItem>
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

      <div id="receivables-content" className="space-y-6">
        {showNoProjectMessage ? (
          <p className="text-sm text-muted-foreground bg-muted/50 border border-border rounded-lg px-4 py-3">
            Select a project above to view receivables.
          </p>
        ) : (
        <>
        <div className="print-hidden grid grid-cols-2 gap-4 sm:grid-cols-6">
          <StatCard label="Total Receivables" value={formatCurrency(totalReceivables)} variant="success" />
          <StatCard label="Vendor Advances" value={formatCurrency(vendorReceivables)} variant="info" />
          <StatCard label="Contractor Advances" value={formatCurrency(contractorReceivables)} variant="info" />
          <StatCard label="Employee Advances" value={formatCurrency(employeeReceivables)} variant="info" />
          <StatCard label="Machinery Advances" value={formatCurrency(machineryReceivables)} variant="info" />
          <StatCard label="Customer Dues" value={formatCurrency(customerReceivables)} variant="info" />
        </div>

        {/* Charts — no inner padding, auto-scale to avoid overflow */}
        <div className="print-hidden grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartCard title="Receivable Breakdown" subtitle="Share of total owed to us by category" noContentPadding>
            {receivableBreakdownData.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8">No outstanding receivables</p>
            ) : (
              <div className="w-full h-full min-h-[260px] aspect-[4/3] max-h-[380px] overflow-visible">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart margin={{ top: 8, right: 8, left: 8, bottom: 36 }}>
                    <Pie
                      data={receivableBreakdownData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="45%"
                      innerRadius="40%"
                      outerRadius="70%"
                      paddingAngle={3}
                    >
                      {receivableBreakdownData.map((_, i) => (
                        <Cell key={i} fill={RECEIVABLE_PIE_COLORS[i % RECEIVABLE_PIE_COLORS.length]} stroke="hsl(var(--border))" strokeWidth={1} />
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
                        const pct = totalReceivables > 0 ? (100 * val / totalReceivables).toFixed(0) : "0";
                        return <span className="text-xs">{value} ({pct}%)</span>;
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </ChartCard>
          <ChartCard title="Top 10 by Receivable Amount" subtitle="Entities that owe us the most" noContentPadding>
            {topEntitiesData.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8">No outstanding receivables</p>
            ) : (
              <div className="w-full h-full min-h-[260px] aspect-[4/3] max-h-[380px] overflow-visible">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topEntitiesData} margin={{ top: 4, right: 4, left: 0, bottom: 48 }} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis type="number" tickFormatter={(v) => (v >= 1e7 ? `${(v / 1e7).toFixed(1)}Cr` : v >= 1e5 ? `${(v / 1e5).toFixed(1)}L` : `${(v / 1e3).toFixed(0)}K`)} className="text-xs" />
                    <YAxis type="category" dataKey="name" width={88} tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(v: number) => formatCurrency(v)} />
                    <Bar dataKey="receivable" name="Receivable" radius={[0, 2, 2, 0]} fill="hsl(var(--success) / 0.85)" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </ChartCard>
        </div>

        {/* Vendor Advances */}
        <div className="border-2 border-border">
          <div className="border-b-2 border-border bg-secondary px-4 py-3">
            <h2 className="text-sm font-bold uppercase tracking-wider">Vendor Advances (Recoverable)</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-base">
              <thead>
                <tr className="border-b-2 border-border bg-primary text-primary-foreground">
                  <th className="px-4 py-2.5 text-left text-sm font-bold uppercase tracking-wider">Vendor</th>
                  <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Billed</th>
                  <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Paid</th>
                  <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Advance With Vendor</th>
                </tr>
              </thead>
              <tbody>
                {vendorsLoading ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading vendors…
                      </span>
                    </td>
                  </tr>
                ) : filteredVendors.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No vendor advances outstanding.</td>
                  </tr>
                ) : (
                filteredVendors.map((v) => (
                  <tr key={v.id} className="border-b border-border hover:bg-accent/50">
                    <td className="px-4 py-3">
                      <Link to={`/vendors/${v.id}?returnTo=receivables`} className="font-bold hover:underline">{v.name}</Link>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm">{formatCurrency(v.totalBilled)}</td>
                    <td className="px-4 py-3 text-right font-mono text-sm">{formatCurrency(v.totalPaid)}</td>
                    <td className="px-4 py-3 text-right font-mono text-sm text-success font-bold">{formatCurrency(vendorAdvance(v))}</td>
                  </tr>
                )))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/30 font-bold">
                  <td className="px-4 py-3 text-right text-sm">Total</td>
                  <td className="px-4 py-3 text-right font-mono text-sm">{formatCurrency(vendorTotals.billed)}</td>
                  <td className="px-4 py-3 text-right font-mono text-sm">{formatCurrency(vendorTotals.paid)}</td>
                  <td className="px-4 py-3 text-right font-mono text-sm text-success">{formatCurrency(vendorTotals.advance)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Contractor Advances */}
        <div className="border-2 border-border">
          <div className="border-b-2 border-border bg-secondary px-4 py-3">
            <h2 className="text-sm font-bold uppercase tracking-wider">Contractor Advances (Recoverable)</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-base">
              <thead>
                <tr className="border-b-2 border-border bg-primary text-primary-foreground">
                  <th className="px-4 py-2.5 text-left text-sm font-bold uppercase tracking-wider">Contractor</th>
                  <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Total Billed</th>
                  <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Paid</th>
                  <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Advance With Contractor</th>
                </tr>
              </thead>
              <tbody>
                {contractorsLoading ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading contractors…
                      </span>
                    </td>
                  </tr>
                ) : filteredContractors.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No contractor advances outstanding.</td>
                  </tr>
                ) : (
                filteredContractors.map((c) => (
                  <tr key={c.id} className="border-b border-border hover:bg-accent/50">
                    <td className="px-4 py-3">
                      <Link to={`/contractors?contractorId=${c.id}&returnTo=receivables`} className="font-bold hover:underline">{c.name}</Link>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm">{formatCurrency(c.totalAmount)}</td>
                    <td className="px-4 py-3 text-right font-mono text-sm">{formatCurrency(c.totalPaid)}</td>
                    <td className="px-4 py-3 text-right font-mono text-sm text-success font-bold">{formatCurrency(contractorAdvance(c))}</td>
                  </tr>
                )))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/30 font-bold">
                  <td className="px-4 py-3 text-right text-sm">Total</td>
                  <td className="px-4 py-3 text-right font-mono text-sm">{formatCurrency(contractorTotals.total)}</td>
                  <td className="px-4 py-3 text-right font-mono text-sm">{formatCurrency(contractorTotals.paid)}</td>
                  <td className="px-4 py-3 text-right font-mono text-sm text-success">{formatCurrency(contractorTotals.advance)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Employee Advances */}
        <div className="border-2 border-border">
          <div className="border-b-2 border-border bg-secondary px-4 py-3">
            <h2 className="text-sm font-bold uppercase tracking-wider">Employee Advances (Recoverable)</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-base">
              <thead>
                <tr className="border-b-2 border-border bg-primary text-primary-foreground">
                  <th className="px-4 py-2.5 text-left text-sm font-bold uppercase tracking-wider">Employee</th>
                  <th className="px-4 py-2.5 text-left text-sm font-bold uppercase tracking-wider">Type</th>
                  <th className="px-4 py-2.5 text-left text-sm font-bold uppercase tracking-wider">Project</th>
                  <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Total Paid</th>
                  <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Unadjusted Advance</th>
                </tr>
              </thead>
              <tbody>
                {employeesLoading ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading employees…
                      </span>
                    </td>
                  </tr>
                ) : filteredEmployees.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No employee advances outstanding.</td>
                  </tr>
                ) : (
                filteredEmployees.map((e) => (
                  <tr key={e.id} className="border-b border-border hover:bg-accent/50">
                    <td className="px-4 py-3">
                      <Link to={`/employees/${e.id}?returnTo=receivables`} className="font-bold hover:underline">{e.name}</Link>
                    </td>
                    <td className="px-4 py-3 text-sm">{e.type}</td>
                    <td className="px-4 py-3 text-sm">{e.project}</td>
                    <td className="px-4 py-3 text-right font-mono text-sm">{formatCurrency(e.totalPaid ?? 0)}</td>
                    <td className="px-4 py-3 text-right font-mono text-sm text-success font-bold">{formatCurrency(employeeAdvance(e))}</td>
                  </tr>
                )))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/30 font-bold">
                  <td colSpan={3} className="px-4 py-3 text-right text-sm">Total</td>
                  <td className="px-4 py-3 text-right font-mono text-sm">{formatCurrency(employeeTotals.paid)}</td>
                  <td className="px-4 py-3 text-right font-mono text-sm text-success">{formatCurrency(employeeTotals.advance)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Machinery Advances */}
        <div className="border-2 border-border">
          <div className="border-b-2 border-border bg-secondary px-4 py-3">
            <h2 className="text-sm font-bold uppercase tracking-wider">Machinery Advances (Recoverable)</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-base">
              <thead>
                <tr className="border-b-2 border-border bg-primary text-primary-foreground">
                  <th className="px-4 py-2.5 text-left text-sm font-bold uppercase tracking-wider">Machine</th>
                  <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Total Cost</th>
                  <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Paid</th>
                  <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Advance With Owner</th>
                </tr>
              </thead>
              <tbody>
                {machinesLoading ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading machinery…
                      </span>
                    </td>
                  </tr>
                ) : filteredMachines.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No machinery advances outstanding.</td>
                  </tr>
                ) : (
                filteredMachines.map((m) => (
                  <tr key={m.id} className="border-b border-border hover:bg-accent/50">
                    <td className="px-4 py-3">
                      <Link to={`/machinery/${m.id}?returnTo=receivables`} className="font-bold hover:underline">{m.name}</Link>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm">{formatCurrency(m.totalCost)}</td>
                    <td className="px-4 py-3 text-right font-mono text-sm">{formatCurrency(m.totalPaid)}</td>
                    <td className="px-4 py-3 text-right font-mono text-sm text-success font-bold">{formatCurrency(machineAdvance(m))}</td>
                  </tr>
                )))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/30 font-bold">
                  <td className="px-4 py-3 text-right text-sm">Total</td>
                  <td className="px-4 py-3 text-right font-mono text-sm">{formatCurrency(machineTotals.cost)}</td>
                  <td className="px-4 py-3 text-right font-mono text-sm">{formatCurrency(machineTotals.paid)}</td>
                  <td className="px-4 py-3 text-right font-mono text-sm text-success">{formatCurrency(machineTotals.advance)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Customer Dues */}
        <div className="border-2 border-border">
          <div className="border-b-2 border-border bg-secondary px-4 py-3">
            <h2 className="text-sm font-bold uppercase tracking-wider">Customer Outstanding Dues</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-base">
              <thead>
                <tr className="border-b-2 border-border bg-primary text-primary-foreground">
                  <th className="px-4 py-2.5 text-left text-sm font-bold uppercase tracking-wider">Customer</th>
                  <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Sold</th>
                  <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Received</th>
                  <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Outstanding</th>
                  <th className="px-4 py-2.5 text-center text-sm font-bold uppercase tracking-wider">Action</th>
                </tr>
              </thead>
              <tbody>
                {customersLoading ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading customers…
                      </span>
                    </td>
                  </tr>
                ) : filteredCustomers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No customer dues outstanding.</td>
                  </tr>
                ) : (
                filteredCustomers.map((c) => (
                  <tr key={c.id} className="border-b border-border hover:bg-accent/50">
                    <td className="px-4 py-3">
                      <Link to={`/customers/${c.id}?returnTo=receivables`} className="font-bold hover:underline">{c.name}</Link>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm">{formatCurrency(c.totalSold)}</td>
                    <td className="px-4 py-3 text-right font-mono text-sm">{formatCurrency(c.totalReceived)}</td>
                    <td className="px-4 py-3 text-right font-mono text-sm text-success font-bold">{formatCurrency(customerOutstanding(c))}</td>
                    <td className="px-4 py-3 text-center">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        onClick={() => setCustomerReceiptCustomer(c)}
                      >
                        <Banknote className="h-3.5 w-3.5" />
                        Receive
                      </Button>
                    </td>
                  </tr>
                )))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/30 font-bold">
                  <td className="px-4 py-3 text-right text-sm">Total</td>
                  <td className="px-4 py-3 text-right font-mono text-sm">{formatCurrency(customerTotals.sold)}</td>
                  <td className="px-4 py-3 text-right font-mono text-sm">{formatCurrency(customerTotals.received)}</td>
                  <td className="px-4 py-3 text-right font-mono text-sm text-success">{formatCurrency(customerTotals.outstanding)}</td>
                  <td className="print-hidden" />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Grand total — the five tables' column totals combined */}
        <div className="border-2 border-border">
          <div className="border-b-2 border-border bg-secondary px-4 py-3">
            <h2 className="text-sm font-bold uppercase tracking-wider">Grand Total — All Receivables</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-base">
              <thead>
                <tr className="border-b-2 border-border bg-primary text-primary-foreground">
                  <th className="px-4 py-2.5 text-left text-sm font-bold uppercase tracking-wider">Grand Total</th>
                  <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Billed / Sold</th>
                  <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Paid / Received</th>
                  <th className="px-4 py-2.5 text-right text-sm font-bold uppercase tracking-wider">Receivable</th>
                </tr>
              </thead>
              <tbody>
                <tr className="bg-muted/30 font-bold">
                  <td className="px-4 py-3 text-sm">Vendors + Contractors + Employees + Machinery + Customers</td>
                  <td className="px-4 py-3 text-right font-mono text-sm">{formatCurrency(grandTotals.billed)}</td>
                  <td className="px-4 py-3 text-right font-mono text-sm">{formatCurrency(grandTotals.paid)}</td>
                  <td className="px-4 py-3 text-right font-mono text-sm text-success">{formatCurrency(grandTotals.receivable)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {customerReceiptCustomer && (
          <CustomerPaymentDialog
            open
            onOpenChange={(open) => !open && setCustomerReceiptCustomer(null)}
            customer={customerReceiptCustomer}
            onSuccess={() => {
              setCustomerReceiptCustomer(null);
              refetchAll();
            }}
          />
        )}
        </>
        )}
      </div>
    </Layout>
  );
}
