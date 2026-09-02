import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { MockStoreProvider } from "@/context/MockStore";
import { AuthProvider } from "@/context/AuthContext";
import { SelectedProjectProvider } from "@/context/SelectedProjectContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import Login from "./pages/Login";
import Index from "./pages/Index";
import Projects from "./pages/Projects";
import ProjectLedger from "./pages/ProjectLedger";
import ConsumableInventory from "./pages/ConsumableInventory";
import ItemLedger from "./pages/ItemLedger";
import NonConsumableInventory from "./pages/NonConsumableInventory";
import NonConsumableItemLedger from "./pages/NonConsumableItemLedger";
import Vendors from "./pages/Vendors";
import VendorLedger from "./pages/VendorLedger";
import Customers from "./pages/Customers";
import CustomerLedger from "./pages/CustomerLedger";
import Contractors from "./pages/Contractors";
import Employees from "./pages/Employees";
import EmployeeLedger from "./pages/EmployeeLedger";
import BankAccounts from "./pages/BankAccounts";
import BankAccountLedger from "./pages/BankAccountLedger";
import Clients from "./pages/Clients";
import ClientLedger from "./pages/ClientLedger";
import Expenses from "./pages/Expenses";
import Machinery from "./pages/Machinery";
import MachineLedger from "./pages/MachineLedger";
import Liabilities from "./pages/Liabilities";
import Receivables from "./pages/Receivables";
import AuditLogs from "./pages/AuditLogs";
import UserManagement from "./pages/UserManagement";
import QuickEntry from "./pages/QuickEntry";
import CashAndExpenses from "./pages/CashAndExpenses";
import Reports from "./pages/Reports";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <MockStoreProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
          <SelectedProjectProvider>
          <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<ProtectedRoute><Index /></ProtectedRoute>} />
          <Route path="/quick-entry" element={<ProtectedRoute><QuickEntry /></ProtectedRoute>} />
          <Route path="/projects" element={<ProtectedRoute><Projects /></ProtectedRoute>} />
          <Route path="/projects/:projectId/ledger" element={<ProtectedRoute><ProjectLedger /></ProtectedRoute>} />
          <Route path="/cash-expenses" element={<ProtectedRoute><CashAndExpenses /></ProtectedRoute>} />
          <Route path="/reports" element={<ProtectedRoute><Reports /></ProtectedRoute>} />
          <Route path="/inventory/consumable" element={<ProtectedRoute><ConsumableInventory /></ProtectedRoute>} />
          <Route path="/inventory/consumable/:itemId" element={<ProtectedRoute><ItemLedger /></ProtectedRoute>} />
          <Route path="/inventory/non-consumable" element={<ProtectedRoute><NonConsumableInventory /></ProtectedRoute>} />
          <Route path="/inventory/non-consumable/:itemId" element={<ProtectedRoute><NonConsumableItemLedger /></ProtectedRoute>} />
          <Route path="/vendors" element={<ProtectedRoute><Vendors /></ProtectedRoute>} />
          <Route path="/vendors/:vendorId" element={<ProtectedRoute><VendorLedger /></ProtectedRoute>} />
          <Route path="/customers" element={<ProtectedRoute><Customers /></ProtectedRoute>} />
          <Route path="/customers/:customerId" element={<ProtectedRoute><CustomerLedger /></ProtectedRoute>} />
          <Route path="/contractors" element={<ProtectedRoute><Contractors /></ProtectedRoute>} />
          <Route path="/employees" element={<ProtectedRoute><Employees /></ProtectedRoute>} />
          <Route path="/employees/:employeeId" element={<ProtectedRoute><EmployeeLedger /></ProtectedRoute>} />
          <Route path="/machinery-employees" element={<ProtectedRoute><Employees /></ProtectedRoute>} />
          <Route path="/machinery-employees/:employeeId" element={<ProtectedRoute><EmployeeLedger /></ProtectedRoute>} />
          <Route path="/bank-accounts" element={<ProtectedRoute requiredRole="Admin"><BankAccounts /></ProtectedRoute>} />
          <Route path="/bank-accounts/:accountId/ledger" element={<ProtectedRoute requiredRole="Admin"><BankAccountLedger /></ProtectedRoute>} />
          <Route path="/clients" element={<ProtectedRoute requiredRole="Admin"><Clients /></ProtectedRoute>} />
          <Route path="/clients/:clientId/ledger" element={<ProtectedRoute requiredRole="Admin"><ClientLedger /></ProtectedRoute>} />
          <Route path="/expenses" element={<ProtectedRoute><Expenses /></ProtectedRoute>} />
          <Route path="/machinery" element={<ProtectedRoute><Machinery /></ProtectedRoute>} />
          <Route path="/machinery/:machineId" element={<ProtectedRoute><MachineLedger /></ProtectedRoute>} />
          <Route path="/liabilities" element={<ProtectedRoute><Liabilities /></ProtectedRoute>} />
          <Route path="/receivables" element={<ProtectedRoute><Receivables /></ProtectedRoute>} />
          <Route path="/audit-logs" element={<ProtectedRoute requiredRole="Super Admin"><AuditLogs /></ProtectedRoute>} />
          <Route path="/users" element={<ProtectedRoute requiredRole="Admin"><UserManagement /></ProtectedRoute>} />
          <Route path="*" element={<ProtectedRoute><NotFound /></ProtectedRoute>} />
        </Routes>
          </SelectedProjectProvider>
          </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
    </MockStoreProvider>
  </QueryClientProvider>
);

export default App;
