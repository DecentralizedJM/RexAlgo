import { useMemo, useState } from "react";
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
  fetchAdminStrategies,
  toggleAdminStrategy,
  deleteAdminStrategy,
  fetchAdminUsers,
  type AdminStrategyRow,
} from "@/lib/api";
import { toast } from "sonner";
import { CheckCircle2, Loader2, Trash2, XCircle } from "lucide-react";

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
        </Tabs>
      </div>
    </div>
  );
}

function MasterAccessTab() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<
    "pending" | "approved" | "rejected" | "all"
  >("pending");

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
                  colSpan={6}
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
                    <div className="flex justify-end gap-2">
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
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {r.reviewedBy
                        ? `by ${r.reviewedBy}`
                        : r.reviewedAt
                        ? new Date(r.reviewedAt).toLocaleString()
                        : "—"}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function StrategiesTab() {
  const qc = useQueryClient();
  const [typeFilter, setTypeFilter] = useState<"all" | "algo" | "copy_trading">(
    "all"
  );
  const [toDelete, setToDelete] = useState<AdminStrategyRow | null>(null);
  const [confirmText, setConfirmText] = useState("");

  const q = useQuery({
    queryKey: ["admin", "strategies", typeFilter],
    queryFn: () => fetchAdminStrategies(typeFilter),
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
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Symbol</TableHead>
                <TableHead>Creator</TableHead>
                <TableHead>Subscribers</TableHead>
                <TableHead>Webhook</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.data?.strategies.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={8}
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
                    <div className="flex justify-end gap-2">
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Users</CardTitle>
        <CardDescription>
          Read-only user directory with master-access state and strategy counts.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Display name</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>Master access</TableHead>
              <TableHead>Strategies</TableHead>
              <TableHead>Joined</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {q.data?.users.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-center text-sm text-muted-foreground"
                >
                  No users.
                </TableCell>
              </TableRow>
            )}
            {q.data?.users.map((u) => (
              <TableRow key={u.id}>
                <TableCell>
                  {u.email ?? (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>{u.displayName}</TableCell>
                <TableCell>
                  <Badge variant="outline">{u.authProvider}</Badge>
                </TableCell>
                <TableCell>
                  {u.masterStatus ? (
                    <Badge variant="secondary">{u.masterStatus}</Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">none</span>
                  )}
                </TableCell>
                <TableCell>{u.strategyCount}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {new Date(u.createdAt).toLocaleString()}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
