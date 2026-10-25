import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createConsumableItem } from "@/services/consumableItemsService";
import { toast } from "sonner";

interface AddConsumableItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string | null;
  onSuccess: () => void;
}

export function AddConsumableItemDialog({ open, onOpenChange, projectId, onSuccess }: AddConsumableItemDialogProps) {
  const [name, setName] = useState("");
  const [openingStock, setOpeningStock] = useState("0");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { toast.error("Item name is required"); return; }
    if (!projectId) { toast.error("No project selected"); return; }
    const quantity = Number(openingStock);
    if (!Number.isFinite(quantity) || quantity < 0 || !Number.isSafeInteger(Math.round(quantity * 100))) {
      toast.error("Opening stock must be a valid non-negative quantity");
      return;
    }
    setLoading(true);
    try {
      await createConsumableItem({ projectId, name: name.trim(), openingStock: quantity });
      toast.success("Item added");
      onSuccess();
      setName("");
      setOpeningStock("0");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add item");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Consumable Item</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="consumable-item-name">Item Name *</Label>
            <Input id="consumable-item-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Cement" className="mt-1" />
          </div>
          <div>
            <Label htmlFor="consumable-opening-stock">Opening Stock</Label>
            <Input id="consumable-opening-stock" type="number" min="0" step="0.01" value={openingStock} onChange={(e) => setOpeningStock(e.target.value)} className="mt-1" />
            <p className="mt-1 text-sm text-muted-foreground">Stock already available before you start recording purchases. Leave at 0 if none.</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" variant="warning" disabled={loading}>{loading ? "Adding…" : "Add Item"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
