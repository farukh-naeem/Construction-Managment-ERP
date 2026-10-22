import { Response } from "express";
import {
  listEmployees,
  getEmployeeById,
  createEmployee,
  updateEmployee,
  changeEmployeeSalary,
  deleteEmployee,
  type CreateEmployeeInput,
  type UpdateEmployeeInput,
} from "../services/employeeService.js";
import type { AuthRequest } from "../middleware/auth.js";

export async function list(req: AuthRequest, res: Response) {
  try {
    const actor = req.user!;
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
    const month = typeof req.query.month === "string" ? req.query.month : undefined;
    const category = req.query.category === "Machinery" ? "Machinery" : "Regular";
    const startDate = typeof req.query.startDate === "string" ? req.query.startDate : undefined;
    const endDate = typeof req.query.endDate === "string" ? req.query.endDate : undefined;
    const items = await listEmployees(
      { userId: actor.userId, role: actor.role },
      projectId,
      { ...(month ? { month } : {}), category, startDate, endDate }
    );
    res.json(items);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list employees";
    res.status(500).json({ error: message });
  }
}

export async function getOne(req: AuthRequest, res: Response) {
  try {
    const actor = req.user!;
    const { employeeId } = req.params;
    const employee = await getEmployeeById(employeeId, { userId: actor.userId, role: actor.role });
    if (!employee) {
      res.status(404).json({ error: "Employee not found" });
      return;
    }
    res.json(employee);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to get employee";
    res.status(500).json({ error: message });
  }
}

export async function create(req: AuthRequest, res: Response) {
  try {
    const actor = req.user!;
    const input = req.body as CreateEmployeeInput;
    const employee = await createEmployee(
      { userId: actor.userId, email: actor.email, role: actor.role },
      input
    );
    res.status(201).json(employee);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create employee";
    const status =
      message.includes("required") || message.includes("must be") ? 400 : 500;
    res.status(status).json({ error: message });
  }
}

export async function update(req: AuthRequest, res: Response) {
  try {
    const actor = req.user!;
    const { employeeId } = req.params;
    const input = req.body as UpdateEmployeeInput;
    const employee = await updateEmployee(
      { userId: actor.userId, email: actor.email, role: actor.role },
      employeeId,
      input
    );
    res.json(employee);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update employee";
    const status =
      message === "Employee not found" ? 404
        : message.includes("required") || message.includes("must be") || message.includes("Use Change Salary") ? 400
        : 500;
    res.status(status).json({ error: message });
  }
}

export async function changeSalary(req: AuthRequest, res: Response) {
  try {
    const actor = req.user!;
    const employee = await changeEmployeeSalary(
      { userId: actor.userId, email: actor.email, role: actor.role },
      req.params.employeeId,
      req.body as { monthlySalary: number; effectiveMonth: string }
    );
    res.json(employee);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to change salary";
    const status = message === "Employee not found" ? 404 : message.includes("required") || message.includes("must") || message.includes("cannot") || message.includes("only available") || message.includes("higher") ? 400 : 500;
    res.status(status).json({ error: message });
  }
}

export async function remove(req: AuthRequest, res: Response) {
  try {
    const actor = req.user!;
    const { employeeId } = req.params;
    await deleteEmployee(
      { userId: actor.userId, email: actor.email, role: actor.role },
      employeeId
    );
    res.status(204).send();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete employee";
    const status =
      message === "Employee not found" ? 404
        : message.includes("Cannot delete") ? 400
        : 500;
    res.status(status).json({ error: message });
  }
}
