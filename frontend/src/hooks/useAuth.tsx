import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { getMe } from "@/lib/api";

export function useSession() {
  return useQuery({
    queryKey: ["session", "me"],
    queryFn: getMe,
    staleTime: 60_000,
  });
}

/** Redirect to /auth when user is not logged in (for protected pages). */
export function useRequireAuth() {
  const navigate = useNavigate();
  const q = useSession();

  useEffect(() => {
    if (q.isPending) return;
    if (!q.data?.user) {
      navigate("/auth", { replace: true, state: { from: window.location.pathname } });
    }
  }, [q.isPending, q.data?.user, navigate]);

  return q;
}
