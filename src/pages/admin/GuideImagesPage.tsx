import { Link } from "react-router-dom";
import { ArrowRight, Images } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AdminGate, AdminPageHeader } from "./_shared";

/**
 * System Admin → Guide Images (retained for existing bookmarks).
 *
 * Guide imagery is now managed inside Guide Content, alongside the section and
 * step it belongs to. Nothing moved in storage: the same Guide Image keys and
 * the same `guide-images` bucket are used, so every uploaded image is already
 * visible in its new home.
 */
export default function GuideImagesPage() {
  return (
    <AdminGate>
      <div className="p-4 sm:p-6">
        <AdminPageHeader
          title="Guide Images"
          subtitle="Guide images are now managed within Guide Content."
        />
        <Card className="max-w-2xl space-y-3 p-5">
          <div className="flex items-center gap-2 text-foreground">
            <Images className="h-5 w-5 text-primary" aria-hidden />
            <h2 className="text-base font-semibold">This page has moved</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            The landing hero, each section's highlight image and every step screenshot are
            managed from System Admin → Guide Content, next to the content they appear with.
            Your existing images are unchanged and already appear there.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button asChild>
              <Link to="/admin/guide-content">
                Open Guide Content
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </Card>
      </div>
    </AdminGate>
  );
}
