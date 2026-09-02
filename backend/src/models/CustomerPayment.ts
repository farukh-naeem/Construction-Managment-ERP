import mongoose from "mongoose";

export interface ICustomerPayment {
  _id: mongoose.Types.ObjectId;
  customerId: mongoose.Types.ObjectId;
  date: string;
  amount: number;
  paymentMethod: "Cash" | "Bank" | "Online";
  /** Required for every mode: money coming in must land in a tracked account. */
  accountId: mongoose.Types.ObjectId;
  /** The inflow this payment created. Deleting the payment reverses and removes it. */
  bankTransactionId: mongoose.Types.ObjectId;
  /** Set when the payment arrived alongside a "Sell Items" submission. */
  saleId?: mongoose.Types.ObjectId;
  referenceId?: string;
  remarks?: string;
  createdAt: Date;
  updatedAt: Date;
}

const customerPaymentSchema = new mongoose.Schema<ICustomerPayment>(
  {
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", required: true },
    date: { type: String, required: true },
    amount: { type: Number, required: true, min: 0.01 },
    paymentMethod: { type: String, enum: ["Cash", "Bank", "Online"], required: true },
    accountId: { type: mongoose.Schema.Types.ObjectId, ref: "BankAccount", required: true },
    bankTransactionId: { type: mongoose.Schema.Types.ObjectId, ref: "BankTransaction", required: true },
    saleId: { type: mongoose.Schema.Types.ObjectId },
    referenceId: { type: String, trim: true },
    remarks: { type: String, trim: true },
  },
  { timestamps: true }
);

customerPaymentSchema.index({ customerId: 1, date: -1 });
customerPaymentSchema.index({ bankTransactionId: 1 });

export const CustomerPayment = mongoose.model<ICustomerPayment>("CustomerPayment", customerPaymentSchema);
