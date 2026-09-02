import mongoose from "mongoose";

export type InventoryReturnType = "sale_return" | "purchase_return";

export interface IInventoryReturnLine {
  itemId: mongoose.Types.ObjectId;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
}

export interface IInventoryReturn {
  _id: mongoose.Types.ObjectId;
  projectId: mongoose.Types.ObjectId;
  type: InventoryReturnType;
  customerId?: mongoose.Types.ObjectId;
  vendorId?: mongoose.Types.ObjectId;
  date: string;
  items: IInventoryReturnLine[];
  totalAmount: number;
  accountId: mongoose.Types.ObjectId;
  bankTransactionId: mongoose.Types.ObjectId;
  paymentMethod: "Cash" | "Bank" | "Online";
  referenceId?: string;
  remarks?: string;
  createdAt: Date;
  updatedAt: Date;
}

const lineSchema = new mongoose.Schema<IInventoryReturnLine>(
  {
    itemId: { type: mongoose.Schema.Types.ObjectId, ref: "ConsumableItem", required: true },
    quantity: { type: Number, required: true, min: 0.01 },
    unit: { type: String, required: true, trim: true },
    unitPrice: { type: Number, required: true, min: 0 },
    totalPrice: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const inventoryReturnSchema = new mongoose.Schema<IInventoryReturn>(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true },
    type: { type: String, enum: ["sale_return", "purchase_return"], required: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer" },
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor" },
    date: { type: String, required: true },
    items: { type: [lineSchema], required: true },
    totalAmount: { type: Number, required: true, min: 0.01 },
    accountId: { type: mongoose.Schema.Types.ObjectId, ref: "BankAccount", required: true },
    bankTransactionId: { type: mongoose.Schema.Types.ObjectId, ref: "BankTransaction", required: true },
    paymentMethod: { type: String, enum: ["Cash", "Bank", "Online"], required: true },
    referenceId: { type: String, trim: true },
    remarks: { type: String, trim: true },
  },
  { timestamps: true }
);

inventoryReturnSchema.index({ projectId: 1, date: -1 });
inventoryReturnSchema.index({ customerId: 1, date: -1 });
inventoryReturnSchema.index({ vendorId: 1, date: -1 });
inventoryReturnSchema.index({ "items.itemId": 1, date: -1 });

export const InventoryReturn = mongoose.model<IInventoryReturn>("InventoryReturn", inventoryReturnSchema);
