import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Printer, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { COMPANY_LOGO_URL } from "@/lib/company";
import { formatDisplayDate, todayPKT } from "@/lib/pktDate";

/** Fixed line-item labels — order and wording match the company's paper salary slip exactly. */
const EARNINGS_ITEMS = [
  "Basic Salary",
  "House Rent",
  "Utilities",
  "Traveling",
  "Arears",
  "Bonus",
  "Hospitalization",
  "Medical Allowance",
  "Ex-Gratia",
  "Incentive KPI",
  "Incentive",
  "Other Allowance",
] as const;

const DEDUCTION_ITEMS = [
  "Provident Fund",
  "EOBI",
  "Fine Violations",
  "Advance vs Salary",
  "Advance vs Travelling",
  "Other",
  "FRF",
  "PF Loan Instalment",
  "Provident Fund Areas",
  "Other BN",
] as const;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const EMP_ID_SEQ_KEY = "pcf-salary-slip-employee-id-seq";
const EMP_ID_SEQ_START = 2340;

function nextEmployeeId(): string {
  const stored = Number(localStorage.getItem(EMP_ID_SEQ_KEY));
  const base = Number.isFinite(stored) && stored > 0 ? stored : EMP_ID_SEQ_START;
  const next = base + 1;
  localStorage.setItem(EMP_ID_SEQ_KEY, String(next));
  return `PCF${next}`;
}

function daysInMonth(month: number, year: number): number {
  return new Date(year, month, 0).getDate();
}

type LineMap = Record<string, string>;

function emptyLineMap(items: readonly string[]): LineMap {
  return Object.fromEntries(items.map((item) => [item, ""]));
}

function parseAmount(value: string): number {
  const n = Number(value.replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

function formatAmount(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** Value shown on the printed slip for one line item: "-" when left empty. */
function printValue(amount: string | undefined): string {
  const trimmed = (amount ?? "").trim();
  if (trimmed === "") return "-";
  return formatAmount(parseAmount(trimmed));
}

function lineTotal(map: LineMap, items: readonly string[]): number {
  return items.reduce((sum, item) => {
    const trimmed = (map[item] ?? "").trim();
    if (trimmed === "") return sum;
    return sum + parseAmount(trimmed);
  }, 0);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface GenerateSalarySlipDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function GenerateSalarySlipDialog({ open, onOpenChange }: GenerateSalarySlipDialogProps) {
  const now = new Date();

  const [employeeId, setEmployeeId] = useState("");
  const [name, setName] = useState("");
  const [designation, setDesignation] = useState("");
  const [dateOfIssue, setDateOfIssue] = useState(todayPKT());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [days, setDays] = useState(String(daysInMonth(now.getMonth() + 1, now.getFullYear())));

  const [status, setStatus] = useState("Permanent");
  const [dateOfJoining, setDateOfJoining] = useState("");
  const [chequeNo, setChequeNo] = useState("");

  const [signName, setSignName] = useState("Zubair Malik");
  const [signDesignation, setSignDesignation] = useState("Managing Director");
  const [signEmail, setSignEmail] = useState("poineerpcf3@gmail.com");
  const [signContact, setSignContact] = useState("+92 321 888 8177");

  const [earnings, setEarnings] = useState<LineMap>(() => emptyLineMap(EARNINGS_ITEMS));
  const [deductions, setDeductions] = useState<LineMap>(() => emptyLineMap(DEDUCTION_ITEMS));

  // Fresh slip each time the dialog opens: new ID, blank form.
  useEffect(() => {
    if (!open) return;
    setEmployeeId(nextEmployeeId());
    setName("");
    setDesignation("");
    setDateOfIssue(todayPKT());
    const n = new Date();
    setMonth(n.getMonth() + 1);
    setYear(n.getFullYear());
    setDays(String(daysInMonth(n.getMonth() + 1, n.getFullYear())));
    setStatus("Permanent");
    setDateOfJoining("");
    setChequeNo("");
    setSignName("Zubair Malik");
    setSignDesignation("Managing Director");
    setSignEmail("poineerpcf3@gmail.com");
    setSignContact("+92 321 888 8177");
    setEarnings(emptyLineMap(EARNINGS_ITEMS));
    setDeductions(emptyLineMap(DEDUCTION_ITEMS));
  }, [open]);

  const setAmount = (
    map: LineMap,
    setMap: (m: LineMap) => void,
    item: string,
    amount: string
  ) => {
    setMap({ ...map, [item]: amount });
  };

  const totalEarnings = useMemo(() => lineTotal(earnings, EARNINGS_ITEMS), [earnings]);
  const totalDeductions = useMemo(() => lineTotal(deductions, DEDUCTION_ITEMS), [deductions]);
  const netPayable = totalEarnings - totalDeductions;

  const handlePrint = () => {
    if (!name.trim()) {
      toast.error("Employee name is required");
      return;
    }

    const rowCount = Math.max(EARNINGS_ITEMS.length, DEDUCTION_ITEMS.length);
    const bodyRows = Array.from({ length: rowCount }, (_, i) => {
      const earnLabel = EARNINGS_ITEMS[i];
      const dedLabel = DEDUCTION_ITEMS[i];
      const earnCell = earnLabel
        ? `<td class="lbl">${escapeHtml(earnLabel)}</td><td class="val">${escapeHtml(printValue(earnings[earnLabel]))}</td>`
        : `<td class="lbl"></td><td class="val"></td>`;
      const dedCell = dedLabel
        ? `<td class="lbl">${escapeHtml(dedLabel)}</td><td class="val">${escapeHtml(printValue(deductions[dedLabel]))}</td>`
        : `<td class="lbl"></td><td class="val"></td>`;
      return `<tr>${earnCell}${dedCell}</tr>`;
    }).join("");

    const monthYearLabel = `${MONTH_NAMES[month - 1].slice(0, 3)} ${year}`;

    const html = `<!DOCTYPE html>
<html>
<head>
<title>Salary Slip - ${escapeHtml(name)} - ${escapeHtml(monthYearLabel)}</title>
<style>
  @page { size: A4 portrait; margin: 10mm 12mm; }
  * { box-sizing: border-box; }
  html, body { width: 100%; }
  body { font-family: Arial, Helvetica, sans-serif; color: #000; padding: 0; margin: 0; }
  .slip { border: 2.5px solid #000; border-radius: 16px; padding: 16px 22px 12px; width: 100%; margin: 0; page-break-inside: avoid; }
  .logo-row { margin-bottom: 4px; }
  .logo-row img { height: 62px; width: auto; object-fit: contain; }
  h1.title { text-align: center; font-size: 20px; font-weight: 700; margin: 2px 0 0; }
  .subtitle { text-align: center; font-size: 11.5px; font-weight: 700; margin: 0 0 10px; }
  table.info { width: 100%; border-collapse: collapse; margin-bottom: 0; border: 1.5px solid #000; }
  table.info td { border: none; padding: 3px 10px; font-size: 12.5px; vertical-align: top; }
  table.info td.right { text-align: right; }
  table.info .info-left { width: 55%; }
  table.info .info-right { width: 45%; }
  .kv { display: flex; }
  .kv .k { width: 100px; }
  table.lines { width: 100%; border-collapse: collapse; border: 1.5px solid #000; border-top: none; }
  table.lines th { background: #d9cfa8; color: #000; font-weight: 700; text-align: center; font-size: 12px; padding: 4px 10px; border: 1px solid #000; }
  table.lines th.deductions-h { text-align: left; padding-left: 10px; }
  table.lines th.earnings-h { text-align: left; padding-left: 10px; }
  table.lines td { border: 1px solid #000; padding: 3px 10px; font-size: 12px; }
  table.lines td.lbl { text-align: left; }
  table.lines td.val { text-align: right; width: 90px; }
  .note { font-size: 11px; margin: 8px 0 5px; }
  .note b { text-decoration: underline; }
  .totals-row { display: flex; justify-content: space-between; font-size: 12.5px; font-weight: 700; margin-top: 4px; }
  .net-row { text-align: right; font-size: 14px; font-weight: 700; margin-top: 5px; }
  .meta { margin-top: 12px; font-size: 12px; }
  .meta-row { display: flex; margin-bottom: 3px; }
  .meta-row .k { width: 150px; font-weight: 700; }
  .sign-area { margin-top: 24px; }
  .sign-space { height: 28px; }
  .sign-name { font-size: 16px; font-weight: 700; font-family: Georgia, 'Times New Roman', serif; margin-bottom: 3px; }
  .sign-designation { font-size: 12.5px; margin-bottom: 8px; }
  .sign-contact { font-size: 11.5px; margin: 2px 0; }
  .sign-contact a { color: inherit; text-decoration: underline; }
  .footer { margin-top: 14px; padding-top: 6px; border-top: 1px solid #000; text-align: center; font-size: 10px; color: #333; }
  @media print { body { padding: 0; margin: 0; } }
</style>
</head>
<body>
  <div class="slip">
    <div class="logo-row"><img src="${escapeHtml(COMPANY_LOGO_URL)}" alt="Pioneer Construction & Fabrication Co. logo" /></div>
    <h1 class="title">Salary Slip</h1>
    <div class="subtitle">Month of ${escapeHtml(monthYearLabel)}</div>

    <table class="info">
      <tr>
        <td class="info-left">
          <div class="kv"><span class="k">Employee ID:</span><span>${escapeHtml(employeeId)}</span></div>
          <div class="kv"><span class="k">Name:</span><span><b>${escapeHtml(name)}</b></span></div>
          <div class="kv"><span class="k">Days:</span><span><b>${escapeHtml(days || "-")}</b></span></div>
        </td>
        <td class="info-right">
          <div class="kv"><span class="k">Date of Issue</span><span>${escapeHtml(formatDisplayDate(dateOfIssue))}</span></div>
          <div class="kv"><span class="k">Designation:</span><span><b>${escapeHtml(designation || "-")}</b></span></div>
        </td>
      </tr>
    </table>

    <table class="lines">
      <thead>
        <tr>
          <th class="earnings-h" colspan="2">Earnings</th>
          <th class="deductions-h" colspan="2">Deductions</th>
        </tr>
      </thead>
      <tbody>
        ${bodyRows}
      </tbody>
    </table>

    <div class="note"><b>Note:</b> The Company is Responsible for Paying all Types of government taxes imposed on the Employee&rsquo;s Salary</div>

    <div class="totals-row">
      <span>Total Earnings&nbsp;&nbsp;&nbsp;${escapeHtml(formatAmount(totalEarnings))}/-</span>
      <span>Total Deductions&nbsp;&nbsp;&nbsp;${totalDeductions > 0 ? escapeHtml(formatAmount(totalDeductions)) : "-"}</span>
    </div>
    <div class="net-row">Net Payable&nbsp;&nbsp;&nbsp;${escapeHtml(formatAmount(netPayable))}/-</div>

    <div class="meta">
      <div class="meta-row"><span class="k">Status:</span><span>${escapeHtml(status || "-")}</span></div>
      <div class="meta-row"><span class="k">Date of Joining:</span><span>${escapeHtml(formatDisplayDate(dateOfJoining, "-"))}</span></div>
      <div class="meta-row"><span class="k">Cheque No:</span><span>${escapeHtml(chequeNo || "-")}</span></div>
    </div>

    <div class="sign-area">
      <div class="sign-space"></div>
      <div class="sign-name">${escapeHtml(signName || "")}</div>
      <div class="sign-designation">${escapeHtml(signDesignation || "")}</div>
      ${signEmail.trim() ? `<div class="sign-contact">Email: ${escapeHtml(signEmail)}</div>` : ""}
      ${signContact.trim() ? `<div class="sign-contact">Contact # ${escapeHtml(signContact)}</div>` : ""}
    </div>

    <div class="footer">
      H#39, Saigol Estate, backside Doctor&rsquo;s Hospital, Lahore. Ph: 0321-8888177, 0321-5991402<br />
      Email: pioneer_pcf@hotmail.com
    </div>
  </div>
</body>
</html>`;

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      toast.error("Popup blocked. Please allow popups to print.");
      return;
    }
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.print();
  };

  const renderLineRows = (
    items: readonly string[],
    map: LineMap,
    setMap: (m: LineMap) => void
  ) => (
    <div className="space-y-1.5">
      {items.map((item) => (
        <div key={item} className="flex items-center gap-2">
          <span className="flex-1 text-sm">{item}</span>
          <Input
            value={map[item] ?? ""}
            onChange={(e) => setAmount(map, setMap, item, e.target.value)}
            placeholder="-"
            inputMode="decimal"
            className="w-28 h-8 text-right"
          />
        </div>
      ))}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Generate Salary Slip</DialogTitle>
          <DialogDescription>
            A standalone, printable salary slip — not linked to any existing employee record. Fill in
            the details below and print.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <Label>Employee ID</Label>
              <div className="mt-1 flex items-center gap-2">
                <Input value={employeeId} readOnly className="font-mono" />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setEmployeeId(nextEmployeeId())}
                  aria-label="Regenerate Employee ID"
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div>
              <Label>Name *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" placeholder="Employee name" />
            </div>
            <div>
              <Label>Designation</Label>
              <Input value={designation} onChange={(e) => setDesignation(e.target.value)} className="mt-1" placeholder="e.g. Manager Accounts" />
            </div>
            <div>
              <Label>Date of Issue</Label>
              <Input type="date" value={dateOfIssue} onChange={(e) => setDateOfIssue(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>Month</Label>
              <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTH_NAMES.map((m, idx) => (
                    <SelectItem key={m} value={String(idx + 1)}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Year</Label>
              <Input
                type="number"
                value={year}
                onChange={(e) => setYear(Number(e.target.value) || now.getFullYear())}
                className="mt-1"
              />
            </div>
            <div>
              <Label>Days</Label>
              <Input value={days} onChange={(e) => setDays(e.target.value)} className="mt-1" placeholder={String(daysInMonth(month, year))} />
            </div>
          </div>

          <Separator />

          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Earnings</Label>
              <p className="text-xs text-muted-foreground mb-2">Enter an amount to include a line. Left blank it prints as &quot;-&quot;.</p>
              {renderLineRows(EARNINGS_ITEMS, earnings, setEarnings)}
            </div>
            <div>
              <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Deductions</Label>
              <p className="text-xs text-muted-foreground mb-2">Enter an amount to include a line. Left blank it prints as &quot;-&quot;.</p>
              {renderLineRows(DEDUCTION_ITEMS, deductions, setDeductions)}
            </div>
          </div>

          <div className="border-2 border-border p-3 grid gap-2 sm:grid-cols-3 text-sm">
            <div>Total Earnings: <span className="font-mono font-bold">{formatAmount(totalEarnings)}/-</span></div>
            <div>Total Deductions: <span className="font-mono font-bold">{totalDeductions > 0 ? formatAmount(totalDeductions) : "-"}</span></div>
            <div>Net Payable: <span className="font-mono font-bold">{formatAmount(netPayable)}/-</span></div>
          </div>

          <Separator />

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label>Status</Label>
              <Input value={status} onChange={(e) => setStatus(e.target.value)} className="mt-1" placeholder="Permanent" />
            </div>
            <div>
              <Label>Date of Joining</Label>
              <Input type="date" value={dateOfJoining} onChange={(e) => setDateOfJoining(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>Cheque No</Label>
              <Input value={chequeNo} onChange={(e) => setChequeNo(e.target.value)} className="mt-1" />
            </div>
          </div>

          <Separator />

          <div>
            <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Signatory</Label>
            <div className="grid gap-4 sm:grid-cols-2 mt-2">
              <div>
                <Label>Name</Label>
                <Input value={signName} onChange={(e) => setSignName(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label>Designation</Label>
                <Input value={signDesignation} onChange={(e) => setSignDesignation(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label>Email</Label>
                <Input value={signEmail} onChange={(e) => setSignEmail(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label>Contact #</Label>
                <Input value={signContact} onChange={(e) => setSignContact(e.target.value)} className="mt-1" />
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button type="button" variant="warning" onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-1" />
            Print Salary Slip
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
