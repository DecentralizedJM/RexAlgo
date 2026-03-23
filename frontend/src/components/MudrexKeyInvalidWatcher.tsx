import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMudrexKeyInvalid } from "@/contexts/MudrexKeyInvalidContext";
import { useSession } from "@/hooks/useAuth";
import { fetchWallet, isMudrexCredentialError } from "@/lib/api";
import { MUDREX_KEY_PROBE_QUERY_KEY } from "@/lib/queryKeys";

/**
 * Keeps global Mudrex key state in sync: background probe + any query that hits Mudrex and fails auth.
 * Copy-trading mirroring on the server does not use this — it uses DB-stored secrets.
 */
export default function MudrexKeyInvalidWatcher() {
  const { setMudrexKeyInvalid } = useMudrexKeyInvalid();
  const sessionQ = useSession();
  const location = useLocation();
  const queryClient = useQueryClient();

  const loggedIn = Boolean(sessionQ.data?.user);
  const hasMudrexKey = sessionQ.data?.user?.hasMudrexKey ?? false;
  const onAuthPage = location.pathname === "/auth";

  const probe = useQuery({
    queryKey: MUDREX_KEY_PROBE_QUERY_KEY,
    queryFn: () => fetchWallet({ futuresOnly: true }),
    enabled: loggedIn && hasMudrexKey && !onAuthPage,
    staleTime: 60_000,
    refetchInterval: 10 * 60_000,
    refetchOnWindowFocus: true,
    retry: false,
  });

  useEffect(() => {
    if (!loggedIn) setMudrexKeyInvalid(false);
  }, [loggedIn, setMudrexKeyInvalid]);

  useEffect(() => {
    if (probe.isSuccess) setMudrexKeyInvalid(false);
  }, [probe.isSuccess, probe.dataUpdatedAt, setMudrexKeyInvalid]);

  useEffect(() => {
    if (probe.error && isMudrexCredentialError(probe.error)) {
      setMudrexKeyInvalid(true);
    }
  }, [probe.error, setMudrexKeyInvalid]);

  useEffect(() => {
    const cache = queryClient.getQueryCache();
    return cache.subscribe((event) => {
      if (event.type !== "updated") return;
      const q = event.query;
      const err = q.state.error;
      if (err && isMudrexCredentialError(err)) {
        setMudrexKeyInvalid(true);
        return;
      }
      if (q.state.status === "success" && q.queryKey[0] === "wallet") {
        setMudrexKeyInvalid(false);
      }
    });
  }, [queryClient, setMudrexKeyInvalid]);

  return null;
}
