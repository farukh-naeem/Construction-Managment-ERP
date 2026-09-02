import { api } from "./api";

export interface ApiDailyProgressReport {
  projectId: string; projectName: string; date: string; monthStart: string;
  machinery: {
    rows: Array<{ machineId: string; name: string; currentDiesel: number; previousDiesel: number; totalDiesel: number;
      currentHour: number; previousHour: number; totalHour: number; avg: number }>;
    dieselTank: null | { received: number; previousReceived: number; totalReceived: number; issue: number; pIssue: number; totalIssue: number; balance: number };
  };
  material: { rows: Array<{ itemId: string; name: string; current: number; previous: number; total: number }> };
}

export function getDailyProgressReport(projectId: string, date: string) {
  return api<ApiDailyProgressReport>(`/api/reports/daily-progress?${new URLSearchParams({ projectId, date })}`);
}
