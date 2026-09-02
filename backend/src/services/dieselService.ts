import { ConsumableItem, type IConsumableItem } from "../models/ConsumableItem.js";

export async function findDieselItem(projectId: string): Promise<IConsumableItem | null> {
  return ConsumableItem.findOne({
    projectId,
    name: { $regex: /^\s*diesel\s*$/i },
  }).lean();
}
