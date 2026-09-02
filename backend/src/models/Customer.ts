import mongoose from "mongoose";

export interface ICustomer {
  _id: mongoose.Types.ObjectId;
  projectId: mongoose.Types.ObjectId;
  name: string;
  phone: string;
  description: string;
  /** Value of stock sold to this customer (debit side). */
  totalSold: number;
  /** Money received from this customer (credit side). */
  totalReceived: number;
  /** Signed: positive = customer has credit with us (prepaid); negative = customer owes us. */
  balance: number;
  createdAt: Date;
  updatedAt: Date;
}

const customerSchema = new mongoose.Schema<ICustomer>(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true },
    name: { type: String, required: true, trim: true },
    phone: { type: String, default: "", trim: true },
    description: { type: String, default: "", trim: true },
    totalSold: { type: Number, default: 0, min: 0 },
    totalReceived: { type: Number, default: 0, min: 0 },
    // Signed: balance = totalReceived - totalSold. No min — a receivable is negative.
    balance: { type: Number, default: 0 },
  },
  { timestamps: true }
);

customerSchema.index({ projectId: 1 });

export const Customer = mongoose.model<ICustomer>("Customer", customerSchema);
