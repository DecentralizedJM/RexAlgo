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
