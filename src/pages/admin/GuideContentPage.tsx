import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Check, ImageOff, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AdminGate, AdminPageHeader } from "./_shared";
import { GuideImageKeyEditor } from "@/components/admin/guide/GuideImageSlotEditor";
import { GuideImageCoverage } from "@/components/guide/GuideImageCoverage";
import { useGuideContent, useBootstrapGuideContent } from "@/lib/guide/guideContentStore";
import { useGuideImages } from "@/lib/guide/guideImageStore";
import { manageableGuideAreas } from "@/lib/guide/guideContent";
import type { GuideImageKey } from "@/lib/guide/guideImages";

/**
 * System Admin → Guide Content.
 *
 * One place to manage the whole How VineTrack Works guide: the landing hero,
 * every section (heading, introduction, highlight image) and every step row
 * (heading, body, platform, supporting items, screenshot, order, enabled).
 *
 * Images continue to use the existing Guide Image keys and the existing
 * guide-images bucket — this is an admin UX consolidation, not a migration.
 */
export default function GuideContentPage() {
  const { data, isLoading } = useGuideContent();
  const { data: images } = useGuideImages();
  const areas = manageableGuideAreas();
  const bootstrap = useBootstrapGuideContent();
  const bootstrapped = useRef(false);

  // Safe, one-time import of the existing guide into the managed model.
  // Never overwrites content already edited through Guide Content.
  useEffect(() => {
    if (isLoading || bootstrapped.current) return;
    bootstrapped.current = true;
    bootstrap.mutate(undefined, { onError: () => undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  return (
    <AdminGate>
      <div className="p-4 sm:p-6">
        <AdminPageHeader
          title="Guide Content"
          subtitle="Manage every section, step and image shown in How VineTrack Works."
        />

        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="text-base font-semibold">How VineTrack Works — Landing Page</h2>
            <p className="text-[13px] text-muted-foreground">
              The hero photograph at the top of the guide landing page.
            </p>
            <GuideImageKeyEditor imageKey="hero" />
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold">Guide sections</h2>
            {isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading guide content…
              </div>
            ) : (
              areas.map((area) => {
                const section = data?.[area.id];
                const steps = section?.steps ?? [];
                const enabled = steps.filter((s) => s.enabled).length;
                const hasImage = Boolean(images?.[area.id as GuideImageKey]);
                return (
                  <Card key={area.id} className="flex flex-wrap items-center gap-4 p-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-semibold">
                          {section?.heading ?? area.title}
                        </h3>
                        <Badge variant={section?.enabled === false ? "outline" : "secondary"}>
                          {section?.enabled === false ? "Unpublished" : "Published"}
                        </Badge>
                        <span
                          className={
                            hasImage
                              ? "inline-flex items-center gap-1 text-[12px] font-medium text-emerald-600 dark:text-emerald-400"
                              : "inline-flex items-center gap-1 text-[12px] font-medium text-muted-foreground"
                          }
                        >
                          {hasImage ? (
                            <Check className="h-3.5 w-3.5" aria-hidden />
                          ) : (
                            <ImageOff className="h-3.5 w-3.5" aria-hidden />
                          )}
                          Highlight image
                        </span>
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
              })
            )}
          </section>

          <GuideImageCoverage />
        </div>
      </div>
    </AdminGate>
  );
}
