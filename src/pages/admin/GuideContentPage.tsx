import { Link } from "react-router-dom";
import { ArrowRight, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AdminGate, AdminPageHeader } from "./_shared";
import { useGuideContent } from "@/lib/guide/guideContentStore";
import { manageableGuideAreas } from "@/lib/guide/guideContent";

/**
 * System Admin → Guide Content.
 *
 * Manages the headings, introductions, step rows, ordering and screenshots
 * shown throughout How VineTrack Works. Works alongside Guide Images, which
 * still manages the landing/hero imagery library.
 */
export default function GuideContentPage() {
  const { data, isLoading } = useGuideContent();
  const areas = manageableGuideAreas();

  return (
    <AdminGate>
      <div className="p-4 sm:p-6">
        <AdminPageHeader
          title="Guide Content"
          subtitle="Edit the sections, steps and screenshots shown in How VineTrack Works."
        />

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading guide content…
          </div>
        ) : (
          <div className="space-y-3">
            {areas.map((area) => {
              const section = data?.[area.id];
              const steps = section?.steps ?? [];
              const enabled = steps.filter((s) => s.enabled).length;
              return (
                <Card key={area.id} className="flex flex-wrap items-center gap-4 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold">
                        {section?.heading ?? area.title}
                      </h2>
                      <Badge variant={section?.enabled === false ? "outline" : "secondary"}>
                        {section?.enabled === false ? "Unpublished" : "Published"}
                      </Badge>
                    </div>
                    <p className="mt-1 line-clamp-2 max-w-3xl text-sm text-muted-foreground">
                      {section?.intro ?? area.detailIntro}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {steps.length} step{steps.length === 1 ? "" : "s"}
                      {steps.length > enabled ? ` · ${steps.length - enabled} hidden` : ""}
                      {section?.updated_at
                        ? ` · Last updated ${new Date(section.updated_at).toLocaleString()}`
                        : ""}
                    </p>
                  </div>
                  <Button asChild size="sm">
                    <Link to={`/admin/guide-content/${area.id}`}>
                      Manage
                      <ArrowRight className="ml-1.5 h-4 w-4" />
                    </Link>
                  </Button>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </AdminGate>
  );
}
