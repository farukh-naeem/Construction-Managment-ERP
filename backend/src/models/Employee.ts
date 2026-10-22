import mongoose from "mongoose";

export type EmployeeType = "Fixed" | "Daily";
export type EmployeeCategory = "Regular" | "Machinery";

export interface IEmployee {
  _id: mongoose.Types.ObjectId;
  projectId: mongoose.Types.ObjectId;
  name: string;
  role: string;
  type: EmployeeType;
  monthlySalary?: number;
  salaryRevisions?: { effectiveMonth: string; monthlySalary: number; previousSalary?: number; changedAt: Date; isInitial?: boolean }[];
  dailyRate?: number;
  phone: string;
  category: EmployeeCategory;
  /** Machinery employees have exactly one assigned Company Owned machine. */
  machineId?: mongoose.Types.ObjectId;
  /** Optional user-specified "YYYY-MM-DD" date the employee actually joined/started.
   *  When set, this (not createdAt) is used as the cutoff for which months have payable salary/attendance data. */
  joiningDate?: string;
  /** Optional user-specified "YYYY-MM-DD" date the employee actually left/stopped.
   *  When set, no payable salary/wage accrues for months after it, and the ending month itself is
   *  prorated up to this day. Used to mark an employee as no longer with the company. */
  endingDate?: string;
  createdAt: Date;
  updatedAt: Date;
}

const employeeSchema = new mongoose.Schema<IEmployee>(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true },
    name: { type: String, required: true, trim: true },
    role: { type: String, required: true, trim: true },
    type: { type: String, required: true, enum: ["Fixed", "Daily"] },
    monthlySalary: { type: Number, min: 0 },
    salaryRevisions: [{
      effectiveMonth: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
      monthlySalary: { type: Number, required: true, min: 0 },
      previousSalary: { type: Number, min: 0 },
      changedAt: { type: Date, default: Date.now },
      isInitial: { type: Boolean, default: false },
    }],
    dailyRate: { type: Number, min: 0 },
    phone: { type: String, default: "", trim: true },
    category: { type: String, enum: ["Regular", "Machinery"], default: "Regular", required: true },
    machineId: { type: mongoose.Schema.Types.ObjectId, ref: "Machine" },
    joiningDate: { type: String, trim: true },
    endingDate: { type: String, trim: true },
  },
  { timestamps: true }
);

employeeSchema.index({ projectId: 1 });
employeeSchema.index({ projectId: 1, type: 1 });
employeeSchema.index({ projectId: 1, category: 1 });

export const Employee = mongoose.model<IEmployee>("Employee", employeeSchema);
