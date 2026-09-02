import mongoose from "mongoose";

export interface ICustomerSaleEntry {
  _id: mongoose.Types.ObjectId;
  projectId: mongoose.Types.ObjectId;
  itemId: mongoose.Types.ObjectId;
  customerId: mongoose.Types.ObjectId;
  /** Groups every line created by one "Sell Items" submission. Deleting a sale deletes the group. */
  saleId: mongoose.Types.ObjectId;
  date: string;
  quantity: number;
  unit?: string;
  unitPrice: number;
  totalPrice: number;
  remarks?: string;
  createdAt: Date;
  updatedAt: Date;
}

const customerSaleEntrySchema = new mongoose.Schema<ICustomerSaleEntry>(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true },
    itemId: { type: mongoose.Schema.Types.ObjectId, ref: "ConsumableItem", required: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", required: true },
    saleId: { type: mongoose.Schema.Types.ObjectId, required: true },
    date: { type: String, required: true },
    quantity: { type: Number, required: true, min: 0.01 },
    unit: { type: String, trim: true },
    unitPrice: { type: Number, required: true, min: 0 },
    totalPrice: { type: Number, required: true, min: 0 },
    remarks: { type: String, trim: true },
  },
  { timestamps: true }
);

customerSaleEntrySchema.index({ itemId: 1, date: -1 });
customerSaleEntrySchema.index({ customerId: 1, date: -1 });
customerSaleEntrySchema.index({ projectId: 1 });
customerSaleEntrySchema.index({ saleId: 1 });

export const CustomerSaleEntry = mongoose.model<ICustomerSaleEntry>(
  "CustomerSaleEntry",
  customerSaleEntrySchema
);
