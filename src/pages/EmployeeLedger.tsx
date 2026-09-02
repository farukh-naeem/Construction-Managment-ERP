import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import Layout from "@/components/Layout";
import PageHeader from "@/components/PageHeader";
import StatusBadge from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useAuth } from "@/context/AuthContext";
import { formatCurrency } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import {
  buildAdvanceMonthOptions,
  buildMonthOptionsUpToCurrent,
  getDaysInMonth,
  getFirstMonth,
  getLastMonth,
  getLocalMonthKey,
  getMonthKey,
  monthLabel,
  type DailyAttendanceDay,
  type DailyDayStatus,
  type FixedDayStatus,
  type PaymentMethod,
  type PaymentType,
  shiftMonth,
} from "@/lib/employee-ledger";
import { ArrowLeft, ChevronLeft, ChevronRight, Loader2, Pencil, Trash2 } from "lucide-react";
import PrintExportButton from "@/components/PrintExportButton";
import { toast } from "sonner";
import { useEmployeeLedger } from "@/hooks/useEmployeeLedger";
import {
  createEmployeePayment,
  deleteEmployeePayment,
  putAttendance,
  type ApiAttendance,
  type ApiEmployeePayment,
} from "@/services/employeeLedgerService";
import { deleteEmployee, type ApiEmployee } from "@/services/employeesService";
import { EditEmployeeDialog } from "@/components/dialogs/EditEmployeeDialog";
import { TablePagination } from "@/components/TablePagination";
import { formatDisplayDate, todayPKT } from "@/lib/pktDate";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const PAYMENT_PAGE_SIZE_OPTIONS = [12, 24, 50, 100];
type PaymentQuickMode = "advance" | "partial" | "full";

function formatDayUnits(value: number) {
  return Number.isInteger(value) ? value.toString() : value.toFixed(1);
}

function getPaymentType(employee: ApiEmployee, mode: PaymentQuickMode): PaymentType {
  if (mode === "advance") return "Advance";
  return employee.type === "Fixed" ? "Salary" : "Wage";
}

function toDateValue(date: string) {
  return new Date(`${date}T00:00:00`).getTime();
}

function fixedStatusLabel(status: FixedDayStatus, unpaidLeave: boolean) {
  if (status === "present") return "Present";
  if (status === "absent") return "Absent";
  if (status === "paid_leave") return "Paid Leave";
  if (status === "unpaid_leave") return "Unpaid Leave";
  return unpaidLeave ? "Unpaid Leave" : "Leave";
}

function dailyStatusLabel(entry?: DailyAttendanceDay) {
  if (!entry) return "Not Marked";
  if (entry.status === "present") return "Present";
  if (entry.status === "absent") return "Absent";
  return "Leave";
}

function fixedStatusClass(status: FixedDayStatus, unpaidLeave: boolean) {
  if (status === "present") return "bg-success/10 border-success/30 text-success";
  if (status === "absent") return "bg-destructive/10 border-destructive/30 text-destructive";
  if (status === "paid_leave") return "bg-amber-400/20 border-amber-500/40 text-amber-900";
  if (status === "unpaid_leave") return "bg-amber-600/20 border-amber-600/40 text-amber-900";
  if (unpaidLeave) return "bg-amber-600/20 border-amber-600/40 text-amber-900";
  return "bg-amber-400/20 border-amber-500/40 text-amber-900";
}

function dailyStatusClass(entry?: DailyAttendanceDay) {
  if (!entry) return "bg-background border-border text-muted-foreground";
  if (entry.status === "present") return "bg-success/10 border-success/30 text-success";
  if (entry.status === "absent") return "bg-destructive/10 border-destructive/30 text-destructive";
  return "bg-amber-400/20 border-amber-500/40 text-amber-900";
}

const HOLD_THRESHOLD_MS = 250;
const ATTENDANCE_DAY_DATA_ATTR = "data-attendance-day";

function getDayFromEventTarget(target: EventTarget | null): number | null {
  const el = target instanceof Element ? target.closest(`[${ATTENDANCE_DAY_DATA_ATTR}]`) : null;
  if (!el) return null;
  const day = el.getAttribute(ATTENDANCE_DAY_DATA_ATTR);
  const n = day ? parseInt(day, 10) : NaN;
  return Number.isFinite(n) ? n : null;
}

function FixedAttendanceDayCell({
  day,
  status,
  unpaidLeave,
  onSelect,
  onPointerDown,
  onPointerUp,
  isSelected,
  isAnchor,
}: {
  day: number;
  status: FixedDayStatus;
  unpaidLeave: boolean;
  onSelect: (next: FixedDayStatus) => void;
  onPointerDown?: (day: number, e: React.PointerEvent) => void;
  onPointerUp?: (day: number, e: React.PointerEvent) => void;
  isSelected?: boolean;
  isAnchor?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div
      {...{ [ATTENDANCE_DAY_DATA_ATTR]: String(day) }}
      className="min-w-0"
      onPointerDown={(e) => onPointerDown?.(day, e)}
      onPointerUp={(e) => onPointerUp?.(day, e)}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "aspect-square w-full rounded-md border p-1 text-[11px] leading-tight transition-colors",
              fixedStatusClass(status, unpaidLeave),
              isSelected && "ring-2 ring-primary ring-offset-1",
              isAnchor && isSelected && "ring-offset-2"
            )}
          >
            <div className="font-semibold text-sm">{day}</div>
            <div className="mt-1">{fixedStatusLabel(status, unpaidLeave)}</div>
          </button>
        </PopoverTrigger>
      <PopoverContent className="w-48 p-3" align="start">
        <div className="space-y-3">
          <p className="text-sm font-semibold">Day {day}</p>
          <div className="grid gap-2">
            <Button
              type="button"
              variant={status === "present" ? "default" : "outline"}
              onClick={() => {
                onSelect("present");
                setOpen(false);
              }}
            >
              Present
            </Button>
            <Button
              type="button"
              variant={status === "absent" ? "destructive" : "outline"}
              onClick={() => {
                onSelect("absent");
                setOpen(false);
              }}
            >
              Absent
            </Button>
            <Button
              type="button"
              variant={status === "paid_leave" || status === "leave" ? "default" : "outline"}
              onClick={() => {
                onSelect("paid_leave");
                setOpen(false);
              }}
            >
              Paid Leave
            </Button>
            <Button
              type="button"
              variant={status === "unpaid_leave" ? "default" : "outline"}
              onClick={() => {
                onSelect("unpaid_leave");
                setOpen(false);
              }}
            >
              Unpaid Leave
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
    </div>
  );
}

function DailyAttendanceDayCell({
  day,
  entry,
  onSave,
  onClear,
  onPointerDown,
  onPointerUp,
  isSelected,
  isAnchor,
}: {
  day: number;
  entry?: DailyAttendanceDay;
  onSave: (next: DailyAttendanceDay) => void;
  onClear: () => void;
  onPointerDown?: (day: number, e: React.PointerEvent) => void;
  onPointerUp?: (day: number, e: React.PointerEvent) => void;
  isSelected?: boolean;
  isAnchor?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<DailyDayStatus>(entry?.status ?? "present");
  const [hoursWorked, setHoursWorked] = useState(String(entry?.hoursWorked ?? 8));
  const [overtimeHours, setOvertimeHours] = useState(String(entry?.overtimeHours ?? 0));
  const [notes, setNotes] = useState(entry?.notes ?? "");

  useEffect(() => {
    setStatus(entry?.status ?? "present");
    setHoursWorked(String(entry?.hoursWorked ?? 8));
    setOvertimeHours(String(entry?.overtimeHours ?? 0));
    setNotes(entry?.notes ?? "");
  }, [entry]);

  const save = () => {
    const parsedHours = Math.max(0, Math.min(8, Number(hoursWorked) || 0));
    const parsedOvertime = Math.max(0, Number(overtimeHours) || 0);

    if (status !== "present") {
      onSave({
        status,
        hoursWorked: 0,
        overtimeHours: 0,
        notes: notes.trim() || undefined,
      });
      setOpen(false);
      return;
    }

    onSave({
      status,
      hoursWorked: parsedHours,
      overtimeHours: parsedOvertime,
      notes: notes.trim() || undefined,
    });
    setOpen(false);
  };

  return (
    <div
      {...{ [ATTENDANCE_DAY_DATA_ATTR]: String(day) }}
      className="min-w-0"
      onPointerDown={(e) => onPointerDown?.(day, e)}
      onPointerUp={(e) => onPointerUp?.(day, e)}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "aspect-square w-full rounded-md border p-1 text-[11px] leading-tight transition-colors",
              dailyStatusClass(entry),
              isSelected && "ring-2 ring-primary ring-offset-1",
              isAnchor && isSelected && "ring-offset-2"
            )}
          >
          <div className="font-semibold text-sm">{day}</div>
          <div className="mt-1">{dailyStatusLabel(entry)}</div>
          {entry?.status === "present" && entry.overtimeHours > 0 && (
            <div className="text-[10px] mt-0.5">Overtime: {entry.overtimeHours}h</div>
          )}
          {entry?.notes && (
            <div className="text-[9px] mt-0.5 truncate px-0.5" title={entry.notes}>
              {entry.notes}
            </div>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="start">
        <div className="space-y-3">
          <p className="text-sm font-semibold">Day {day}</p>
          <div>
            <Label className="text-xs">Status</Label>
            <Select value={status} onValueChange={(value) => setStatus(value as DailyDayStatus)}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="present">Present</SelectItem>
                <SelectItem value="absent">Absent</SelectItem>
                <SelectItem value="leave">Leave</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {status === "present" && (
            <>
              <div>
                <Label className="text-xs">Hours Worked (0 to 8)</Label>
                <Input
                  type="number"
                  min={0}
                  max={8}
                  step={0.5}
                  value={hoursWorked}
                  onChange={(event) => setHoursWorked(event.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">Overtime Hours</Label>
                <Input
                  type="number"
                  min={0}
                  step={0.5}
                  value={overtimeHours}
                  onChange={(event) => setOvertimeHours(event.target.value)}
                  className="mt-1"
                />
              </div>
            </>
          )}

          <div>
            <Label className="text-xs">Notes</Label>
            <Input
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className="mt-1"
              placeholder="Optional"
            />
          </div>

          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={save}>
              Save Day
            </Button>
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => {
                onClear();
                setOpen(false);
              }}
            >
              Clear
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
    </div>
  );
}

/** Convert API attendance to Record<day, status> for fixed. */
function fixedAttendanceFromApi(att: ApiAttendance | null): Record<number, string> {
  const out: Record<number, string> = {};
  if (!att?.fixedEntries?.length) return out;
  for (const e of att.fixedEntries) out[e.day] = e.status;
  return out;
}

/** Convert API attendance to Record<day, DailyAttendanceDay> for daily. */
function dailyAttendanceFromApi(att: ApiAttendance | null): Record<number, DailyAttendanceDay> {
  const out: Record<number, DailyAttendanceDay> = {};
  if (!att?.dailyEntries?.length) return out;
  for (const e of att.dailyEntries) {
    out[e.day] = {
      status: e.status as DailyDayStatus,
      hoursWorked: e.hoursWorked,
      overtimeHours: e.overtimeHours,
      notes: e.notes,
    };
  }
  return out;
}

export default function EmployeeLedger() {
  const navigate = useNavigate();
  const { employeeId } = useParams<{ employeeId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user: currentUser } = useAuth();

  const returnTo = searchParams.get("returnTo");
  const backPath = returnTo === "liabilities" ? "/liabilities" : returnTo === "receivables" ? "/receivables" : "/employees";
  const backLabel = returnTo === "liabilities" ? "Back to Liabilities" : returnTo === "receivables" ? "Back to Receivables" : "Back to Employees";

  const currentMonth = getLocalMonthKey();
  const urlMonth = searchParams.get("month") ?? currentMonth;
  const clampedUrlMonth = urlMonth > currentMonth ? currentMonth : urlMonth;
  const [selectedMonth, setSelectedMonth] = useState(clampedUrlMonth);
  const [paymentsPage, setPaymentsPage] = useState(1);
  const [paymentsPageSize, setPaymentsPageSize] = useState(12);
  const [ledgerStartDate, setLedgerStartDate] = useState("");
  const [ledgerEndDate, setLedgerEndDate] = useState("");
  const monthOptions = useMemo(() => buildMonthOptionsUpToCurrent(12), []);
  const canGoNext = selectedMonth < currentMonth;

  const {
    employee,
    ledger,
    attendance,
    loading,
    dataLoading,
    error: ledgerError,
    refetchLedger,
    refetchSnapshot,
    refetchAttendance,
    refetchEmployee,
  } = useEmployeeLedger(employeeId ?? undefined, selectedMonth, paymentsPage, paymentsPageSize, ledgerStartDate || undefined, ledgerEndDate || undefined);

  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [paymentQuickMode, setPaymentQuickMode] = useState<PaymentQuickMode>("partial");
  const [paymentMonthForAdvance, setPaymentMonthForAdvance] = useState(shiftMonth(currentMonth, 1));
  const [paymentDate, setPaymentDate] = useState(todayPKT());
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("Cash");
  const [paymentRemarks, setPaymentRemarks] = useState("");
  const [savingPayment, setSavingPayment] = useState(false);
  const [deleteConfirmPayment, setDeleteConfirmPayment] = useState<ApiEmployeePayment | null>(null);
  const [editEmployeeOpen, setEditEmployeeOpen] = useState(false);
  const [deleteConfirmEmployee, setDeleteConfirmEmployee] = useState<ApiEmployee | null>(null);

  // Multi-select attendance state
  const [selectedDays, setSelectedDays] = useState<Set<number>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectionAnchorDay, setSelectionAnchorDay] = useState<number | null>(null);
  const [isUnselectMode, setIsUnselectMode] = useState(false);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const anchorRef = useRef<number | null>(null);
  const unselectModeRef = useRef(false);
  const selectedDaysRef = useRef(selectedDays);
  selectedDaysRef.current = selectedDays;
  const [savingBulkAttendance, setSavingBulkAttendance] = useState(false);

  useEffect(() => {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      if (next.get("month") === selectedMonth) return previous;
      next.set("month", selectedMonth);
      return next;
    }, { replace: true });
  }, [selectedMonth, setSearchParams]);

  // Clear selection when month changes
  useEffect(() => {
    setSelectedDays(new Set());
    setSelectionMode(false);
    setSelectionAnchorDay(null);
    setIsUnselectMode(false);
  }, [selectedMonth]);

  // Reset payments page when month changes
  useEffect(() => {
    setPaymentsPage(1);
  }, [selectedMonth]);

  // Escape clears selection
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedDays(new Set());
        setSelectionMode(false);
        setSelectionAnchorDay(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const isSiteManager = currentUser?.role === "Site Manager";
  const canEditDelete = !isSiteManager;
  const snapshot = ledger?.snapshot;
  const monthKey = employeeId ? getMonthKey(employeeId, selectedMonth) : "";
  const fixedAttendance = useMemo(
    () => fixedAttendanceFromApi(attendance),
    [attendance]
  );
  const dailyAttendance = useMemo(
    () => dailyAttendanceFromApi(attendance),
    [attendance]
  );

  const payments = useMemo(() => {
    const rows = ledger?.rows ?? [];
    return ledgerStartDate
      ? [{ type: "previous" as const, id: "previous-balance", date: "", month: "", amount: 0, remarks: "Previous", runningTotal: ledger?.previousBalance ?? 0 }, ...rows]
      : rows;
  }, [ledger?.rows, ledger?.previousBalance, ledgerStartDate]);

  const totalPayments = payments.length;
  const totalPaymentPages = Math.max(1, Math.ceil(totalPayments / paymentsPageSize));
  const paymentsStartIndex = totalPayments === 0 ? 0 : (paymentsPage - 1) * paymentsPageSize + 1;
  const paymentsEndIndex = Math.min(paymentsPage * paymentsPageSize, totalPayments);
  const paginatedPayments = payments.slice((paymentsPage - 1) * paymentsPageSize, paymentsPage * paymentsPageSize);
  const ledgerPayableTotal = payments.reduce((sum, row) => sum + (row.type === "payable" ? row.amount : 0), 0);
  const ledgerPaymentTotal = payments.reduce((sum, row) => sum + (row.type === "payment" ? row.amount : 0), 0);

  const advanceMonthOptions = useMemo(() => buildAdvanceMonthOptions(6), []);

  const documentPointerCleanupRef = useRef<(() => void) | null>(null);

  const handleDocumentPointerMove = useCallback(
    (e: PointerEvent) => {
      const day = getDayFromEventTarget(e.target);
      if (day == null) return;
      const anchor = anchorRef.current;
      if (anchor == null) return;
      const minD = Math.min(anchor, day);
      const maxD = Math.max(anchor, day);
      if (unselectModeRef.current) {
        setSelectedDays((prev) => {
          const next = new Set(prev);
          for (let d = minD; d <= maxD; d++) next.delete(d);
          return next;
        });
      } else {
        setSelectedDays((prev) => {
          const next = new Set(prev);
          for (let d = minD; d <= maxD; d++) next.add(d);
          return next;
        });
      }
    },
    []
  );

  const handleDocumentPointerUp = useCallback(
    (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      documentPointerCleanupRef.current?.();
      documentPointerCleanupRef.current = null;
      setSelectionMode(false);
      setSelectionAnchorDay(null);
      setIsUnselectMode(false);
    },
    []
  );

  const handleDocumentPointerCancel = useCallback(() => {
    documentPointerCleanupRef.current?.();
    documentPointerCleanupRef.current = null;
    setSelectionMode(false);
    setSelectionAnchorDay(null);
    setIsUnselectMode(false);
  }, []);

  const handleDayPointerDown = useCallback(
    (day: number, _e?: React.PointerEvent) => {
      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
      holdTimerRef.current = setTimeout(() => {
        holdTimerRef.current = null;
        const wasSelected = selectedDaysRef.current.has(day);
        anchorRef.current = day;
        unselectModeRef.current = wasSelected;
        setSelectionMode(true);
        setSelectionAnchorDay(day);
        setIsUnselectMode(wasSelected);
        if (wasSelected) {
          setSelectedDays((prev) => {
            const next = new Set(prev);
            next.delete(day);
            return next;
          });
        } else {
          setSelectedDays((prev) => new Set(prev).add(day));
        }
        const onMove = handleDocumentPointerMove as (e: PointerEvent) => void;
        const onUp = handleDocumentPointerUp;
        const onCancel = handleDocumentPointerCancel;
        document.addEventListener("pointermove", onMove, true);
        document.addEventListener("pointerup", onUp, true);
        document.addEventListener("pointercancel", onCancel, true);
        documentPointerCleanupRef.current = () => {
          document.removeEventListener("pointermove", onMove, true);
          document.removeEventListener("pointerup", onUp, true);
          document.removeEventListener("pointercancel", onCancel, true);
        };
      }, HOLD_THRESHOLD_MS);
    },
    [handleDocumentPointerMove, handleDocumentPointerUp, handleDocumentPointerCancel]
  );

  const handleDayPointerUp = useCallback((_day: number, _e?: React.PointerEvent) => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  const applyBulkFixedStatus = useCallback(
    async (status: FixedDayStatus) => {
      if (!employeeId || selectedDays.size === 0 || savingBulkAttendance) return;
      setSavingBulkAttendance(true);
      const next: Record<number, string> = { ...fixedAttendance };
      for (const day of selectedDays) {
        if (status === "present") delete next[day];
        else next[day] = status;
      }
      const fixedEntries = Object.entries(next).map(([d, s]) => ({ day: Number(d), status: s }));
      try {
        await putAttendance(employeeId, { month: selectedMonth, fixedEntries });
        await refetchSnapshot();
        await refetchAttendance();
        setSelectedDays(new Set());
        toast.success(`Marked ${selectedDays.size} day(s) as ${status === "present" ? "Present" : status === "absent" ? "Absent" : status === "paid_leave" ? "Paid Leave" : "Unpaid Leave"}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to save attendance");
      } finally {
        setSavingBulkAttendance(false);
      }
    },
    [employeeId, selectedMonth, selectedDays, fixedAttendance, refetchSnapshot, refetchAttendance, savingBulkAttendance]
  );

  const applyBulkDailyStatus = useCallback(
    async (status: DailyDayStatus) => {
      if (!employeeId || selectedDays.size === 0 || savingBulkAttendance) return;
      setSavingBulkAttendance(true);
      const next: Record<number, DailyAttendanceDay> = { ...dailyAttendance };
      for (const day of selectedDays) {
        next[day] = {
          status,
          hoursWorked: status === "present" ? 8 : 0,
          overtimeHours: 0,
        };
      }
      const dailyEntries = Object.entries(next).map(([d, e]) => ({
        day: Number(d),
        hoursWorked: e.hoursWorked,
        overtimeHours: e.overtimeHours,
        status: e.status,
        notes: e.notes,
      }));
      try {
        await putAttendance(employeeId, { month: selectedMonth, dailyEntries });
        await refetchSnapshot();
        await refetchAttendance();
        setSelectedDays(new Set());
        toast.success(`Marked ${selectedDays.size} day(s) as ${status === "present" ? "Present" : status === "absent" ? "Absent" : "Leave"}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to save attendance");
      } finally {
        setSavingBulkAttendance(false);
      }
    },
    [employeeId, selectedMonth, selectedDays, dailyAttendance, refetchSnapshot, refetchAttendance, savingBulkAttendance]
  );

  if (!employeeId) {
    return (
      <Layout>
        <PageHeader
          title="Employee Ledger"
          subtitle="Invalid employee"
          actions={
            <Button variant="outline" onClick={() => navigate(backPath)}>
              <ArrowLeft className="h-4 w-4 mr-1" />
              {backLabel}
            </Button>
          }
        />
      </Layout>
    );
  }

  if (loading && !employee) {
    return (
      <Layout>
        <PageHeader title="Employee Ledger" subtitle="Loading…" />
        <p className="text-muted-foreground">Loading employee…</p>
      </Layout>
    );
  }

  if (ledgerError && !employee) {
    return (
      <Layout>
        <PageHeader title="Employee Ledger" subtitle="Error" />
        <p className="text-destructive">{ledgerError}</p>
        <Button variant="outline" onClick={() => navigate(backPath)}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          {backLabel}
        </Button>
      </Layout>
    );
  }

  if (!employee) {
    return (
      <Layout>
        <PageHeader
          title="Employee Ledger"
          subtitle="Employee not found or not in your scope"
          actions={
            <Button variant="outline" onClick={() => navigate(backPath)}>
              <ArrowLeft className="h-4 w-4 mr-1" />
              {backLabel}
            </Button>
          }
        />
      </Layout>
    );
  }

  const firstWeekday = (() => {
    const [year, monthNumber] = selectedMonth.split("-").map(Number);
    return new Date(year, monthNumber - 1, 1).getDay();
  })();
  const calendarDays = Array.from({ length: getDaysInMonth(selectedMonth) }, (_, index) => index + 1);

  const setFixedDay = async (day: number, status: FixedDayStatus) => {
    const next: Record<number, string> = { ...fixedAttendance };
    if (status === "present") delete next[day];
    else next[day] = status;
    const fixedEntries = Object.entries(next).map(([d, s]) => ({ day: Number(d), status: s }));
    try {
      await putAttendance(employeeId, { month: selectedMonth, fixedEntries });
      await refetchSnapshot();
      await refetchAttendance();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save attendance");
    }
  };

  const setDailyDay = async (day: number, entry: DailyAttendanceDay) => {
    const next: Record<number, DailyAttendanceDay> = { ...dailyAttendance };
    next[day] = entry;
    const dailyEntries = Object.entries(next).map(([d, e]) => ({
      day: Number(d),
      hoursWorked: e.hoursWorked,
      overtimeHours: e.overtimeHours,
      status: e.status,
      notes: e.notes,
    }));
    try {
      await putAttendance(employeeId, { month: selectedMonth, dailyEntries });
      await refetchSnapshot();
      await refetchAttendance();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save attendance");
    }
  };

  const clearDailyDay = async (day: number) => {
    const next: Record<number, DailyAttendanceDay> = { ...dailyAttendance };
    delete next[day];
    const dailyEntries = Object.entries(next).map(([d, e]) => ({
      day: Number(d),
      hoursWorked: e.hoursWorked,
      overtimeHours: e.overtimeHours,
      status: e.status,
      notes: e.notes,
    }));
    try {
      await putAttendance(employeeId, { month: selectedMonth, dailyEntries });
      await refetchSnapshot();
      await refetchAttendance();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save attendance");
    }
  };

  const openPaymentDialog = (mode: PaymentQuickMode) => {
    setPaymentQuickMode(mode);
    setPaymentDate(todayPKT());
    setPaymentMethod("Cash");
    setPaymentRemarks("");
    setPaymentMonthForAdvance(shiftMonth(currentMonth, 1));
    if (mode === "full" && snapshot) {
      setPaymentAmount(String(Math.round(snapshot.remaining * 100) / 100));
    } else if (mode === "partial" && snapshot && snapshot.remaining > 0) {
      // Prefill (not just placeholder) so the field never looks filled while actually being
      // empty — the remaining amount is still fully editable, unlike in "full" mode.
      setPaymentAmount(String(Math.round(snapshot.remaining * 100) / 100));
    } else {
      setPaymentAmount("");
    }
    setPaymentDialogOpen(true);
  };

  const handleDeletePayment = async () => {
    if (!deleteConfirmPayment) return;
    try {
      await deleteEmployeePayment(employeeId!, deleteConfirmPayment.id);
      await refetchLedger();
      await refetchSnapshot();
      setDeleteConfirmPayment(null);
      toast.success("Payment deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete payment");
    }
  };

  const handleDeleteEmployee = async () => {
    if (!deleteConfirmEmployee || !employeeId) return;
    try {
      await deleteEmployee(employeeId);
      setDeleteConfirmEmployee(null);
      toast.success("Employee deleted");
      navigate(backPath);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete employee");
    }
  };

  const savePayment = async (event: React.FormEvent) => {
    event.preventDefault();
    const rawAmount = paymentAmount.replace(/,/g, "").trim();
    const amountValue = paymentQuickMode === "full" && snapshot
      ? Math.round(snapshot.remaining * 100) / 100
      : parseFloat(rawAmount);
    if (!paymentDate || !Number.isFinite(amountValue) || amountValue <= 0) {
      toast.error("Valid payment date and amount are required");
      return;
    }
    const monthForPayment =
      paymentQuickMode === "advance" && employee.type === "Fixed" ? paymentMonthForAdvance : selectedMonth;
    setSavingPayment(true);
    try {
      await createEmployeePayment(employeeId, {
        month: monthForPayment,
        date: paymentDate,
        amount: amountValue,
        type: getPaymentType(employee, paymentQuickMode),
        paymentMethod,
        remarks: paymentRemarks.trim() || undefined,
      });
      await refetchLedger();
      await refetchSnapshot();
      setPaymentDialogOpen(false);
      setPaymentAmount("");
      setPaymentRemarks("");
      toast.success("Payment recorded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to record payment");
    } finally {
      setSavingPayment(false);
    }
  };

  const subtitle = `${employee.project ?? ""} - ${employee.role}`;
  const firstMonth = getFirstMonth(employee.createdAt, employee.joiningDate);
  const lastMonth = getLastMonth(employee.endingDate);
  const isBeforeEmployeeCreated = firstMonth ? selectedMonth < firstMonth : false;
  const isAfterEmployeeLeft = lastMonth ? selectedMonth > lastMonth : false;
  const isOutOfRange = isBeforeEmployeeCreated || isAfterEmployeeLeft;
  const noRemainingDue = isOutOfRange || !snapshot || snapshot.remaining <= 0;
  const noDataMessage = isAfterEmployeeLeft
    ? "NO DATA — Employee had already left the company by this month."
    : "NO DATA — Employee was not on the project for this month.";

  return (
    <Layout>
      <PageHeader
        title={`Employee Ledger - ${employee.name}`}
        subtitle={subtitle}
        secondaryText={`Phone: ${employee.phone || "—"}`}
        actions={
          <div className="flex items-center gap-2">
            <div>
              <Label className="text-xs uppercase text-muted-foreground">Month</Label>
              <div className="mt-1 flex items-center gap-2">
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  onClick={() => setSelectedMonth((current) => shiftMonth(current, -1))}
                  aria-label="Previous month"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                  <SelectTrigger className="w-[190px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {monthOptions.map((month) => (
                      <SelectItem key={month} value={month}>
                        {monthLabel(month)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  disabled={!canGoNext}
                  onClick={() => setSelectedMonth((current) => shiftMonth(current, 1))}
                  aria-label="Next month"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
            {canEditDelete && (
              <>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setEditEmployeeOpen(true)}
                  title="Edit employee"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setDeleteConfirmEmployee(employee)}
                  title="Delete employee"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </>
            )}
            <Button variant="outline" onClick={() => navigate(backPath)}>
              <ArrowLeft className="h-4 w-4 mr-1" />
              {backLabel}
            </Button>
          </div>
        }
      />

      <EditEmployeeDialog
        open={editEmployeeOpen}
        onOpenChange={setEditEmployeeOpen}
        employee={employee}
        onSuccess={refetchEmployee}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusBadge status={employee.type} />
        {lastMonth && <Badge variant="outline" className="text-xs font-normal text-muted-foreground">Left {lastMonth}</Badge>}
        {!isOutOfRange && snapshot && <StatusBadge status={snapshot.paymentStatus} />}
      </div>

      <div className="border-2 border-border p-4 mb-4">
        <h2 className="text-sm font-bold uppercase tracking-wide mb-3">Summary</h2>
        {isOutOfRange ? (
          <p className="text-muted-foreground py-4">{noDataMessage}</p>
        ) : dataLoading ? (
          <div className="flex items-center gap-2 py-4 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading month data…
          </div>
        ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <div className="border border-border rounded-md p-3">
            <p className="text-xs text-muted-foreground uppercase">
              {employee.type === "Fixed" ? "Salary (Fixed)" : "Wages (Daily)"}
            </p>
            <p className="mt-1 text-lg font-semibold">
              {employee.type === "Fixed"
                ? formatCurrency(employee.monthlySalary ?? 0)
                : formatCurrency(employee.dailyRate ?? 0)}
            </p>
          </div>

          <div className="border border-border rounded-md p-3">
            <p className="text-xs text-muted-foreground uppercase">Total Payable (this month)</p>
            <p className="mt-1 text-lg font-semibold">{formatCurrency(snapshot?.payable ?? 0)}</p>
          </div>

          <div className="border border-border rounded-md p-3">
            <p className="text-xs text-muted-foreground uppercase">Paid</p>
            <p className="mt-1 text-lg font-semibold text-success">{formatCurrency(snapshot?.paid ?? 0)}</p>
          </div>

          <div className="border border-border rounded-md p-3">
            <p className="text-xs text-muted-foreground uppercase">Remaining</p>
            <p className="mt-1 text-lg font-semibold text-destructive">{formatCurrency(snapshot?.remaining ?? 0)}</p>
          </div>

          <div className="border border-border rounded-md p-3">
            <p className="text-xs text-muted-foreground uppercase">Payment Status</p>
            <div className="mt-2">
              {snapshot ? <StatusBadge status={snapshot.paymentStatus} /> : "—"}
            </div>
          </div>
        </div>
        )}
      </div>

      <div className="border-2 border-border p-4 mb-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h2 className="text-sm font-bold uppercase tracking-wide">Payments Ledger</h2>
          <div className="flex flex-wrap items-center gap-2">
            <PrintExportButton title={`Payments Ledger - ${employee.name}`} printTargetId="employee-payment-ledger" />
            {noRemainingDue && !isOutOfRange && (
              <span className="text-sm text-muted-foreground">No remaining due for this month.</span>
            )}
            <Button type="button" variant="outline" onClick={() => openPaymentDialog("partial")} disabled={noRemainingDue}>
              Record Payment
            </Button>
            <Button type="button" variant="outline" onClick={() => openPaymentDialog("advance")}>
              Advance Salary
            </Button>
            <Button type="button" variant="warning" onClick={() => openPaymentDialog("full")} disabled={noRemainingDue}>
              Pay Full Remaining
            </Button>
          </div>
        </div>
        <div className="mb-3 flex flex-wrap items-end gap-2 print-hidden">
          <div>
            <Label className="text-xs uppercase text-muted-foreground">From</Label>
            <Input type="date" value={ledgerStartDate} onChange={(e) => { setLedgerStartDate(e.target.value); setPaymentsPage(1); }} className="mt-1 h-9 w-[155px]" />
          </div>
          <div>
            <Label className="text-xs uppercase text-muted-foreground">To</Label>
            <Input type="date" min={ledgerStartDate || undefined} value={ledgerEndDate} onChange={(e) => { setLedgerEndDate(e.target.value); setPaymentsPage(1); }} className="mt-1 h-9 w-[155px]" />
          </div>
          {(ledgerStartDate || ledgerEndDate) && (
            <Button type="button" variant="outline" size="sm" onClick={() => { setLedgerStartDate(""); setLedgerEndDate(""); setPaymentsPage(1); }}>Clear range</Button>
          )}
        </div>

        <div id="employee-payment-ledger" className="border border-border rounded-md overflow-x-auto">
          {dataLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading payments…
            </div>
          ) : (
          <table className="w-full text-sm min-w-[700px]">
            <thead className="bg-muted">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Date</th>
                <th className="px-3 py-2 text-left font-semibold">Month</th>
                <th className="px-3 py-2 text-left font-semibold">Remarks</th>
                <th className="px-3 py-2 text-right font-semibold">Salary / Wage</th>
                <th className="px-3 py-2 text-right font-semibold">Payment Given</th>
                <th className="px-3 py-2 text-right font-semibold">Running Total</th>
                {!isSiteManager && <th className="px-3 py-2 text-left font-semibold print-hidden">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {payments.length === 0 ? (
                <tr>
                  <td colSpan={isSiteManager ? 7 : 8} className="px-3 py-6 text-center text-muted-foreground">
                    No ledger entries recorded.
                  </td>
                </tr>
              ) : (
                paginatedPayments.map((payment) => (
                  <tr key={payment.id} className="border-t border-border">
                    <td className="px-3 py-2">{formatDisplayDate(payment.date)}</td>
                    <td className="px-3 py-2">{payment.month ? monthLabel(payment.month) : "—"}</td>
                    <td className="px-3 py-2">{payment.remarks ?? "—"}{payment.paymentMethod ? ` · ${payment.paymentMethod}` : ""}</td>
                    <td className="px-3 py-2 text-right font-mono">{payment.type === "payable" ? formatCurrency(payment.amount) : "—"}</td>
                    <td className="px-3 py-2 text-right font-mono">{payment.type === "payment" ? formatCurrency(payment.amount) : "—"}</td>
                    <td className={`px-3 py-2 text-right font-mono font-semibold ${payment.runningTotal < 0 ? "text-success" : ""}`}>{formatCurrency(payment.runningTotal)}</td>
                {!isSiteManager && payment.type === "payment" && (
                  <td className="px-3 py-2 print-hidden">
                        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setDeleteConfirmPayment(payment as unknown as ApiEmployeePayment)}>Delete</Button>
                      </td>
                    )}
                    {!isSiteManager && payment.type !== "payment" && <td className="print-hidden" />}
                  </tr>
                ))
              )}
            </tbody>
            {payments.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-border bg-muted font-semibold">
                  <td colSpan={3} className="px-3 py-2 text-right">Totals</td>
                  <td className="px-3 py-2 text-right font-mono">{formatCurrency(ledgerPayableTotal)}</td>
                  <td className="px-3 py-2 text-right font-mono">{formatCurrency(ledgerPaymentTotal)}</td>
                  <td className="px-3 py-2" />
                  {!isSiteManager && <td className="print-hidden" />}
                </tr>
              </tfoot>
            )}
          </table>
          )}
        </div>
        {!dataLoading && ledger && payments.length > 0 && (
          <TablePagination
            pageSize={paymentsPageSize}
            onPageSizeChange={(size) => {
              setPaymentsPageSize(size);
              setPaymentsPage(1);
            }}
            page={paymentsPage}
            totalPages={totalPaymentPages}
            totalItems={totalPayments}
            onPrevious={() => setPaymentsPage((p) => Math.max(1, p - 1))}
            onNext={() => setPaymentsPage((p) => Math.min(totalPaymentPages, p + 1))}
            canPrevious={paymentsPage > 1}
            canNext={paymentsPage < totalPaymentPages}
            pageSizeOptions={PAYMENT_PAGE_SIZE_OPTIONS}
            startIndexOneBased={paymentsStartIndex}
            endIndex={paymentsEndIndex}
          />
        )}
      </div>

      <div className="border-2 border-border p-4">
        <h2 className="text-sm font-bold uppercase tracking-wide mb-3">Attendance</h2>

        {isOutOfRange ? (
          <p className="text-muted-foreground py-4">{noDataMessage}</p>
        ) : dataLoading ? (
          <div className="flex items-center gap-2 py-4 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading attendance…
          </div>
        ) : (
          <>
            {employee.type === "Fixed" ? (
              <div className="border border-border rounded-md p-3 mb-3 text-sm">
                Paid leave: no limit. Unpaid leave reduces payable.
                {" | "}
                Mark attendance per day below. Hold and drag to multi-select days.
              </div>
            ) : (
              <div className="border border-border rounded-md p-3 mb-3 text-sm">
                Click any day to set status and overtime hours. Hold and drag to multi-select days.
              </div>
            )}

            {selectedDays.size > 0 && (
              <div className="mb-3 flex flex-wrap items-center gap-2 p-3 rounded-md border border-border bg-muted/30">
                <span className="text-sm font-medium flex items-center gap-2">
                  {selectedDays.size} day{selectedDays.size !== 1 ? "s" : ""} selected
                  {savingBulkAttendance && (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      <span className="text-muted-foreground">Saving…</span>
                    </>
                  )}
                </span>
                <div className="flex flex-wrap gap-2">
                  {employee.type === "Fixed" ? (
                    <>
                      <Button size="sm" variant="outline" onClick={() => applyBulkFixedStatus("present")} disabled={savingBulkAttendance}>
                        Mark Present
                      </Button>
                      <Button size="sm" variant="outline" className="text-destructive" onClick={() => applyBulkFixedStatus("absent")} disabled={savingBulkAttendance}>
                        Mark Absent
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => applyBulkFixedStatus("paid_leave")} disabled={savingBulkAttendance}>
                        Mark Paid Leave
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => applyBulkFixedStatus("unpaid_leave")} disabled={savingBulkAttendance}>
                        Mark Unpaid Leave
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button size="sm" variant="outline" onClick={() => applyBulkDailyStatus("present")} disabled={savingBulkAttendance}>
                        Mark Present
                      </Button>
                      <Button size="sm" variant="outline" className="text-destructive" onClick={() => applyBulkDailyStatus("absent")} disabled={savingBulkAttendance}>
                        Mark Absent
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => applyBulkDailyStatus("leave")} disabled={savingBulkAttendance}>
                        Mark Leave
                      </Button>
                    </>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setSelectedDays(new Set())} disabled={savingBulkAttendance}>
                    Clear selection
                  </Button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-muted-foreground border-b border-border pb-1 mb-2">
              {WEEKDAYS.map((weekday) => (
                <div key={weekday}>{weekday}</div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: firstWeekday }, (_, index) => (
                <div key={`offset-${index}`} className="aspect-square" />
              ))}

              {calendarDays.map((day) => {
                if (employee.type === "Fixed") {
                  const status = (fixedAttendance[day] ?? "present") as FixedDayStatus;
                  const unpaidLeave = status === "unpaid_leave";

                  return (
                    <FixedAttendanceDayCell
                      key={day}
                      day={day}
                      status={status}
                      unpaidLeave={unpaidLeave}
                      onSelect={(next) => setFixedDay(day, next)}
                      onPointerDown={handleDayPointerDown}
                      onPointerUp={handleDayPointerUp}
                      isSelected={selectedDays.has(day)}
                      isAnchor={selectionAnchorDay === day}
                    />
                  );
                }

                return (
                  <DailyAttendanceDayCell
                    key={day}
                    day={day}
                    entry={dailyAttendance[day]}
                    onSave={(next) => setDailyDay(day, next)}
                    onClear={() => clearDailyDay(day)}
                    onPointerDown={handleDayPointerDown}
                    onPointerUp={handleDayPointerUp}
                    isSelected={selectedDays.has(day)}
                    isAnchor={selectionAnchorDay === day}
                  />
                );
              })}
            </div>
          </>
        )}
      </div>

      <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Record Payment - {employee.name}</DialogTitle>
          </DialogHeader>

          <form onSubmit={savePayment} className="space-y-4" noValidate>
            <div>
              <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Quick Option</Label>
              <div className="mt-2 grid grid-cols-3 gap-2">
                <Button
                  type="button"
                  variant={paymentQuickMode === "advance" ? "default" : "outline"}
                  onClick={() => {
                    setPaymentQuickMode("advance");
                    setPaymentAmount("");
                  }}
                >
                  Advance
                </Button>
                <Button
                  type="button"
                  variant={paymentQuickMode === "partial" ? "default" : "outline"}
                  onClick={() => {
                    setPaymentQuickMode("partial");
                    setPaymentAmount("");
                  }}
                >
                  Partial
                </Button>
                <Button
                  type="button"
                  variant={paymentQuickMode === "full" ? "default" : "outline"}
                  disabled={!snapshot || snapshot.remaining <= 0}
                  onClick={() => {
                    setPaymentQuickMode("full");
                    if (snapshot) setPaymentAmount(String(Math.round(snapshot.remaining * 100) / 100));
                  }}
                >
                  Full
                </Button>
              </div>
            </div>

            {paymentQuickMode === "advance" && employee.type === "Fixed" && (
              <div>
                <Label>Month for advance *</Label>
                <Select value={paymentMonthForAdvance} onValueChange={setPaymentMonthForAdvance}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {advanceMonthOptions.map((month) => (
                      <SelectItem key={month} value={month}>
                        {monthLabel(month)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <Label>Payment Date *</Label>
              <Input type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} className="mt-1" />
            </div>

            <div>
              <Label>Amount *</Label>
              <Input
                type="text"
                inputMode="decimal"
                value={paymentAmount}
                onChange={(event) => setPaymentAmount(event.target.value)}
                placeholder={
                  paymentQuickMode === "partial" && snapshot?.remaining != null
                    ? formatCurrency(snapshot.remaining)
                    : "e.g. 10000 or 10,000"
                }
                className="mt-1"
                disabled={paymentQuickMode === "full"}
              />
              {paymentQuickMode === "partial" && snapshot?.remaining != null && (
                <p className="text-xs text-muted-foreground mt-1">Remaining for {monthLabel(selectedMonth)}: {formatCurrency(snapshot.remaining)}</p>
              )}
              {paymentQuickMode === "advance" && employee.type === "Daily" && (
                <p className="text-xs text-muted-foreground mt-1">
                  Recorded for {monthLabel(selectedMonth)}. This advance will reduce this employee's Net Payable on
                  future salary sheets until it's earned back.
                </p>
              )}
              {paymentQuickMode === "full" && (
                <p className="text-xs text-muted-foreground mt-1">
                  Full remaining for {monthLabel(selectedMonth)}: {snapshot ? formatCurrency(snapshot.remaining) : "—"}
                </p>
              )}
            </div>

            <div>
              <Label>Payment Method *</Label>
              <Select value={paymentMethod} onValueChange={(value) => setPaymentMethod(value as PaymentMethod)}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Cash">Cash</SelectItem>
                  <SelectItem value="Bank">Bank</SelectItem>
                  <SelectItem value="Online">Online</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Remarks</Label>
              <Input
                value={paymentRemarks}
                onChange={(event) => setPaymentRemarks(event.target.value)}
                className="mt-1"
                placeholder="Optional"
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPaymentDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="warning" disabled={savingPayment}>
                {savingPayment ? "Saving…" : "Save Payment"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteConfirmPayment} onOpenChange={(open) => !open && setDeleteConfirmPayment(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete payment?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the payment record. Totals will update accordingly.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeletePayment} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete Payment
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteConfirmEmployee} onOpenChange={(open) => !open && setDeleteConfirmEmployee(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete employee?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove {deleteConfirmEmployee?.name}. The employee cannot be deleted if they have any payment records.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteEmployee} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete Employee
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}
