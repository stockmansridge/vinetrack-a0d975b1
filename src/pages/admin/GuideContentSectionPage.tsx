import { Link, Navigate, useParams } from "react-router-dom";
import { ArrowLeft, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AdminGate, AdminPageHeader } from "./_shared";
import { GuideSectionEditor } from "@/components/admin/guide/GuideSectionEditor";
import { useGuideContent } from "@/lib/guide/guideContentStore";
import { guideAreaById } from "@/lib/guide/guideContent";

/** System Admin → Guide Content → one section editor. */
export default function GuideContentSectionPage() {
  const { section: key } = useParams<{ section: string }>();
  const area = guideAreaById(key);
  const { data, isLoading } = useGuideContent();

  if (!area) return <Navigate to="/admin/guide-content" replace />;
  const section = data?.[area.id];

  return (
    <AdminGate>
      <div className="p-4 sm:p-6">
        <div className="mb-3">
          <Link
            to="/admin/guide-content"
            className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-primary hover:underline"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Guide Content
          </Link>
        </div>
        <AdminPageHeader
          title={section?.heading ?? area.title}
          subtitle="Edit the section heading, introduction and every step shown in the guide."
          actions={
            <Button asChild variant="outline" size="sm">
              <Link to={`/dashboard/how-vinetrack-works/${area.slug}`} target="_blank">
                Open in guide
                <ExternalLink className="ml-1.5 h-4 w-4" />
              </Link>
            </Button>
          }
        />

        {isLoading || !section ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading section…
          </div>
        ) : (
          <GuideSectionEditor key={section.key} section={section} />
        )}
      </div>
    </AdminGate>
  );
}
