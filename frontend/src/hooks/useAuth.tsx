import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { getMe } from "@/lib/api";

export function useSession() {
  return useQuery({
    queryKey: ["session", "me"],
    queryFn: getMe,
    // Always revalidate on mount so we don’t redirect with a stale `{ user: null }` cache
    staleTime: 0,
    gcTime: 30 * 60_000,
  });
}

/** Redirect to /auth when user is not logged in (for protected pages). */
export function useRequireAuth() {
  const navigate = useNavigate();
  const q = useSession();

  const authResolved = q.isFetched;
  const authed = Boolean(q.data?.user);

  useEffect(() => {
    if (!authResolved) return;
    if (!authed) {
      navigate("/auth", { replace: true, state: { from: window.location.pathname } });
    }
  }, [authResolved, authed, navigate]);

  return { ...q, authResolved, authed };
}

/**
 * Guard for /marketplace/studio and /copy-trading/studio pages.
 * Redirects to /master-studio/request when the user is signed in but has not been
 * approved for Master Studio access yet. Admins pass through.
 */
export function useRequireMasterAccess() {
  const navigate = useNavigate();
  const q = useRequireAuth();
  const user = q.data?.user;
  const masterApproved =
    user?.masterAccess === "approved" || user?.isAdmin === true;

  useEffect(() => {
    if (!q.authResolved || !q.authed || !user) return;
    if (!masterApproved) {
      navigate("/master-studio/request", { replace: true });
    }
  }, [q.authResolved, q.authed, user, masterApproved, navigate]);

  return { ...q, masterApproved };
}

/** Guard for /admin routes — sends non-admins to /dashboard. */
export function useRequireAdmin() {
  const navigate = useNavigate();
  const q = useRequireAuth();
  const user = q.data?.user;
  const isAdmin = user?.isAdmin === true;

  useEffect(() => {
    if (!q.authResolved || !q.authed || !user) return;
    if (!isAdmin) {
      navigate("/dashboard", { replace: true });
    }
  }, [q.authResolved, q.authed, user, isAdmin, navigate]);

  return { ...q, isAdmin };
}
