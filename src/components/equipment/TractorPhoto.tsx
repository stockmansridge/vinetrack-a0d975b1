import { useQuery } from "@tanstack/react-query";
import TractorReferencePhoto from "@/components/equipment/TractorReferencePhoto";
import { fetchTractorPhotoUrl, tractorPhotoQueryKey } from "@/lib/tractorPhotos";
import type { TractorPhotoIdentity } from "@/lib/tractorReferencePhotos";

/** Shows the tractor's uploaded photo; falls back to the verified reference photo (or blank). */
export default function TractorPhoto({ tractorId, tractor, size = "sm" }: { tractorId: string; tractor: TractorPhotoIdentity; size?: "sm" | "lg" }) {
  const { data: url } = useQuery({
    queryKey: tractorPhotoQueryKey(tractorId),
    queryFn: () => fetchTractorPhotoUrl(tractorId),
    staleTime: 30 * 60 * 1000,
    retry: false,
  });
  if (!url) return <TractorReferencePhoto tractor={tractor} />;
  const cls = size === "lg" ? "h-28 w-40" : "h-16 w-24";
  return <img src={url} alt={`${tractor.brand ?? ""} ${tractor.model ?? ""} photo`.trim()} className={`${cls} rounded object-contain`} loading="lazy" />;
}
