import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard, FolderKanban, Package, Wrench, Users, Building2,
  Receipt, Truck, HardHat, ClipboardList, BarChart3, Menu, X, ChevronDown, ChevronRight, UserCog, LogOut, Zap, Banknote, ContactRound, UserRound, HandCoins, FileBarChart
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { COMPANY_LOGO_URL, COMPANY_NAME, COMPANY_SHORT_NAME } from "@/lib/company";

interface NavItem {
  label: string;
  path: string;
  icon: React.ReactNode;
  children?: { label: string; path: string }[];
  /** Minimum role to see (Super Admin | Admin). Site Manager sees none of these. */
  minRole?: "Admin" | "Super Admin";
}

const companyNavItems: NavItem[] = [
  { label: "Dashboard", path: "/", icon: <LayoutDashboard className="h-4 w-4" /> },
  { label: "Bank & Accounts", path: "/bank-accounts", icon: <Building2 className="h-4 w-4" />, minRole: "Admin" },
  { label: "Clients", path: "/clients", icon: <ContactRound className="h-4 w-4" />, minRole: "Admin" },
  { label: "User Management", path: "/users", icon: <UserCog className="h-4 w-4" />, minRole: "Admin" },
  { label: "Audit Logs", path: "/audit-logs", icon: <ClipboardList className="h-4 w-4" />, minRole: "Super Admin" },
];

const projectNavItems: NavItem[] = [
  { label: "Projects", path: "/projects", icon: <FolderKanban className="h-4 w-4" /> },
  { label: "Cash & Expenses", path: "/cash-expenses", icon: <Banknote className="h-4 w-4" /> },
  { label: "Liabilities", path: "/liabilities", icon: <BarChart3 className="h-4 w-4" /> },
  { label: "Receivables", path: "/receivables", icon: <HandCoins className="h-4 w-4" /> },
  {
    label: "Inventory", path: "/inventory", icon: <Package className="h-4 w-4" />,
    children: [
      { label: "Consumable", path: "/inventory/consumable" },
      { label: "Non-Consumable", path: "/inventory/non-consumable" },
    ],
  },
  { label: "Vendors", path: "/vendors", icon: <Truck className="h-4 w-4" /> },
  { label: "Customers", path: "/customers", icon: <UserRound className="h-4 w-4" /> },
  { label: "Contractors", path: "/contractors", icon: <HardHat className="h-4 w-4" /> },
  { label: "Employees", path: "/employees", icon: <Users className="h-4 w-4" /> },
  { label: "Machinery Employees", path: "/machinery-employees", icon: <Users className="h-4 w-4" /> },
  { label: "Expenses", path: "/expenses", icon: <Receipt className="h-4 w-4" /> },
  { label: "Machinery", path: "/machinery", icon: <Wrench className="h-4 w-4" /> },
  { label: "Reports", path: "/reports", icon: <FileBarChart className="h-4 w-4" /> },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [expandedItems, setExpandedItems] = useState<string[]>(["Inventory"]);
  const location = useLocation();

  const toggleExpand = (label: string) => {
    setExpandedItems((prev) =>
      prev.includes(label) ? prev.filter((i) => i !== label) : [...prev, label]
    );
  };

  const isActive = (path: string) => location.pathname === path;
  const isChildActive = (item: NavItem) =>
    item.children?.some((c) => location.pathname === c.path);

  const canSeeItem = (item: NavItem) => {
    if (!item.minRole) return true;
    const role = user?.role ?? "";
    if (item.minRole === "Super Admin") return role === "Super Admin";
    if (item.minRole === "Admin") return role === "Admin" || role === "Super Admin";
    return true;
  };

  const isSiteManager = (user?.role ?? "") === "Site Manager";
  const filteredCompanyItems = companyNavItems.filter(canSeeItem);
  const filteredNavGroups = isSiteManager
    ? [
        { title: "Company", items: filteredCompanyItems },
        { title: "Project", items: projectNavItems },
      ]
    : [
        { title: "Company", items: filteredCompanyItems },
        { title: "Project", items: projectNavItems },
      ];

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-foreground/20 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-64 border-r border-border/50 bg-sidebar flex flex-col transition-transform lg:static lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="border-b border-border/50 px-6 py-5">
          <div className="flex items-start justify-between gap-2">
            <div className="flex flex-col gap-1 min-w-0 flex-1">
              <Link to="/" className="flex items-center gap-2.5">
                <img src={COMPANY_LOGO_URL} alt="PCF logo" className="h-10 w-8 shrink-0 object-contain" />
                <span className="text-lg font-semibold tracking-tight">{COMPANY_SHORT_NAME}</span>
              </Link>
              {isSiteManager && !!user?.assignedProjectNames?.length && (
                <p className="font-bold text-sm truncate text-foreground" title={user.assignedProjectNames.join(", ")}>
                  {user.assignedProjectNames.join(", ")}
                </p>
              )}
            </div>
            <Button variant="ghost" size="icon" className="lg:hidden shrink-0" onClick={() => setSidebarOpen(false)}>
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto p-3 space-y-4">
          {/* Quick Entry — always visible at top */}
          <Link
            to="/quick-entry"
            onClick={() => setSidebarOpen(false)}
            className={cn(
              "flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium transition-colors hover:bg-accent rounded-md",
              location.pathname === "/quick-entry" && "bg-primary text-primary-foreground font-bold"
            )}
          >
            <Zap className="h-4 w-4" />
            Quick Entry
          </Link>
          {filteredNavGroups.map((group) => (
            <div key={group.title} className="space-y-1">
              <p className="px-3 py-1.5 text-xs font-semibold text-muted-foreground/80 tracking-wide uppercase">
                {group.title}
              </p>
              {group.items.map((item) => (
                <div key={item.label}>
                  {item.children ? (
                    <>
                      <button
                        onClick={() => toggleExpand(item.label)}
                        className={cn(
                          "flex w-full items-center justify-between px-3 py-2.5 text-sm font-medium transition-colors hover:bg-accent",
                          isChildActive(item) && "bg-accent font-bold"
                        )}
                      >
                        <span className="flex items-center gap-2.5">
                          {item.icon}
                          {item.label}
                        </span>
                        {expandedItems.includes(item.label) ? (
                          <ChevronDown className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" />
                        )}
                      </button>
                      {expandedItems.includes(item.label) && (
                        <div className="ml-6 border-l border-border/50 space-y-0.5 pl-3">
                          {item.children.map((child) => (
                            <Link
                              key={child.path}
                              to={child.path}
                              onClick={() => setSidebarOpen(false)}
                              className={cn(
                                "block px-3 py-2 text-sm transition-colors hover:bg-accent",
                                isActive(child.path) && "bg-primary text-primary-foreground font-bold"
                              )}
                            >
                              {child.label}
                            </Link>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <Link
                      to={item.path}
                      onClick={() => setSidebarOpen(false)}
                      className={cn(
                        "flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium transition-colors hover:bg-accent",
                        isActive(item.path) && "bg-primary text-primary-foreground font-bold"
                      )}
                    >
                      {item.icon}
                      {item.label}
                    </Link>
                  )}
                </div>
              ))}
            </div>
          ))}
        </nav>

        <div className="border-t border-border/50 p-3 space-y-1">
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-warning/10 text-warning font-semibold text-xs border border-warning/20 shrink-0">
              {user?.name.slice(0, 2).toUpperCase() ?? "—"}
            </div>
            <div className="text-sm flex-1 min-w-0">
              <p className="font-bold truncate">{user?.name ?? "—"}</p>
              <p className="text-muted-foreground text-xs truncate">{user?.email ?? "—"}</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
            onClick={logout}
          >
            <LogOut className="h-4 w-4" />
            Log out
          </Button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center gap-3 border-b border-border/50 px-4 py-3 lg:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setSidebarOpen(true)}>
            <Menu className="h-5 w-5" />
          </Button>
          <h2 className="text-sm font-medium text-muted-foreground">
            {COMPANY_NAME}
          </h2>
        </header>
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
