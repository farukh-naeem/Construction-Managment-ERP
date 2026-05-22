import "dotenv/config";
import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import { authRoutes } from "./routes/auth.js";
import { userRoutes } from "./routes/users.js";
import { auditLogRoutes } from "./routes/auditLogs.js";
import { projectRoutes } from "./routes/projects.js";
import { vendorRoutes } from "./routes/vendors.js";
import { consumableItemRoutes } from "./routes/consumableItems.js";
import { itemLedgerRoutes } from "./routes/itemLedger.js";
import { stockConsumptionRoutes } from "./routes/stockConsumption.js";
import { vendorPaymentRoutes } from "./routes/vendorPayments.js";
import { contractorRoutes } from "./routes/contractors.js";
import { contractorPaymentRoutes } from "./routes/contractorPayments.js";
import { employeeRoutes } from "./routes/employees.js";
import { employeeLedgerRoutes } from "./routes/employeeLedger.js";
import { nonConsumableCategoryRoutes } from "./routes/nonConsumableCategories.js";
import { nonConsumableItemRoutes } from "./routes/nonConsumableItems.js";
import { expenseRoutes } from "./routes/expenses.js";
import { machineRoutes } from "./routes/machines.js";
import { bankAccountRoutes } from "./routes/bankAccounts.js";
import { bankTransactionRoutes } from "./routes/bankTransactions.js";
import { projectLedgerRoutes } from "./routes/projectLedger.js";

const PORT = process.env.PORT ?? 3001;
const MONGODB_URI = process.env.MONGODB_URI ?? "mongodb://localhost:27017/builderp";

// Allow comma-separated list in env, plus sensible defaults for local + production
const DEFAULT_CORS_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
  "http://localhost:8080",
  "https://construction-managment-erp-2ekl.vercel.app",
];

const envCorsOrigins = (process.env.CORS_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const ALLOWED_ORIGINS = Array.from(new Set([...DEFAULT_CORS_ORIGINS, ...envCorsOrigins]));

const app = express();

// Restrictive CORS: allow configured origins and enable cookies/credentials
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow non-browser requests (Postman/cURL) with no origin header
      if (!origin) return callback(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
  })
);
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/audit-logs", auditLogRoutes);
app.use("/api/projects", projectRoutes);
app.use("/api/projects/:projectId/ledger", projectLedgerRoutes);
app.use("/api/vendors", vendorRoutes);
app.use("/api/consumable-items", consumableItemRoutes);
app.use("/api/consumable-items/:itemId/ledger", itemLedgerRoutes);
app.use("/api/stock-consumption", stockConsumptionRoutes);
app.use("/api/vendors/:vendorId", vendorPaymentRoutes);
app.use("/api/contractors", contractorRoutes);
app.use("/api/contractors/:contractorId", contractorPaymentRoutes);
app.use("/api/employees", employeeRoutes);
app.use("/api/employees/:employeeId", employeeLedgerRoutes);
app.use("/api/non-consumable-categories", nonConsumableCategoryRoutes);
app.use("/api/non-consumable-items", nonConsumableItemRoutes);
app.use("/api/expenses", expenseRoutes);
app.use("/api/machines", machineRoutes);
app.use("/api/bank-accounts", bankAccountRoutes);
app.use("/api/bank-transactions", bankTransactionRoutes);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

async function start() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log("MongoDB connected");
  } catch (err) {
    console.error("MongoDB connection error:", err);
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

start();
