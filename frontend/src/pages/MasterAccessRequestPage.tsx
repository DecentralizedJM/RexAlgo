import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useRequireAuth } from "@/hooks/useAuth";
import { AuthGateSplash } from "@/components/AuthGateSplash";
import {
  fetchMasterAccessMe,
  requestMasterAccess,
  ApiError,
} from "@/lib/api";
import { toast } from "sonner";
import { ArrowRight, Loader2, ShieldCheck, Clock, XCircle } from "lucide-react";

export default function MasterAccessRequestPage() {
  const authQ = useRequireAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");

  const meQ = useQuery({
    queryKey: ["master-access", "me"],
    queryFn: fetchMasterAccessMe,
    enabled: authQ.authed,
    staleTime: 15_000,
  });

  const status = meQ.data?.status ?? "none";
  const latest = meQ.data?.latest ?? null;

  const submitMut = useMutation({
    mutationFn: () => requestMasterAccess(note),
    onSuccess: async (res) => {
      toast.success(
        res.status === "approved"
          ? "You already have access"
          : "Request submitted for review"
      );
      setNote("");
      await queryClient.invalidateQueries({ queryKey: ["master-access", "me"] });
      await queryClient.invalidateQueries({ queryKey: ["session", "me"] });
      if (res.status === "approved") {
        navigate("/marketplace/studio");
      }
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) {
        toast.info("You already have a request on file");
        void queryClient.invalidateQueries({ queryKey: ["master-access", "me"] });
      } else {
        toast.error(err instanceof Error ? err.message : "Could not submit");
      }
    },
  });

  const headline = useMemo(() => {
    switch (status) {
      case "approved":
        return {
          icon: <ShieldCheck className="h-5 w-5 text-primary" aria-hidden />,
          title: "You have Master Studio access",
          desc: "Head over to the studio to create strategies or copy-trading listings.",
        };
      case "pending":
        return {
          icon: <Clock className="h-5 w-5 text-muted-foreground" aria-hidden />,
          title: "Request pending review",
          desc: "RexAlgo will notify you once a teammate reviews your request.",
        };
      case "rejected":
        return {
          icon: <XCircle className="h-5 w-5 text-loss" aria-hidden />,
          title: "Previous request was rejected",
          desc: "You can submit another request with additional context.",
        };
      default:
        return {
          icon: <ShieldCheck className="h-5 w-5 text-muted-foreground" aria-hidden />,
          title: "Request Master Studio access",
          desc: "Master Studio lets you create algo strategies and copy-trading listings. Tell us how you plan to use it.",
        };
    }
  }, [status]);

  if (!authQ.authResolved) {
    return <AuthGateSplash />;
  }
  if (!authQ.data?.user) {
    return null;
  }

  const isApproved = status === "approved";
  const isPending = status === "pending";
  const canSubmit = !isApproved && !isPending;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container mx-auto px-4 main-nav-pad pb-16 max-w-2xl">
        <div className="mb-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/dashboard")}
          >
            Back to dashboard
          </Button>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-start gap-3">
              <div className="mt-1">{headline.icon}</div>
              <div>
                <CardTitle>{headline.title}</CardTitle>
                <CardDescription className="mt-1">
                  {headline.desc}
                </CardDescription>
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            {latest && (
              <div className="rounded-lg border border-border/60 bg-card/40 p-3 text-sm">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Latest request</span>
                  <span>
                    {new Date(latest.createdAt).toLocaleString()}
                  </span>
                </div>
                <div className="mt-1 font-medium capitalize">{latest.status}</div>
                {latest.note && (
                  <p className="mt-2 text-xs text-muted-foreground whitespace-pre-wrap">
                    {latest.note}
                  </p>
                )}
                {latest.reviewedBy && latest.reviewedAt && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Reviewed by {latest.reviewedBy} ·{" "}
                    {new Date(latest.reviewedAt).toLocaleString()}
                  </p>
                )}
              </div>
            )}

            {canSubmit && (
              <div className="space-y-2">
                <label
                  htmlFor="master-access-note"
                  className="text-sm font-medium"
                >
                  How will you use Master Studio? (optional)
                </label>
                <Textarea
                  id="master-access-note"
                  placeholder="e.g. I run an ETH trend-following bot and want to list it for copy trading."
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={5}
                  maxLength={1000}
                />
                <p className="text-xs text-muted-foreground">
                  Max 1000 characters. Optional — but helps reviewers approve faster.
                </p>
              </div>
            )}
          </CardContent>

          <CardFooter className="flex justify-end gap-2">
            {isApproved ? (
              <Button onClick={() => navigate("/marketplace/studio")}>
                Open Master Studio <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            ) : (
              <Button
                disabled={!canSubmit || submitMut.isPending}
                onClick={() => submitMut.mutate()}
              >
                {submitMut.isPending && (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />
                )}
                {isPending ? "Awaiting review" : "Request access"}
              </Button>
            )}
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
