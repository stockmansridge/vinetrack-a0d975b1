// Soil Analysis help — presentation only.
//
// A small information control beside the Soil Analysis heading that explains
// how the feature works. It holds no state beyond its own open/closed flag:
// no acknowledgement, no storage, no analytics, no data changes.
// Mirrors the Spray Program help control pattern (ProgramHelpDialog).
import { useState } from "react";
import { Info } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/** Help copy only — each step mirrors a released workflow, never used for logic. */
const STEPS = [
  {
    title: "Upload laboratory reports",
    body: "Upload a soil analysis report from your laboratory. VineTrack keeps the original file as source evidence and reads the report into structured soil results.",
  },
  {
    title: "Review the extracted results",
    body: "Check the sample details, measurements, units, laboratory ranges and statuses against the original report before confirming the sample. You can correct extracted values without replacing the original source evidence.",
  },
  {
    title: "Map the sample to your vineyard",
    body: "Link the sample to the VineTrack block or blocks it represents. Select the actual vineyard rows from your existing Block & Row setup — you do not need to type row numbers. If the laboratory report includes a clear row range, VineTrack may suggest the matching rows for you to review.",
  },
  {
    title: "Confirm the sample",
    body: "Once the details and vineyard mapping are correct, confirm the sample. Confirmed samples become part of your vineyard’s Soil Analysis history and reporting.",
  },
  {
    title: "Trends",
    body: "Choose one or more blocks and one or more analytes. VineTrack displays a separate trend graph for each selected analyte. Methods and units that are not directly comparable remain separate. Each block keeps its own trend line; where several samples for the same block share a date, VineTrack keeps the individual results visible and may show a clearly labelled date average.",
  },
  {
    title: "Compare",
    body: "Compare one analyte across selected blocks to see the latest measured values, sampling dates and laboratory statuses side by side.",
  },
  {
    title: "Reports",
    body: "Use the vineyard soil map to see how a selected analyte varies across your blocks. Switch between measured values and laboratory status, select blocks for detail, and use the as-of date to review earlier results.",
  },
  {
    title: "Traffic Lights",
    body: "Use Most recent or an as-of date, filter directly to Low, Satisfactory, High or Other, and optionally turn on AI viticulture indication for results the laboratory has not rated into those traffic-light groups. AI indications are clearly labelled and never replace the laboratory status.",
  },
] as const;

export default function SoilAnalysisHelpDialog() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        aria-label="How Soil Analysis works"
        title="How Soil Analysis works"
        onClick={() => setOpen(true)}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <Info className="h-4 w-4" aria-hidden />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[90dvh] max-w-2xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b px-5 py-4 text-left">
            <DialogTitle className="text-xl">How Soil Analysis Works</DialogTitle>
            <DialogDescription className="sr-only">
              How to upload, review, map and confirm soil samples, and use Trends, Compare and
              Traffic Lights and Reports.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
            <section>
              <p className="text-sm leading-relaxed text-foreground">
                Soil Analysis stores your laboratory soil reports with your vineyard, keeps the
                original files as evidence and makes the results available for your blocks.
              </p>
            </section>

            <section>
              <ol className="space-y-4">
                {STEPS.map((step, i) => (
                  <li key={step.title} className="flex items-start gap-3">
                    <span
                      className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-foreground"
                      aria-hidden
                    >
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold">{step.title}</h3>
                      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                        {step.body}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            <section
              className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-3"
              aria-label="Laboratory data note"
            >
              <p className="text-sm leading-relaxed text-muted-foreground">
                VineTrack reports and visualises the laboratory data you upload. Laboratory ranges
                can differ by provider and method, and VineTrack does not replace agronomic advice
                or the laboratory&rsquo;s original report.
                {" "}AI indications are general screening guidance only and do not replace the laboratory report or agronomic advice.
              </p>
            </section>
          </div>

          <DialogFooter className="border-t px-5 py-3">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
