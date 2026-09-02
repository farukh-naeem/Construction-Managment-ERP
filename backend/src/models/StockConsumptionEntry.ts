import mongoose from "mongoose";

export interface IConsumptionItem {
  itemId: mongoose.Types.ObjectId;
  quantityUsed: number;
  unit?: string;
}

export interface IStockConsumptionEntry {
  _id: mongoose.Types.ObjectId;
  projectId: mongoose.Types.ObjectId;
  machineId?: mongoose.Types.ObjectId;
  machineLedgerEntryId?: mongoose.Types.ObjectId;
  date: string;
  remarks?: string;
  items: IConsumptionItem[];
  createdAt: Date;
  updatedAt: Date;
}

const consumptionItemSchema = new mongoose.Schema<IConsumptionItem>(
  {
    itemId: { type: mongoose.Schema.Types.ObjectId, ref: "ConsumableItem", required: true },
    quantityUsed: { type: Number, required: true, min: 0.01 },
    unit: { type: String, trim: true },
  },
  { _id: false }
);

const stockConsumptionEntrySchema = new mongoose.Schema<IStockConsumptionEntry>(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true },
    machineId: { type: mongoose.Schema.Types.ObjectId, ref: "Machine", index: true },
    machineLedgerEntryId: { type: mongoose.Schema.Types.ObjectId, ref: "MachineLedgerEntry" },
    date: { type: String, required: true },
    remarks: { type: String, trim: true },
    items: { type: [consumptionItemSchema], required: true },
  },
  { timestamps: true }
);

stockConsumptionEntrySchema.index({ projectId: 1, date: -1 });
stockConsumptionEntrySchema.index({ machineLedgerEntryId: 1 }, { sparse: true });

export const StockConsumptionEntry = mongoose.model<IStockConsumptionEntry>(
  "StockConsumptionEntry",
  stockConsumptionEntrySchema
);
