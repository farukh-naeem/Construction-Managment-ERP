import { describe, expect, it } from "vitest";
import { formatDisplayDate, formatDisplayDateRange, formatDisplayDateTime } from "@/lib/pktDate";

describe("display date formatting", () => {
  it("formats stored full dates as day/month/year without timezone parsing", () => {
    expect(formatDisplayDate("2026-09-03")).toBe("03/09/2026");
    expect(formatDisplayDate("2026-09-03T23:30:00.000Z")).toBe("03/09/2026");
  });

  it("retains time text for audit timestamps", () => {
    expect(formatDisplayDateTime("2026-09-03 14:05:09")).toBe("03/09/2026 14:05:09");
  });

  it("formats date ranges and empty values", () => {
    expect(formatDisplayDateRange("2026-09-01", "2026-09-03")).toBe("01/09/2026 to 03/09/2026");
    expect(formatDisplayDate("", "-")).toBe("-");
  });
});
