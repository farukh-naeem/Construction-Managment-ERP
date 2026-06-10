/**
 * Seeds only the three default ERP users (same emails, roles, password as seed.ts).
 * Does not wipe or modify other collections.
 *
 * Set MONGODB_URI in backend/.env (copy fresh string from Atlas → Connect → Drivers → Node).
 *
 * Run: cd backend && npm run seed:users
 */
import "dotenv/config";
import bcrypt from "bcrypt";
import mongoose from "mongoose";
import { User } from "./models/User.js";
import { Project } from "./models/Project.js";

const MONGODB_URI = process.env.MONGODB_URI?.trim();
const SEED_PASSWORD = "password123";

async function seedUsers(): Promise<void> {
  const hash = await bcrypt.hash(SEED_PASSWORD, 10);

  const firstProject = await Project.findOne().sort({ createdAt: 1 }).select("_id name").lean();
  const siteProjectId = firstProject?._id?.toString();
  const siteProjectName = firstProject?.name;

  const userSpecs = [
    {
      name: "Super Admin",
      email: "superadmin@erp.com",
      role: "super_admin" as const,
      assignedProjectId: undefined,
      assignedProjectName: undefined,
    },
    {
      name: "Company Admin",
      email: "admin@erp.com",
      role: "admin" as const,
      assignedProjectId: undefined,
      assignedProjectName: undefined,
    },
    {
      name: "Site Manager",
      email: "site.mgr@erp.com",
      role: "site_manager" as const,
      assignedProjectId: siteProjectId,
      assignedProjectName: siteProjectName,
    },
  ];

  await User.deleteMany({ email: { $nin: userSpecs.map((u) => u.email) } });

  for (const user of userSpecs) {
    await User.updateOne(
      { email: user.email },
      {
        $set: {
          name: user.name,
          role: user.role,
          passwordHash: hash,
          assignedProjectId: user.assignedProjectId,
          assignedProjectName: user.assignedProjectName,
        },
      },
      { upsert: true }
    );
  }

  console.log("Users seeded:");
  console.log({
    users: userSpecs.map((u) => ({ email: u.email, role: u.role })),
    password: SEED_PASSWORD,
    siteManagerProject: siteProjectName ?? "(none — create a project first, then re-run)",
  });
}

async function main(): Promise<void> {
  if (!MONGODB_URI) {
    console.error(
      "Missing MONGODB_URI. Add it to backend/.env — copy from Atlas → Connect → Construction-ERP → Drivers → Node."
    );
    process.exit(1);
  }

  try {
    await mongoose.connect(MONGODB_URI);
    await seedUsers();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("bad auth") || msg.includes("Authentication failed")) {
      console.error("MongoDB auth failed. The password in MONGODB_URI is wrong or expired.");
      console.error("Fix: Atlas → Database Access → farukhn00_db_user → Edit → Reset Password");
      console.error("Then: Atlas → Connect → copy the NEW connection string into backend/.env");
    } else {
      console.error(err);
    }
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

main();
