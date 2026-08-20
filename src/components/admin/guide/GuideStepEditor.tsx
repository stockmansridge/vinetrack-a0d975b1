import { useState } from "react";
import { ChevronDown, ChevronUp, GripVertical, Plus, Trash2, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { GuideStepImageUploader } from "@/components/admin/guide/GuideStepImageUploader";
import {
  GUIDE_PLATFORM_LABELS,
  type GuideContentStep,
} from "@/lib/guide/guideContent";

const NO_PLATFORM = "__none__";

/** One editable guide step row. */
export function GuideStepEditor({
  sectionKey,
  step,
  index,
  fallbackImageUrl,
  dragging,
  onChange,
  onDelete,
  onMove,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  sectionKey: string;
  step: GuideContentStep;
  index: number;
  fallbackImageUrl?: string;
  dragging?: boolean;
  onChange: (next: GuideContentStep) => void;
  onDelete: () => void;
  onMove: (direction: -1 | 1) => void;
  onDragStart: () => void;
  onDragOver: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [newItem, setNewItem] = useState("");

  const set = (patch: Partial<GuideContentStep>) => onChange({ ...step, ...patch });
  const items = step.items ?? [];

  const setItems = (next: string[]) => set({ items: next.length > 0 ? next : undefined });

  return (
    <Card
      draggable
      onDragStart={onDragStart}
      onDragOver={(e) => {
        e.preventDefault();
        onDragOver();
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      onDragEnd={onDragEnd}
      className={cn("p-3", dragging && "border-primary/60 opacity-70")}
    >
      <div className="flex items-center gap-2">
        <span
          className="cursor-grab text-muted-foreground active:cursor-grabbing"
          aria-label="Drag to reorder"
          title="Drag to reorder"
        >
          <GripVertical className="h-4 w-4" />
        </span>
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-bold text-primary">
          {index + 1}
        </span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="min-w-0 flex-1 truncate text-left text-[13.5px] font-semibold text-foreground"
        >
          {step.heading || "Untitled step"}
        </button>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Move up"
            disabled={index === 0}
            onClick={() => onMove(-1)}
          >
            <ChevronUp className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Move down"
            onClick={() => onMove(1)}
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
          <div className="mx-1 flex items-center gap-1.5">
            <Switch
              id={`enabled-${step.id}`}
              checked={step.enabled}
              onCheckedChange={(v) => set({ enabled: v })}
            />
            <Label htmlFor={`enabled-${step.id}`} className="text-[12px] text-muted-foreground">
              {step.enabled ? "Enabled" : "Hidden"}
            </Label>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
            {open ? "Close" : "Edit"}
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label={`Delete ${step.heading || "step"}`}
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {open && (
        <div className="mt-3 grid gap-4 border-t border-border pt-3 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor={`heading-${step.id}`}>Step heading</Label>
              <Input
                id={`heading-${step.id}`}
                value={step.heading}
                placeholder="Drop a Pin"
                onChange={(e) => set({ heading: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`body-${step.id}`}>Step content</Label>
              <Textarea
                id={`body-${step.id}`}
                rows={4}
                value={step.body}
                placeholder="Explain what happens in this step, in plain language."
                onChange={(e) => set({ body: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Platform</Label>
              <Select
                value={step.platform ?? NO_PLATFORM}
                onValueChange={(v) => set({ platform: v === NO_PLATFORM ? undefined : v })}
              >
                <SelectTrigger className="max-w-[260px]">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PLATFORM}>None</SelectItem>
                  {GUIDE_PLATFORM_LABELS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Supporting items (optional)</Label>
              {items.length > 0 && (
                <ul className="space-y-1.5">
                  {items.map((item, i) => (
                    <li key={`${item}-${i}`} className="flex items-center gap-1.5">
                      <Input
                        value={item}
                        onChange={(e) => {
                          const next = [...items];
                          next[i] = e.target.value;
                          setItems(next);
                        }}
                      />
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label="Move item up"
                        disabled={i === 0}
                        onClick={() => {
                          const next = [...items];
                          [next[i - 1], next[i]] = [next[i], next[i - 1]];
                          setItems(next);
                        }}
                      >
                        <ChevronUp className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label="Move item down"
                        disabled={i === items.length - 1}
                        onClick={() => {
                          const next = [...items];
                          [next[i + 1], next[i]] = [next[i], next[i + 1]];
                          setItems(next);
                        }}
                      >
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label="Remove item"
                        onClick={() => setItems(items.filter((_, j) => j !== i))}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex items-center gap-1.5">
                <Input
                  value={newItem}
                  placeholder="Add a supporting item, e.g. Broken post"
                  onChange={(e) => setNewItem(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newItem.trim()) {
                      e.preventDefault();
                      setItems([...items, newItem.trim()]);
                      setNewItem("");
                    }
                  }}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!newItem.trim()}
                  onClick={() => {
                    setItems([...items, newItem.trim()]);
                    setNewItem("");
                  }}
                >
                  <Plus className="mr-1.5 h-4 w-4" />
                  Add
                </Button>
              </div>
            </div>
          </div>

          <div>
            <Label className="mb-1.5 block">
              {step.imageKey ? "Step screenshot (guide image)" : "Step screenshot"}
            </Label>
            {step.imageKey ? (
              // This step uses an existing Guide Image key, so it is managed
              // through the same slot the public guide already resolves —
              // uploads here replace that exact image, not a copy.
              <GuideImageKeyEditor imageKey={step.imageKey} />
            ) : (
              <GuideStepImageUploader
                sectionKey={sectionKey}
                stepId={step.id}
                image={step.image}
                fallbackUrl={fallbackImageUrl}
                onChange={(next) => set({ image: next })}
              />
            )}
          </div>

        </div>
      )}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{step.heading || "Untitled step"}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This step will be removed from the How VineTrack Works guide when you save the
              section. Uploaded image files are not deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onDelete}>Delete step</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
