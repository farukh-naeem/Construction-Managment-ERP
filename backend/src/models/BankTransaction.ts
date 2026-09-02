import mongoose from "mongoose";

export type BankTransactionType = "inflow" | "outflow";
export type BankTransactionMode = "Cash" | "Bank" | "Online";

export interface IBankTransaction {
  _id: mongoose.Types.ObjectId;
  accountId: mongoose.Types.ObjectId;
  date: string;
  type: BankTransactionType;
  amount: number;
  source: string;
  destination: string;
  clientId?: mongoose.Types.ObjectId;
  customerId?: mongoose.Types.ObjectId;
  projectId?: mongoose.Types.ObjectId;
  customHeadId?: mongoose.Types.ObjectId;
  mode: BankTransactionMode;
  referenceId?: string;
  remarks?: string;
  createdAt: Date;
  updatedAt: Date;
}

const bankTransactionSchema = new mongoose.Schema<IBankTransaction>(
  {
    accountId: { type: mongoose.Schema.Types.ObjectId, ref: "BankAccount", required: true },
    date: { type: String, required: true },
    type: { type: String, required: true, enum: ["inflow", "outflow"] },
    amount: { type: Number, required: true, min: 0.01 },
    source: { type: String, required: true, trim: true },
    destination: { type: String, required: true, trim: true },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: "Client" },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer" },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project" },
    customHeadId: { type: mongoose.Schema.Types.ObjectId, ref: "CustomHead" },
    mode: { type: String, required: true, enum: ["Cash", "Bank", "Online"], default: "Bank" },
    referenceId: { type: String, trim: true },
    remarks: { type: String, trim: true },
  },
  { timestamps: true }
);

bankTransactionSchema.index({ accountId: 1, date: -1 });
bankTransactionSchema.index({ projectId: 1, date: -1 });
bankTransactionSchema.index({ clientId: 1, date: 1 });
bankTransactionSchema.index({ customerId: 1, date: 1 });
bankTransactionSchema.index({ date: 1 });

export const BankTransaction = mongoose.model<IBankTransaction>("BankTransaction", bankTransactionSchema);
