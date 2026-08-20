import { useEffect, useMemo, useState } from "react";
import { Eye, Loader2, Plus, RotateCcw, Save } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { GuideStepEditor } from "@/components/admin/guide/GuideStepEditor";
import { GuideSectionPreview } from "@/components/admin/guide/GuideSectionPreview";
import { useGuideImages, guideImagePublicUrl } from "@/lib/guide/guideImageStore";
import { useSaveGuideSection } from "@/lib/guide/guideContentStore";
import {
  newGuideStep,
  type GuideContentSection,
  type GuideContentStep,
} from "@/lib/guide/guideContent";
import type { GuideImageKey } from "@/lib/guide/guideImages";

/**
 * Section-level editor: heading, introduction, step rows, ordering and preview.
 * The same component manages every How VineTrack Works section.
 */
export function GuideSectionEditor({ section }: { section: GuideContentSection }) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<GuideContentSection>(section);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const save = useSaveGuideSection();
  const { data: imageMap } = useGuideImages();

  // Adopt server content only while the admin has no unsaved work.
  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(section),
    [draft, section],
  );
  useEffect(() => {
    if (!dirty) setDraft(section);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section.updated_at, section.key]);

  const setSteps = (steps: GuideContentStep[]) => setDraft((d) => ({ ...d, steps }));

  const move = (from: number, to: number) => {
    if (to < 0 || to >= draft.steps.length || from === to) return;
    const next = [...draft.steps];
    const [row] = next.splice(from, 1);
    next.splice(to, 0, row);
    setSteps(next);
  };

  async function onSave() {
    if (save.isPending) return;
    try {
      await save.mutateAsync({
        ...draft,
        steps: draft.steps.map((s) => ({
          ...s,
          heading: s.heading.trim(),
          body: s.body.trim(),
        })),
      });
      toast({ title: "Changes saved", description: `${draft.heading} is now live in the guide.` });
    } catch (e) {
      toast({
        title: "Could not save",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  }

  const fallbackUrl = (step: GuideContentStep) =>
    step.imageKey ? guideImagePublicUrl(imageMap?.[step.imageKey as GuideImageKey]) : undefined;

  return (
    <div className="space-y-5">
      <Card className="space-y-4 p-4">
        <div className="space-y-1.5">
          <Label htmlFor="section-heading">Section heading</Label>
          <Input
            id="section-heading"
            value={draft.heading}
            onChange={(e) => setDraft((d) => ({ ...d, heading: e.target.value }))}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="section-intro">Section introduction</Label>
          <Textarea
            id="section-intro"
            rows={3}
            value={draft.intro}
            onChange={(e) => setDraft((d) => ({ ...d, intro: e.target.value }))}
          />
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id="section-enabled"
            checked={draft.enabled}
            onCheckedChange={(v) => setDraft((d) => ({ ...d, enabled: v }))}
          />
          <Label htmlFor="section-enabled" className="text-[13px]">
            Section published
          </Label>
        </div>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold">Steps</h2>
          <Badge variant="secondary">{draft.steps.length}</Badge>
          {dirty && (
            <span className="text-[12px] font-medium text-amber-600 dark:text-amber-400">
              Unsaved changes
            </span>
          )}
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setSteps([...draft.steps, newGuideStep(draft.key)])}
        >
          <Plus className="mr-1.5 h-4 w-4" />
          Add Step
        </Button>
      </div>

      <div className="space-y-2">
        {draft.steps.map((step, i) => (
          <GuideStepEditor
            key={step.id}
            sectionKey={draft.key}
            step={step}
            index={i}
            dragging={dragIndex === i}
            fallbackImageUrl={fallbackUrl(step)}
            onChange={(next) => setSteps(draft.steps.map((s, j) => (j === i ? next : s)))}
            onDelete={() => setSteps(draft.steps.filter((_, j) => j !== i))}
            onMove={(dir) => move(i, i + dir)}
            onDragStart={() => setDragIndex(i)}
            onDragOver={() => {
              if (dragIndex !== null && dragIndex !== i) {
                move(dragIndex, i);
                setDragIndex(i);
              }
            }}
            onDrop={() => setDragIndex(null)}
            onDragEnd={() => setDragIndex(null)}
          />
        ))}
        {draft.steps.length === 0 && (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            No steps yet — use “Add Step” to build this section.
          </Card>
        )}
      </div>

      <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t border-border bg-background/95 py-3 backdrop-blur">
        <Button type="button" onClick={onSave} disabled={save.isPending || !dirty}>
          {save.isPending ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-1.5 h-4 w-4" />
          )}
          {save.isPending ? "Saving…" : dirty ? "Save changes" : "Saved"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!dirty || save.isPending}
          onClick={() => setDraft(section)}
        >
          <RotateCcw className="mr-1.5 h-4 w-4" />
          Revert changes
        </Button>
        <Button type="button" variant="secondary" onClick={() => setShowPreview((v) => !v)}>
          <Eye className="mr-1.5 h-4 w-4" />
          {showPreview ? "Hide preview" : "Preview section"}
        </Button>
      </div>

      {showPreview && <GuideSectionPreview section={draft} />}
    </div>
  );
}
