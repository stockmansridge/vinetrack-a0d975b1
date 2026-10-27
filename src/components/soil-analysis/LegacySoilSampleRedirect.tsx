// Backward compatibility: old /admin/soil-analysis/samples/:id links redirect
// to the released customer route, preserving the sample id.
import { Navigate, useParams } from "react-router-dom";

export function LegacySoilSampleRedirect() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={id ? `/soil-analysis/samples/${encodeURIComponent(id)}` : "/soil-analysis"} replace />;
}
