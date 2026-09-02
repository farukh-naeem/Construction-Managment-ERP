import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import Layout from "@/components/Layout";
import PageHeader from "@/components/PageHeader";
import { Input } from "@/components/ui/input";
import { getBankAccountLedger, type BankAccountLedgerResult } from "@/services/bankTransactionService";
import { formatCurrency } from "@/lib/mock-data";
import { formatDisplayDate } from "@/lib/pktDate";

const RECEIVED_HEAD_KEY = "received";

export default function BankAccountLedger() {
  const { accountId } = useParams<{ accountId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedHeadKey = searchParams.get("head");
  const [ledger, setLedger] = useState<BankAccountLedgerResult>();
  const [error, setError] = useState<string>();
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  useEffect(() => {
    if (!accountId) return;
    setError(undefined);
    // Keep the full ledger in memory so a filtered view still has the correct
    // running balance from transactions before the selected date range.
    void getBankAccountLedger(accountId)
      .then(setLedger)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load ledger"));
  }, [accountId]);

  const selectedHead = useMemo(() => {
    if (!selectedHeadKey || !ledger) return undefined;
    if (selectedHeadKey === RECEIVED_HEAD_KEY) return { key: RECEIVED_HEAD_KEY, label: "Received" };
    return ledger.columns.find((column) => column.key === selectedHeadKey);
  }, [ledger, selectedHeadKey]);

  const focusedRows = useMemo(() => {
    if (!selectedHead) return [];
    let balance = 0;
    return ledger?.rows.reduce<{ id: string; date: string; particulars: string; amount: number; balance: number }[]>((rows, row) => {
      const amount = selectedHead.key === RECEIVED_HEAD_KEY ? row.received : row.outflows[selectedHead.key];
      if (!amount) return rows;
      balance += selectedHead.key === RECEIVED_HEAD_KEY ? amount : -amount;
      if ((startDate && row.date < startDate) || (endDate && row.date > endDate)) return rows;
      rows.push({ id: row.id, date: row.date, particulars: row.particulars, amount, balance });
      return rows;
    }, []) ?? [];
  }, [endDate, ledger?.rows, selectedHead, startDate]);

  const displayedCombinedRows = useMemo(
    () => ledger?.rows.filter((row) => (!startDate || row.date >= startDate) && (!endDate || row.date <= endDate)) ?? [],
    [endDate, ledger?.rows, startDate]
  );

  const combinedTotals = useMemo(() => ({
    received: displayedCombinedRows.reduce((sum, row) => sum + (row.received ?? 0), 0),
    outflows: ledger?.columns.reduce<Record<string, number>>((totals, column) => {
      totals[column.key] = displayedCombinedRows.reduce((sum, row) => sum + (row.outflows[column.key] ?? 0), 0);
      return totals;
    }, {}) ?? {},
  }), [displayedCombinedRows, ledger?.columns]);

  const focusedTotal = useMemo(
    () => focusedRows.reduce((sum, row) => sum + row.amount, 0),
    [focusedRows]
  );

  const selectHead = (key: string) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("head", key);
      return next;
    });
  };

  const showCombinedLedger = () => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("head");
      return next;
    });
  };

  const title = `${ledger?.accountName ?? "Bank Account"} — ${selectedHead ? `${selectedHead.label} Ledger` : "Ledger"}`;

  return (
    <Layout>
      <Link to="/bank-accounts" className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="h-3 w-3" />Back to Bank Accounts
      </Link>
      <PageHeader
        title={title}
        subtitle={selectedHead ? `Transactions for ${selectedHead.label}` : "Chronological account ledger"}
        printTargetId="bank-account-ledger"
        printOptions={{ additionalPrintCss: "#bank-account-ledger th button { display: inline !important; }" }}
      />
      <div className="flex gap-3 mb-4">
        <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="max-w-44" />
        <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="max-w-44" />
      </div>
      {selectedHead && (
        <button type="button" onClick={showCombinedLedger} className="mb-4 text-sm font-medium text-primary hover:underline">Show combined ledger</button>
      )}
      {selectedHeadKey && !selectedHead && ledger && (
        <button type="button" onClick={showCombinedLedger} className="mb-4 text-sm font-medium text-primary hover:underline">Show combined ledger</button>
      )}
      {error ? <p className="text-destructive">{error}</p> : !ledger ? <p className="text-muted-foreground">Loading ledger…</p> : selectedHead ? (
        <div id="bank-account-ledger" className="rounded-xl border bg-card overflow-x-auto">
          <table className="min-w-max w-full text-sm">
            <thead><tr className="border-b bg-muted/10 text-muted-foreground"><th className="p-3 text-left">Date</th><th className="p-3 text-left">Reference / Remarks</th><th className="p-3 text-right">{selectedHead.label}</th><th className="p-3 text-right">Balance</th></tr></thead>
            <tbody>{focusedRows.length ? focusedRows.map((row) => <tr key={row.id} className="border-b"><td className="p-3">{formatDisplayDate(row.date)}</td><td className="p-3">{row.particulars}</td><td className="p-3 text-right">{formatCurrency(row.amount)}</td><td className="p-3 text-right font-mono font-medium">{formatCurrency(row.balance)}</td></tr>) : <tr><td colSpan={4} className="p-6 text-center text-muted-foreground">No transactions for this head in the selected date range.</td></tr>}</tbody>
            <tfoot><tr className="border-t-2 bg-muted/30 font-bold"><td colSpan={2} className="p-3 text-right">Total</td><td className="p-3 text-right">{formatCurrency(focusedTotal)}</td><td className="p-3" /></tr></tfoot>
          </table>
        </div>
      ) : (
        <div id="bank-account-ledger" className="rounded-xl border bg-card overflow-x-auto">
          <table className="min-w-max w-full text-sm">
            <thead><tr className="border-b bg-muted/10 text-muted-foreground"><th className="p-3 text-left">Date</th><th className="p-3 text-left">Reference / Remarks</th><th className="p-3 text-right"><button type="button" onClick={() => selectHead(RECEIVED_HEAD_KEY)} className="hover:text-primary hover:underline">Received</button></th>{ledger.columns.map((column) => <th key={column.key} className="p-3 text-right"><button type="button" onClick={() => selectHead(column.key)} className="hover:text-primary hover:underline">{column.label}</button></th>)}<th className="p-3 text-right">Balance</th></tr></thead>
            <tbody>{displayedCombinedRows.map((row) => <tr key={row.id} className="border-b"><td className="p-3">{formatDisplayDate(row.date)}</td><td className="p-3">{row.particulars}</td><td className="p-3 text-right">{row.received ? formatCurrency(row.received) : "—"}</td>{ledger.columns.map((column) => <td key={column.key} className="p-3 text-right">{row.outflows[column.key] ? formatCurrency(row.outflows[column.key]) : "—"}</td>)}<td className="p-3 text-right font-mono font-medium">{formatCurrency(row.balance)}</td></tr>)}</tbody>
            <tfoot><tr className="border-t-2 bg-muted/30 font-bold"><td colSpan={2} className="p-3 text-right">Total</td><td className="p-3 text-right">{formatCurrency(combinedTotals.received)}</td>{ledger.columns.map((column) => <td key={column.key} className="p-3 text-right">{formatCurrency(combinedTotals.outflows[column.key] ?? 0)}</td>)}<td className="p-3" /></tr></tfoot>
          </table>
        </div>
      )}
    </Layout>
  );
}
