import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRequireAdmin } from "@/hooks/useAuth";
import { AuthGateSplash } from "@/components/AuthGateSplash";
import {
  fetchAdminMasterAccess,
  reviewMasterAccess,
  deleteAdminMasterAccessRequest,
  fetchAdminStrategies,
  toggleAdminStrategy,
  deleteAdminStrategy,
  fetchAdminUsers,
  fetchAdminUserDetail,
  fetchAdminAudit,
  reviewAdminStrategy,
  type AdminMasterAccessRow,
  type AdminStrategyRow,
  type AdminUserRow,
  type StrategyReviewStatus,
} from "@/lib/api";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { CheckCircle2, Loader2, Trash2, XCircle } from "lucide-react";

/**
 * Format a raw numeric-string notional (e.g. "12345.6789") as a compact
 * admin-readable USDT amount. Falls back to "—" for null / non-numeric input.
 */
function formatUsdt(raw: string | null | undefined): string {
  if (!raw) return "—";
  const n = Number(raw);
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "0 USDT";
  if (n >= 1000) return `${n.toLocaleString(undefined, { maximumFractionDigits: 0 })} USDT`;
  if (n >= 1) return `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDT`;
  return `${n.toFixed(4)} USDT`;
}

function strategyStatusBadgeVariant(
  status: StrategyReviewStatus
): "default" | "destructive" | "secondary" {
  if (status === "approved") return "default";
  if (status === "rejected") return "destructive";
  return "secondary";
}

export default function AdminDashboardPage() {
  const authQ = useRequireAdmin();
  const navigate = useNavigate();

  if (!authQ.authResolved) return <AuthGateSplash />;
  if (!authQ.data?.user || !authQ.isAdmin) return null;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container mx-auto px-4 main-nav-pad pb-16">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Admin</h1>
            <p className="text-sm text-muted-foreground">
              Signed in as {authQ.data.user.email}
            </p>
          </div>
          <Button variant="outline" onClick={() => navigate("/dashboard")}>
            Back to dashboard
          </Button>
        </div>

        <Tabs defaultValue="master-access" className="space-y-6">
          <TabsList>
            <TabsTrigger value="master-access">Master access</TabsTrigger>
            <TabsTrigger value="strategies">Strategies</TabsTrigger>
            <TabsTrigger value="users">Users</TabsTrigger>
            <TabsTrigger value="audit">Audit</TabsTrigger>
          </TabsList>

          <TabsContent value="master-access">
            <MasterAccessTab />
          </TabsContent>
          <TabsContent value="strategies">
            <StrategiesTab />
          </TabsContent>
          <TabsContent value="users">
            <UsersTab />
          </TabsContent>
          <TabsContent value="audit">
            <AuditTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function AuditTab() {
  const q = useQuery({
    queryKey: ["admin", "audit"],
    queryFn: fetchAdminAudit,
    staleTime: 15_000,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Admin audit log</CardTitle>
        <CardDescription>
          Last 100 admin mutations, newest first. Use this for operator review
          and incident reconstruction.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {q.isLoading && <EmptyNote>Loading audit entries...</EmptyNote>}
        {q.isError && (
          <EmptyNote>
            {q.error instanceof Error ? q.error.message : "Failed to load audit log"}
          </EmptyNote>
        )}
        {q.data?.entries.length === 0 && <EmptyNote>No audit entries yet.</EmptyNote>}
        {q.data && q.data.entries.length > 0 && (
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Actor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {q.data.entries.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {new Date(e.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{e.action}</TableCell>
                    <TableCell className="text-xs">
                      {e.targetType ?? "—"}
                      {e.targetId ? `:${e.targetId}` : ""}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{e.actorUserId}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function masterAccessDeleteConfirmTarget(r: {
  userEmail: string | null;
  userDisplayName: string | null;
  userId: string;
}): string {
  return (r.userEmail ?? r.userDisplayName ?? r.userId).trim();
}

function MasterAccessTab() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<
    "pending" | "approved" | "rejected" | "all"
  >("pending");
  const [masterToDelete, setMasterToDelete] = useState<AdminMasterAccessRow | null>(
    null
  );
  const [masterDeleteConfirm, setMasterDeleteConfirm] = useState("");

  const q = useQuery({
    queryKey: ["admin", "master-access", filter],
    queryFn: () => fetchAdminMasterAccess(filter),
    staleTime: 10_000,
  });

  const reviewMut = useMutation({
    mutationFn: (args: { id: string; action: "approve" | "reject" }) =>
      reviewMasterAccess(args.id, args.action),
    onSuccess: async (_res, vars) => {
      toast.success(
        vars.action === "approve" ? "Request approved" : "Request rejected"
      );
      await qc.invalidateQueries({ queryKey: ["admin", "master-access"] });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Action failed"),
  });

  const masterDeleteMut = useMutation({
    mutationFn: (id: string) => deleteAdminMasterAccessRequest(id),
    onSuccess: async () => {
      toast.success("Master access record removed");
      setMasterToDelete(null);
      setMasterDeleteConfirm("");
      await qc.invalidateQueries({ queryKey: ["admin", "master-access"] });
      await qc.invalidateQueries({ queryKey: ["admin", "users"] });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Delete failed"),
  });

  const canConfirmMasterDelete = useMemo(() => {
    if (!masterToDelete) return false;
    const want = masterAccessDeleteConfirmTarget(masterToDelete).toLowerCase();
    return masterDeleteConfirm.trim().toLowerCase() === want;
  }, [masterToDelete, masterDeleteConfirm]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Master studio requests</CardTitle>
          <CardDescription>
            Approve or reject user requests to access the Master Studio.
          </CardDescription>
        </div>
        <div className="w-[180px]">
          <Select
            value={filter}
            onValueChange={(v) =>
              setFilter(v as "pending" | "approved" | "rejected" | "all")
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Note</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Strategies</TableHead>
              <TableHead>Requested</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {q.data?.requests.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="text-center text-sm text-muted-foreground"
                >
                  No requests.
                </TableCell>
              </TableRow>
            )}
            {q.data?.requests.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <div className="font-medium">
                    {r.userEmail ?? r.userDisplayName ?? r.userId}
                  </div>
                  {r.userEmail && r.userDisplayName && (
                    <div className="text-xs text-muted-foreground">
                      {r.userDisplayName}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-xs font-mono whitespace-nowrap">
                  {r.contactPhone?.trim() ? (
                    r.contactPhone
                  ) : (
                    <span className="text-muted-foreground font-sans">—</span>
                  )}
                </TableCell>
                <TableCell className="max-w-sm whitespace-pre-wrap text-xs">
                  {r.note ?? (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      r.status === "approved"
                        ? "default"
                        : r.status === "rejected"
                        ? "destructive"
                        : "secondary"
                    }
                  >
                    {r.status}
                  </Badge>
                </TableCell>
                <TableCell>{r.userStrategyCount}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {new Date(r.createdAt).toLocaleString()}
                </TableCell>
                <TableCell className="text-right">
                  {r.status === "pending" ? (
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={reviewMut.isPending}
                        onClick={() =>
                          reviewMut.mutate({ id: r.id, action: "reject" })
                        }
                      >
                        <XCircle className="mr-1 h-3.5 w-3.5" /> Reject
                      </Button>
                      <Button
                        size="sm"
                        disabled={reviewMut.isPending}
                        onClick={() =>
                          reviewMut.mutate({ id: r.id, action: "approve" })
                        }
                      >
                        <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-muted-foreground"
                        disabled={masterDeleteMut.isPending}
                        onClick={() => {
                          setMasterToDelete(r);
                          setMasterDeleteConfirm("");
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                  ) : (
                    <div className="flex flex-col items-end gap-2">
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={masterDeleteMut.isPending}
                        onClick={() => {
                          setMasterToDelete(r);
                          setMasterDeleteConfirm("");
                        }}
                      >
                        <Trash2 className="mr-1 h-3.5 w-3.5" />
                        {r.status === "approved" ? "Revoke access" : "Delete"}
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        {r.reviewedBy
                          ? `by ${r.reviewedBy}`
                          : r.reviewedAt
                          ? new Date(r.reviewedAt).toLocaleString()
                          : "—"}
                      </span>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog
        open={Boolean(masterToDelete)}
        onOpenChange={(o) => {
          if (!o) {
            setMasterToDelete(null);
            setMasterDeleteConfirm("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {masterToDelete?.status === "approved"
                ? "Revoke master studio access?"
                : "Remove master access request?"}
            </DialogTitle>
            <DialogDescription>
              {masterToDelete?.status === "approved" ? (
                <>
                  This removes the user&apos;s approval row. They immediately lose
                  access to Master Studio until a new request is approved.
                </>
              ) : masterToDelete?.status === "pending" ? (
                <>
                  This deletes the pending request. The user can submit a new
                  request later.
                </>
              ) : (
                <>This permanently deletes the rejected request record.</>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="master-delete-confirm">
              Type{" "}
              <span className="font-medium text-foreground">
                {masterToDelete
                  ? masterAccessDeleteConfirmTarget(masterToDelete)
                  : ""}
              </span>{" "}
              to confirm
            </Label>
            <Input
              id="master-delete-confirm"
              value={masterDeleteConfirm}
              onChange={(e) => setMasterDeleteConfirm(e.target.value)}
              placeholder={
                masterToDelete
                  ? masterAccessDeleteConfirmTarget(masterToDelete)
                  : ""
              }
              autoComplete="off"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setMasterToDelete(null);
                setMasterDeleteConfirm("");
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!canConfirmMasterDelete || masterDeleteMut.isPending}
              onClick={() =>
                masterToDelete && masterDeleteMut.mutate(masterToDelete.id)
              }
            >
              {masterDeleteMut.isPending && (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />
              )}
              {masterToDelete?.status === "approved"
                ? "Revoke"
                : masterToDelete?.status === "pending"
                ? "Remove request"
                : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function StrategiesTab() {
  const qc = useQueryClient();
  const [typeFilter, setTypeFilter] = useState<"all" | "algo" | "copy_trading">(
    "all"
  );
  const [statusFilter, setStatusFilter] = useState<
    "all" | StrategyReviewStatus
  >("pending");
  const [toDelete, setToDelete] = useState<AdminStrategyRow | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [toReject, setToReject] = useState<AdminStrategyRow | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const q = useQuery({
    queryKey: ["admin", "strategies", typeFilter, statusFilter],
    queryFn: () => fetchAdminStrategies(typeFilter, statusFilter),
    staleTime: 10_000,
  });

  const toggleMut = useMutation({
    mutationFn: (args: { id: string; active: boolean }) =>
      toggleAdminStrategy(args.id, args.active),
    onSuccess: async () => {
      toast.success("Updated");
      await qc.invalidateQueries({ queryKey: ["admin", "strategies"] });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Update failed"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteAdminStrategy(id),
    onSuccess: async (res) => {
      toast.success(`Deleted "${res.deleted.name}"`);
      setToDelete(null);
      setConfirmText("");
      await qc.invalidateQueries({ queryKey: ["admin", "strategies"] });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Delete failed"),
  });

  const reviewMut = useMutation({
    mutationFn: (args: {
      id: string;
      action: "approve" | "reject";
      reason?: string;
    }) => reviewAdminStrategy(args.id, args.action, args.reason),
    onSuccess: async (res) => {
      toast.success(
        res.status === "approved" ? "Strategy approved" : "Strategy rejected"
      );
      setToReject(null);
      setRejectReason("");
      await qc.invalidateQueries({ queryKey: ["admin", "strategies"] });
      await qc.invalidateQueries({ queryKey: ["admin", "users"] });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Review failed"),
  });

  const canConfirmDelete = useMemo(
    () =>
      Boolean(toDelete) && confirmText.trim() === (toDelete?.name ?? "").trim(),
    [toDelete, confirmText]
  );

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Strategies</CardTitle>
            <CardDescription>
              Manage all strategies across the platform. Deletes cascade to
              subscriptions, webhooks, and signal history.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="w-[160px]">
              <Select
                value={statusFilter}
                onValueChange={(v) =>
                  setStatusFilter(v as "all" | StrategyReviewStatus)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="w-[180px]">
              <Select
                value={typeFilter}
                onValueChange={(v) =>
                  setTypeFilter(v as "all" | "algo" | "copy_trading")
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  <SelectItem value="algo">Algo</SelectItem>
                  <SelectItem value="copy_trading">Copy trading</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Symbol</TableHead>
                <TableHead>Creator</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Subs</TableHead>
                <TableHead>Webhook</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.data?.strategies.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={9}
                    className="text-center text-sm text-muted-foreground"
                  >
                    No strategies.
                  </TableCell>
                </TableRow>
              )}
              {q.data?.strategies.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <div className="font-medium">{s.name}</div>
                    <div className="text-xs text-muted-foreground">{s.id}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{s.type}</Badge>
                  </TableCell>
                  <TableCell>{s.symbol}</TableCell>
                  <TableCell>
                    <div className="text-xs">{s.creatorName}</div>
                    {s.creatorEmail && (
                      <div className="text-[11px] text-muted-foreground">
                        {s.creatorEmail}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <Badge variant={strategyStatusBadgeVariant(s.status)}>
                        {s.status}
                      </Badge>
                      {s.status === "rejected" && s.rejectionReason?.trim() && (
                        <div
                          className="text-[11px] text-muted-foreground max-w-[220px] truncate"
                          title={s.rejectionReason}
                        >
                          {s.rejectionReason}
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{s.subscriberCount}</TableCell>
                  <TableCell>
                    <Badge variant={s.webhookEnabled ? "default" : "outline"}>
                      {s.webhookEnabled ? "On" : "Off"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={s.isActive ? "default" : "outline"}>
                      {s.isActive ? "Active" : "Paused"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex flex-wrap justify-end gap-2">
                      {s.status === "pending" && (
                        <>
                          <Button
                            size="sm"
                            variant="default"
                            disabled={reviewMut.isPending}
                            onClick={() =>
                              reviewMut.mutate({ id: s.id, action: "approve" })
                            }
                          >
                            <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setToReject(s);
                              setRejectReason("");
                            }}
                          >
                            <XCircle className="h-3.5 w-3.5 mr-1" />
                            Reject
                          </Button>
                        </>
                      )}
                      {s.status === "approved" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={toggleMut.isPending}
                          onClick={() =>
                            toggleMut.mutate({
                              id: s.id,
                              active: !s.isActive,
                            })
                          }
                        >
                          {s.isActive ? "Pause" : "Resume"}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => {
                          setToDelete(s);
                          setConfirmText("");
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog
        open={Boolean(toReject)}
        onOpenChange={(o) => {
          if (!o) {
            setToReject(null);
            setRejectReason("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject strategy?</DialogTitle>
            <DialogDescription>
              Rejecting{" "}
              <span className="font-medium text-foreground">
                {toReject?.name}
              </span>{" "}
              will disable its webhook and notify the creator. They can edit and
              reapply from their studio.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reject-reason">Reason (shown to creator)</Label>
            <Textarea
              id="reject-reason"
              rows={4}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Explain what needs to change before this strategy can be approved."
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setToReject(null);
                setRejectReason("");
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={reviewMut.isPending}
              onClick={() =>
                toReject &&
                reviewMut.mutate({
                  id: toReject.id,
                  action: "reject",
                  reason: rejectReason.trim() || undefined,
                })
              }
            >
              {reviewMut.isPending && (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />
              )}
              Reject strategy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(toDelete)}
        onOpenChange={(o) => {
          if (!o) {
            setToDelete(null);
            setConfirmText("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete strategy?</DialogTitle>
            <DialogDescription>
              This will permanently delete{" "}
              <span className="font-medium text-foreground">
                {toDelete?.name}
              </span>{" "}
              and cascade-remove subscriptions, webhook config, signal history,
              and mirror attempts. This cannot be undone.
              {toDelete?.status === "approved" && (
                <span className="block mt-2 text-warning">
                  This strategy is approved and may have live subscribers — they will
                  lose access immediately.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="confirm-delete">
              Type the strategy name to confirm
            </Label>
            <Input
              id="confirm-delete"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={toDelete?.name ?? ""}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setToDelete(null);
                setConfirmText("");
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!canConfirmDelete || deleteMut.isPending}
              onClick={() => toDelete && deleteMut.mutate(toDelete.id)}
            >
              {deleteMut.isPending && (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />
              )}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function UsersTab() {
  const q = useQuery({
    queryKey: ["admin", "users"],
    queryFn: fetchAdminUsers,
    staleTime: 10_000,
  });
  const [drawerUserId, setDrawerUserId] = useState<string | null>(null);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Users</CardTitle>
          <CardDescription>
            Read-only directory. Click a row to drill into strategies, subscriptions,
            TradingView webhooks, and RexAlgo-routed trading volume.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email / name</TableHead>
                <TableHead>Master</TableHead>
                <TableHead>Telegram</TableHead>
                <TableHead className="text-right">Volume (USDT)</TableHead>
                <TableHead className="text-right">Strategies</TableHead>
                <TableHead className="text-right">Subs</TableHead>
                <TableHead className="text-right">TradingView</TableHead>
                <TableHead>Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.data?.users.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="text-center text-sm text-muted-foreground"
                  >
                    No users.
                  </TableCell>
                </TableRow>
              )}
              {q.data?.users.map((u) => (
                <UserRow
                  key={u.id}
                  user={u}
                  onOpen={() => setDrawerUserId(u.id)}
                />
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <UserDetailDrawer
        userId={drawerUserId}
        onClose={() => setDrawerUserId(null)}
      />
    </>
  );
}

function UserRow({ user, onOpen }: { user: AdminUserRow; onOpen: () => void }) {
  return (
    <TableRow
      className="cursor-pointer hover:bg-secondary/40"
      onClick={onOpen}
    >
      <TableCell>
        <div className="font-medium">
          {user.email ?? <span className="text-muted-foreground">—</span>}
        </div>
        <div className="text-xs text-muted-foreground">
          {user.displayName}
          <span className="mx-1">·</span>
          <span className="text-[11px]">{user.authProvider}</span>
        </div>
      </TableCell>
      <TableCell>
        {user.masterStatus ? (
          <Badge
            variant={
              user.masterStatus === "approved"
                ? "default"
                : user.masterStatus === "rejected"
                ? "destructive"
                : "secondary"
            }
          >
            {user.masterStatus}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">none</span>
        )}
      </TableCell>
      <TableCell>
        {user.telegramLinked ? (
          <Badge variant="default">
            {user.telegramUsername ? `@${user.telegramUsername}` : "linked"}
          </Badge>
        ) : (
          <Badge variant="outline">off</Badge>
        )}
      </TableCell>
      <TableCell className="text-right font-mono text-xs">
        {formatUsdt(user.totalVolumeUsdt)}
      </TableCell>
      <TableCell className="text-right text-xs">
        <span className="font-medium">{user.approvedStrategyCount}</span>
        <span className="text-muted-foreground"> / {user.strategyCount}</span>
      </TableCell>
      <TableCell className="text-right">{user.subscriptionCount}</TableCell>
      <TableCell className="text-right">{user.tvWebhookCount}</TableCell>
      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
        {new Date(user.createdAt).toLocaleDateString()}
      </TableCell>
    </TableRow>
  );
}

function UserDetailDrawer({
  userId,
  onClose,
}: {
  userId: string | null;
  onClose: () => void;
}) {
  const q = useQuery({
    queryKey: ["admin", "users", userId],
    queryFn: () => fetchAdminUserDetail(userId as string),
    enabled: Boolean(userId),
    staleTime: 10_000,
  });

  return (
    <Sheet
      open={Boolean(userId)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        {!userId ? null : q.isLoading || !q.data ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-6">
            <SheetHeader className="text-left">
              <SheetTitle>
                {q.data.user.email ?? q.data.user.displayName}
              </SheetTitle>
              <SheetDescription>
                {q.data.user.displayName} · {q.data.user.authProvider} · Joined{" "}
                {new Date(q.data.user.createdAt).toLocaleDateString()}
              </SheetDescription>
            </SheetHeader>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <InfoStat
                label="Telegram"
                value={
                  q.data.user.telegramLinked
                    ? q.data.user.telegramUsername
                      ? `@${q.data.user.telegramUsername}`
                      : "Linked"
                    : "Not linked"
                }
              />
              <InfoStat
                label="Mudrex API"
                value={q.data.user.hasMudrexKey ? "Connected" : "Missing"}
              />
              <InfoStat
                label="Total volume"
                value={formatUsdt(q.data.volume.totalUsdt)}
              />
              <InfoStat
                label="Trades logged"
                value={String(
                  q.data.volume.countsBySource.manual +
                    q.data.volume.countsBySource.copy +
                    q.data.volume.countsBySource.tv
                )}
              />
            </div>

            <section>
              <h3 className="text-sm font-semibold mb-2">Volume by source</h3>
              <div className="grid grid-cols-3 gap-2 text-xs">
                {(["manual", "copy", "tv"] as const).map((src) => (
                  <div
                    key={src}
                    className="rounded-lg border border-border p-3"
                  >
                    <div className="uppercase tracking-wide text-[10px] text-muted-foreground">
                      {src}
                    </div>
                    <div className="font-medium font-mono text-xs mt-1">
                      {formatUsdt(q.data!.volume.bySource[src])}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {q.data!.volume.countsBySource[src]} trades
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <DrawerSection title={`Strategies (${q.data.strategies.length})`}>
              {q.data.strategies.length === 0 ? (
                <EmptyNote>No strategies created.</EmptyNote>
              ) : (
                <ul className="space-y-2">
                  {q.data.strategies.map((s) => (
                    <li
                      key={s.id}
                      className="rounded-lg border border-border p-3 text-sm"
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{s.name}</span>
                        <Badge variant="outline" className="text-[10px]">
                          {s.type}
                        </Badge>
                        <Badge
                          variant={strategyStatusBadgeVariant(s.status)}
                          className="text-[10px]"
                        >
                          {s.status}
                        </Badge>
                        {!s.isActive && (
                          <Badge variant="outline" className="text-[10px]">
                            paused
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {s.symbol} · {s.subscriberCount} subscribers ·{" "}
                        {new Date(s.createdAt).toLocaleDateString()}
                      </div>
                      {s.rejectionReason && (
                        <p className="text-xs text-loss mt-1">
                          Rejected: {s.rejectionReason}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </DrawerSection>

            <DrawerSection
              title={`Subscriptions (${q.data.subscriptions.length})`}
            >
              {q.data.subscriptions.length === 0 ? (
                <EmptyNote>No subscriptions.</EmptyNote>
              ) : (
                <ul className="space-y-2">
                  {q.data.subscriptions.map((s) => (
                    <li
                      key={s.id}
                      className="rounded-lg border border-border p-3 text-sm"
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">
                          {s.strategyName ?? s.strategyId}
                        </span>
                        {s.strategyType && (
                          <Badge variant="outline" className="text-[10px]">
                            {s.strategyType}
                          </Badge>
                        )}
                        {!s.isActive && (
                          <Badge variant="outline" className="text-[10px]">
                            inactive
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {s.strategySymbol ?? "—"} · margin {s.marginPerTrade} ·
                        joined {new Date(s.createdAt).toLocaleDateString()}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </DrawerSection>

            <DrawerSection title={`TradingView webhooks (${q.data.tvWebhooks.length})`}>
              {q.data.tvWebhooks.length === 0 ? (
                <EmptyNote>No TradingView webhooks.</EmptyNote>
              ) : (
                <ul className="space-y-2">
                  {q.data.tvWebhooks.map((t) => (
                    <li
                      key={t.id}
                      className="rounded-lg border border-border p-3 text-sm"
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{t.name}</span>
                        <Badge variant="outline" className="text-[10px]">
                          {t.mode}
                        </Badge>
                        <Badge
                          variant={t.enabled ? "default" : "outline"}
                          className="text-[10px]"
                        >
                          {t.enabled ? "on" : "off"}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        max {t.maxMarginUsdt} USDT ·{" "}
                        {t.lastDeliveryAt
                          ? `last delivery ${new Date(t.lastDeliveryAt).toLocaleString()}`
                          : "no deliveries yet"}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </DrawerSection>

            <DrawerSection title={`Recent trades (${q.data.recentTrades.length})`}>
              {q.data.recentTrades.length === 0 ? (
                <EmptyNote>No orders placed via RexAlgo yet.</EmptyNote>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-muted-foreground border-b border-border">
                        <th className="py-1.5 pr-2">Time</th>
                        <th className="py-1.5 pr-2">Symbol</th>
                        <th className="py-1.5 pr-2">Side</th>
                        <th className="py-1.5 pr-2">Src</th>
                        <th className="py-1.5 pr-2 text-right">Qty</th>
                        <th className="py-1.5 pr-2 text-right">Notional</th>
                      </tr>
                    </thead>
                    <tbody>
                      {q.data.recentTrades.map((t) => (
                        <tr
                          key={t.id}
                          className="border-b border-border/50"
                        >
                          <td className="py-1.5 pr-2 whitespace-nowrap font-mono">
                            {new Date(t.createdAt).toLocaleString()}
                          </td>
                          <td className="py-1.5 pr-2 font-mono">{t.symbol}</td>
                          <td className="py-1.5 pr-2">{t.side}</td>
                          <td className="py-1.5 pr-2">
                            <Badge variant="outline" className="text-[10px]">
                              {t.source}
                            </Badge>
                          </td>
                          <td className="py-1.5 pr-2 font-mono text-right">
                            {t.quantity}
                          </td>
                          <td className="py-1.5 pr-2 font-mono text-right">
                            {formatUsdt(t.notionalUsdt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </DrawerSection>

            <DrawerSection title={`Master access history (${q.data.masterRequests.length})`}>
              {q.data.masterRequests.length === 0 ? (
                <EmptyNote>No master-access requests.</EmptyNote>
              ) : (
                <ul className="space-y-2">
                  {q.data.masterRequests.map((m) => (
                    <li
                      key={m.id}
                      className="rounded-lg border border-border p-3 text-sm"
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge
                          variant={
                            m.status === "approved"
                              ? "default"
                              : m.status === "rejected"
                              ? "destructive"
                              : "secondary"
                          }
                          className="text-[10px]"
                        >
                          {m.status}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {new Date(m.createdAt).toLocaleString()}
                        </span>
                      </div>
                      {m.contactPhone && (
                        <div className="text-xs text-muted-foreground mt-1">
                          Phone: {m.contactPhone}
                        </div>
                      )}
                      {m.note && (
                        <div className="text-xs text-foreground/80 mt-1 whitespace-pre-wrap">
                          {m.note}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </DrawerSection>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function InfoStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-sm font-medium mt-1 truncate">{value}</div>
    </div>
  );
}

function DrawerSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h3 className="text-sm font-semibold mb-2">{title}</h3>
      {children}
    </section>
  );
}

function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}
