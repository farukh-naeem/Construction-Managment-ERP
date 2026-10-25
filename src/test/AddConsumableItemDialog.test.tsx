import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AddConsumableItemDialog } from "@/components/dialogs/AddConsumableItemDialog";
import { createConsumableItem } from "@/services/consumableItemsService";
import { toast } from "sonner";

vi.mock("@/services/consumableItemsService", () => ({ createConsumableItem: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); vi.mocked(createConsumableItem).mockResolvedValue({} as never); });
function mount() {
  return render(<AddConsumableItemDialog open onOpenChange={() => {}} projectId="project" onSuccess={() => {}} />);
}
function submit() { fireEvent.submit(screen.getByRole("button", { name: "Add Item" }).closest("form")!); }

it("sends opening stock with the item and resets it after success", async () => {
  mount();
  fireEvent.change(screen.getByLabelText("Item Name *"), { target: { value: " Cement " } });
  fireEvent.change(screen.getByLabelText("Opening Stock"), { target: { value: "120.5" } });
  submit();
  await waitFor(() => expect(createConsumableItem).toHaveBeenCalledWith({ projectId: "project", name: "Cement", openingStock: 120.5 }));
  await waitFor(() => expect(screen.getByLabelText("Opening Stock")).toHaveValue(0));
});

it("defaults to zero and blocks negative opening stock", async () => {
  mount();
  expect(screen.getByLabelText("Opening Stock")).toHaveValue(0);
  fireEvent.change(screen.getByLabelText("Item Name *"), { target: { value: "Sand" } });
  fireEvent.change(screen.getByLabelText("Opening Stock"), { target: { value: "-1" } });
  submit();
  expect(createConsumableItem).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("non-negative"));
  fireEvent.change(screen.getByLabelText("Opening Stock"), { target: { value: "" } });
  submit();
  await waitFor(() => expect(createConsumableItem).toHaveBeenCalledWith({ projectId: "project", name: "Sand", openingStock: 0 }));
});

it("preserves opening stock when saving fails so the user can retry", async () => {
  vi.mocked(createConsumableItem).mockRejectedValueOnce(new Error("Save failed"));
  mount();
  fireEvent.change(screen.getByLabelText("Item Name *"), { target: { value: "Cement" } });
  fireEvent.change(screen.getByLabelText("Opening Stock"), { target: { value: "50" } });
  submit();
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Save failed"));
  expect(screen.getByLabelText("Opening Stock")).toHaveValue(50);
});
