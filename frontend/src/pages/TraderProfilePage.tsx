import { Navigate, useParams } from "react-router-dom";

/** Legacy route: trader profiles are strategy records; unified detail at /strategy/:id */
export default function TraderProfilePage() {
  const { id } = useParams();
  if (!id) return <Navigate to="/copy-trading" replace />;
  return <Navigate to={`/strategy/${id}?from=copy`} replace />;
}
