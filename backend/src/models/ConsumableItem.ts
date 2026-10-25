import mongoose from "mongoose";

export interface IConsumableItem {
  _id: mongoose.Types.ObjectId;
  projectId: mongoose.Types.ObjectId;
  name: string;
  unit?: string;
  openingStock: number;
  currentStock: number;
  totalPurchased: number;
  totalAmount: number;
  totalPaid: number;
  totalPending: number;
  createdAt: Date;
  updatedAt: Date;
}

const consumableItemSchema = new mongoose.Schema<IConsumableItem>(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true },
    name: { type: String, required: true, trim: true },
    // Units are recorded per purchase/consumption movement, not per item.
    unit: { type: String, default: "", trim: true },
    openingStock: { type: Number, default: 0, min: 0 },
    currentStock: { type: Number, default: 0, min: 0 },
    totalPurchased: { type: Number, default: 0, min: 0 },
    totalAmount: { type: Number, default: 0, min: 0 },
    totalPaid: { type: Number, default: 0, min: 0 },
    totalPending: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

consumableItemSchema.index({ projectId: 1, name: 1 }, { unique: true });

export const ConsumableItem = mongoose.model<IConsumableItem>("ConsumableItem", consumableItemSchema);
