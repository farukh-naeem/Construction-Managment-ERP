import { useMemo, useState, useEffect } from "react";
import Layout from "@/components/Layout";
import PageHeader from "@/components/PageHeader";
import StatusBadge from "@/components/StatusBadge";
import { formatCurrency } from "@/lib/mock-data";
import { formatDisplayDate } from "@/lib/pktDate";
import { useAuth } from "@/context/AuthContext";
import { useProjects } from "@/hooks/useProjects";
import { CreateProjectDialog } from "@/components/dialogs/CreateProjectDialog";
import { EditProjectDialog } from "@/components/dialogs/EditProjectDialog";
import { deleteProject, getProjectSummary } from "@/services/projectsService";
import type { ApiProject, ApiProjectSummary } from "@/services/projectsService";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Link } from "react-router-dom";
import { Plus, Calendar, Pencil, Trash2, Banknote, Wallet, AlertCircle } from "lucide-react";
import { toast } from "sonner";

interface ProjectCardProps {
  p: ApiProject;
  summary: ApiProjectSummary | null;
  valuesLoading: boolean;
  canEdit: boolean;
  canDelete: boolean;
  onEdit: (project: ApiProject) => void;
  onDelete: (project: ApiProject) => void;
}

function ProjectCard({ p, summary, valuesLoading, canEdit, canDelete, onEdit, onDelete }: ProjectCardProps) {
  const spent = summary?.spent ?? 0;
  const liabilities = summary?.liabilities ?? 0;
  const received = p.balance ?? 0;
  const clientPayment = p.clientPayment ?? 0;
  const budgetBalance = p.allocatedBudget - clientPayment;
  const projectBalance = received - spent;

  return (
    <Card className="flex flex-col border-2 border-border hover:border-primary/30 transition-colors">
      <Link to={`/projects/${p.id}/ledger`} className="block flex-1 min-h-0">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="font-mono text-xs text-muted-foreground truncate">{p.id}</p>
              <h3 className="font-bold text-lg break-words">{p.name}</h3>
            </div>
            <StatusBadge status={p.status} />
          </div>
          {p.description && (
            <p className="text-sm text-muted-foreground line-clamp-2">{p.description}</p>
          )}
        </CardHeader>
        <CardContent className="flex-1 space-y-3 pt-0">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground flex items-center gap-1.5">
                <Banknote className="h-3.5 w-3.5" />
                Allocated Budget
              </span>
              {valuesLoading ? (
                <Skeleton className="h-3.5 w-16 rounded" />
              ) : (
                <span className="font-mono text-xs font-medium">{formatCurrency(p.allocatedBudget)}</span>
              )}
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground flex items-center gap-1.5">
                <Banknote className="h-3.5 w-3.5" />
                Client Payment
              </span>
              {valuesLoading ? (
                <Skeleton className="h-3.5 w-16 rounded" />
              ) : (
                <span className="font-mono text-xs font-medium">{formatCurrency(clientPayment)}</span>
              )}
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground flex items-center gap-1.5">
                <Wallet className="h-3.5 w-3.5" />
                Budget Balance
              </span>
              {valuesLoading ? (
                <Skeleton className="h-3.5 w-16 rounded" />
              ) : (
                <span className={`font-mono text-xs font-medium ${budgetBalance < 0 ? "text-destructive" : ""}`}>{formatCurrency(budgetBalance)}</span>
              )}
            </div>
          </div>
          <div className="space-y-1.5 sm:border-l sm:border-border sm:pl-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground flex items-center gap-1.5">
                <Banknote className="h-3.5 w-3.5" />
                Received
              </span>
              {valuesLoading ? (
                <Skeleton className="h-3.5 w-16 rounded" />
              ) : (
                <span className="font-mono text-xs font-medium">{formatCurrency(received)}</span>
              )}
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground flex items-center gap-1.5">
                <Wallet className="h-3.5 w-3.5" />
                Spent
              </span>
              {valuesLoading ? (
                <Skeleton className="h-3.5 w-16 rounded" />
              ) : (
                <span className="font-mono text-xs">{formatCurrency(spent)}</span>
              )}
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground flex items-center gap-1.5">
                <Wallet className="h-3.5 w-3.5" />
                Project Balance
              </span>
              {valuesLoading ? (
                <Skeleton className="h-3.5 w-16 rounded" />
              ) : (
                <span className={`font-mono text-xs font-medium ${projectBalance < 0 ? "text-destructive" : ""}`}>{formatCurrency(projectBalance)}</span>
              )}
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground flex items-center gap-1.5">
                <AlertCircle className="h-3.5 w-3.5" />
                Liabilities
              </span>
              {valuesLoading ? (
                <Skeleton className="h-3.5 w-16 rounded" />
              ) : (
                <span className="font-mono text-xs text-destructive font-medium">{formatCurrency(liabilities)}</span>
              )}
            </div>
          </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Calendar className="h-3.5 w-3.5 shrink-0" />
            <span>{formatDisplayDate(p.startDate)} → {formatDisplayDate(p.endDate)}</span>
          </div>
        </CardContent>
      </Link>
      <CardFooter className="pt-0 border-t border-border mt-auto flex items-center justify-end gap-2">
        {canEdit || canDelete ? (
          <div className="flex items-center gap-1" onClick={(e) => e.preventDefault()}>
            {canEdit && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onEdit(p);
                }}
              >
                <Pencil className="h-4 w-4" />
              </Button>
            )}
            {canDelete && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onDelete(p);
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        ) : null}
      </CardFooter>
    </Card>
  );
}

export default function Projects() {
  const { user: currentUser } = useAuth();
  const { projects, loading, error, refetch } = useProjects();
  const [summaries, setSummaries] = useState<Record<string, ApiProjectSummary>>({});
  const [summariesLoading, setSummariesLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<ApiProject | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const actorRole = currentUser?.role ?? "";
  const isSiteManager = actorRole === "Site Manager";
  const canCreateProject = actorRole === "Admin" || actorRole === "Super Admin";
  const canManageProjects = actorRole === "Super Admin";

  // Site Manager sees only their assigned project(s) — already scoped server-side by listProjects
  const visibleProjects = projects;

  const visibleProjectIds = useMemo(
    () => visibleProjects.map((p) => p.id).sort().join(","),
    [visibleProjects]
  );

  // Fetch summaries for visible projects when list changes
  useEffect(() => {
    const ids = visibleProjectIds ? visibleProjectIds.split(",").filter(Boolean) : [];
    if (ids.length === 0) {
      setSummaries({});
      return;
    }
    let cancelled = false;
    setSummariesLoading(true);
    Promise.all(ids.map((id) => getProjectSummary(id)))
      .then((results) => {
        if (cancelled) return;
        const next: Record<string, ApiProjectSummary> = {};
        ids.forEach((id, i) => {
          next[id] = results[i];
        });
        setSummaries(next);
      })
      .catch(() => {
        if (!cancelled) setSummaries({});
      })
      .finally(() => {
        if (!cancelled) setSummariesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visibleProjectIds]);

  const openEdit = (project: ApiProject) => {
    setSelectedProject(project);
    setEditOpen(true);
  };

  const openDelete = (project: ApiProject) => {
    setSelectedProject(project);
    setDeleteOpen(true);
  };

  const handleEditOpenChange = (open: boolean) => {
    setEditOpen(open);
    if (!open) setSelectedProject(null);
  };

  const handleDeleteOpenChange = (open: boolean) => {
    setDeleteOpen(open);
    if (!open) setSelectedProject(null);
  };

  const handleDeleteConfirm = async () => {
    if (!selectedProject) return;
    setDeleteLoading(true);
    try {
      await deleteProject(selectedProject.id);
      toast.success("Project deleted");
      setDeleteOpen(false);
      setSelectedProject(null);
      refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete project");
    } finally {
      setDeleteLoading(false);
    }
  };

  return (
    <Layout>
      <PageHeader
        title="Projects"
        subtitle={isSiteManager ? "Your assigned projects" : "Manage all construction projects"}
        printTargetId="projects-cards"
        actions={
          canCreateProject ? (
            <Button variant="warning" size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />
              New Project
            </Button>
          ) : undefined
        }
      />
      <CreateProjectDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={refetch}
      />
      <EditProjectDialog
        open={editOpen}
        onOpenChange={handleEditOpenChange}
        project={selectedProject}
        onSave={refetch}
      />
      {loading ? (
        <p className="text-muted-foreground py-8 text-center">Loading projects…</p>
      ) : error ? (
        <p className="text-destructive py-8 text-center">{error}</p>
      ) : isSiteManager && visibleProjects.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center">
          You are not assigned to any project. Contact your administrator.
        </p>
      ) : (
        <div id="projects-cards" className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {visibleProjects.map((p) => (
            <ProjectCard
              key={p.id}
              p={p}
              summary={summaries[p.id] ?? null}
              valuesLoading={summariesLoading}
              canEdit={canCreateProject}
              canDelete={canManageProjects}
              onEdit={openEdit}
              onDelete={openDelete}
            />
          ))}
        </div>
      )}

      <AlertDialog open={deleteOpen} onOpenChange={handleDeleteOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {selectedProject?.name}? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={deleteLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:pointer-events-none disabled:opacity-50"
            >
              {deleteLoading ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}
