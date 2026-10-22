// Program help — presentation only.
//
// A small information control beside the Spray Program heading that explains
// how the Program works. It holds no state beyond its own open/closed flag:
// no acknowledgement, no storage, no analytics, no data changes.
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

/**
 * Program Steps are reusable plans; one row per step type. The four types
 * below mirror the operation types the Portal and mobile already support —
 * this list is help copy only and is never used for filtering or logic.
 */
const APPLICATION_TYPES = [
  {
    title: "Foliar Spray",
    body: "Applications to the vine canopy.",
  },
  {
    title: "Banded Spray",
    body: "Targeted applications such as under-vine spraying.",
  },
  {
    title: "Spreader",
    body: "Applications made using spreading equipment.",
  },
  {
    title: "Fertigation",
    body: "Products applied through the irrigation system.",
  },
] as const;

export default function ProgramHelpDialog() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        aria-label="How the Program works"
        title="How the Program works"
        onClick={() => setOpen(true)}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <Info className="h-4 w-4" aria-hidden />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[90dvh] max-w-2xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b px-5 py-4 text-left">
            <DialogTitle className="text-xl">How the Program Works</DialogTitle>
            <DialogDescription className="sr-only">
              An explanation of Program Steps, the Program view and application records.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
            <section>
              <p className="text-sm leading-relaxed text-foreground">
                Your <span className="font-semibold">Program</span> is your vineyard&rsquo;s seasonal
                application plan. It is built from reusable{" "}
                <span className="font-semibold">Program Steps</span>.
              </p>
            </section>

            <section>
              <h3 className="text-sm font-semibold">Program Steps</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                Each Program Step describes an application you may want to use during the season,
                including its E-L growth stage, application method, products, rates, targets and
                other planning information.
              </p>
              <ul className="mt-3 space-y-2">
                {APPLICATION_TYPES.map((t) => (
                  <li key={t.title} className="flex items-start gap-2 text-sm">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                    <span className="leading-relaxed">
                      <span className="font-medium text-foreground">{t.title}</span>
                      <span className="text-muted-foreground"> — {t.body}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                A Program Step is a reusable plan. It does{" "}
                <span className="font-semibold text-foreground">not</span> represent an application
                that has already happened.
              </p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                You can use the{" "}
                <span className="font-medium text-foreground">
                  same Program Step multiple times during a season
                </span>
                . Each actual application is recorded separately while the original Program Step
                remains available to use again.
              </p>
            </section>

            <section>
              <h3 className="text-sm font-semibold">Program</h3>
              <ul className="mt-1.5 space-y-2 text-sm leading-relaxed text-muted-foreground">
                <li>
                  The <span className="font-medium text-foreground">Program</span> view contains the
                  reusable Program Steps for the vineyard.
                </li>
                <li>
                  By default, Program Steps are sorted by{" "}
                  <span className="font-medium text-foreground">
                    E-L growth stage from lowest to highest
                  </span>
                  , helping you view the Program in approximate seasonal order.
                </li>
                <li>Steps without an E-L stage can still be part of the Program.</li>
                <li>
                  The Program can be updated as the season develops without changing applications
                  that have already been completed.
                </li>
              </ul>
            </section>

            <section>
              <h3 className="text-sm font-semibold">Planned Sprays</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                The <span className="font-medium text-foreground">Planned Sprays</span> tab holds
                the operational records — the actual applications, kept separately from Program
                Steps.
              </p>
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
                  <dt className="w-28 shrink-0 font-medium text-foreground">Upcoming</dt>
                  <dd className="text-muted-foreground">
                    Applications that have been planned but have not yet started. Upcoming work can
                    also help you identify the next relevant Program Steps to use.
                  </dd>
                </div>
                <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
                  <dt className="w-28 shrink-0 font-medium text-foreground">In Progress</dt>
                  <dd className="text-muted-foreground">
                    Applications that have been started but have not yet been completed.
                  </dd>
                </div>
                <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
                  <dt className="w-28 shrink-0 font-medium text-foreground">Completed</dt>
                  <dd className="text-muted-foreground">
                    Applications that have been finished and recorded.
                  </dd>
                </div>
                <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
                  <dt className="w-28 shrink-0 font-medium text-foreground">All</dt>
                  <dd className="text-muted-foreground">All application records.</dd>
                </div>
              </dl>
            </section>

            <section
              className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-3"
              aria-label="Program versus applications summary"
            >
              <p className="text-sm leading-relaxed">
                <span className="font-semibold text-foreground">Program = what you plan to do.</span>
              </p>
              <p className="mt-1 text-sm leading-relaxed">
                <span className="font-semibold text-foreground">
                  Planned Sprays = what you are doing or have done.
                </span>
              </p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Your Program Steps remain reusable throughout the season. Each time a Program Step
                is used, the resulting application is recorded separately so operational and
                compliance history remains complete.
              </p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Changes made to a shared Program Step in the Portal are reflected in the
                vineyard&rsquo;s Program used by VineTrack mobile.
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
