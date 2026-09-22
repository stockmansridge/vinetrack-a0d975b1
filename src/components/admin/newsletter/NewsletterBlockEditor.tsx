import { useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ArrowDown, ArrowUp, Copy, ImagePlus, Trash2, X } from "lucide-react";
import {
  BLOCK_LABELS,
  type NewsletterBlock,
  type NewsletterCardBlock,
  type NewsletterImageRef,
} from "@/lib/newsletter/blocks";
import { uploadNewsletterImage } from "@/lib/newsletter/imageUpload";
import { useToast } from "@/hooks/use-toast";

interface Props {
  block: NewsletterBlock;
  index: number;
  total: number;
  readOnly?: boolean;
  onChange: (patch: Partial<NewsletterBlock>) => void;
  onMove: (delta: number) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

function ImageField({
  value,
  readOnly,
  onChange,
}: {
  value: NewsletterImageRef | null | undefined;
  readOnly?: boolean;
  onChange: (next: NewsletterImageRef | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  return (
    <div className="space-y-2">
      <Label className="text-xs">Image</Label>
      {value?.url ? (
        <div className="flex items-start gap-3">
          <img
            src={value.url}
            alt={value.alt ?? ""}
            className="h-20 w-28 rounded-md object-cover border"
          />
          <div className="flex-1 space-y-2">
            <Input
              placeholder="Alt text (described for screen readers)"
              value={value.alt ?? ""}
              disabled={readOnly}
              onChange={(e) => onChange({ ...value, alt: e.target.value })}
            />
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={readOnly || busy}
                onClick={() => inputRef.current?.click()}
              >
                Replace
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={readOnly}
                onClick={() => onChange(null)}
              >
                <X className="h-4 w-4 mr-1" /> Remove
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-1"
          disabled={readOnly || busy}
          onClick={() => inputRef.current?.click()}
        >
          <ImagePlus className="h-4 w-4" /> {busy ? "Uploading…" : "Upload image"}
        </Button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setBusy(true);
          try {
            const uploaded = await uploadNewsletterImage(file);
            onChange({ url: uploaded.url, path: uploaded.path, alt: value?.alt ?? "" });
          } catch (err) {
            toast({
              title: "Couldn't upload the image",
              description: err instanceof Error ? err.message : String(err),
              variant: "destructive",
            });
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}

function Choice({
  label,
  options,
  value,
  readOnly,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string | undefined;
  readOnly?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <div className="flex gap-1">
        {options.map((o) => (
          <Button
            key={o.value}
            type="button"
            size="sm"
            variant={value === o.value ? "default" : "outline"}
            disabled={readOnly}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

export function NewsletterBlockEditor({
  block,
  index,
  total,
  readOnly,
  onChange,
  onMove,
  onDuplicate,
  onDelete,
}: Props) {
  const showText = block.type !== "divider";
  const showBullets = block.type === "feature" || block.type === "text";
  const showImage = block.type === "hero" || block.type === "feature";
  const showCta = ["hero", "feature", "button"].includes(block.type);

  const updateCard = (i: number, patch: Partial<NewsletterCardBlock>) => {
    const cards = [...(block.cards ?? [])];
    cards[i] = { ...cards[i], ...patch };
    onChange({ cards });
  };

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">
          {index + 1}. {BLOCK_LABELS[block.type]}
        </div>
        <div className="flex items-center gap-1">
          <Button type="button" size="icon" variant="ghost" title="Move up" disabled={readOnly || index === 0} onClick={() => onMove(-1)}>
            <ArrowUp className="h-4 w-4" />
          </Button>
          <Button type="button" size="icon" variant="ghost" title="Move down" disabled={readOnly || index === total - 1} onClick={() => onMove(1)}>
            <ArrowDown className="h-4 w-4" />
          </Button>
          <Button type="button" size="icon" variant="ghost" title="Duplicate" disabled={readOnly} onClick={onDuplicate}>
            <Copy className="h-4 w-4" />
          </Button>
          <Button type="button" size="icon" variant="ghost" title="Delete" disabled={readOnly} onClick={onDelete}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {showImage && (
        <ImageField value={block.image} readOnly={readOnly} onChange={(image) => onChange({ image })} />
      )}

      {showText && (
        <>
          {block.type !== "button" && block.type !== "footer" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">Small label (optional)</Label>
                <Input
                  value={block.eyebrow ?? ""}
                  disabled={readOnly}
                  onChange={(e) => onChange({ eyebrow: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Heading</Label>
                <Input
                  value={block.heading ?? ""}
                  disabled={readOnly}
                  onChange={(e) => onChange({ heading: e.target.value })}
                />
              </div>
            </div>
          )}
          {block.type !== "button" && (
            <div className="space-y-1">
              <Label className="text-xs">{block.type === "footer" ? "Extra footer note (optional)" : "Body text"}</Label>
              <Textarea
                rows={block.type === "footer" ? 2 : 4}
                value={block.body ?? ""}
                disabled={readOnly}
                onChange={(e) => onChange({ body: e.target.value })}
              />
            </div>
          )}
        </>
      )}

      {showBullets && (
        <div className="space-y-1">
          <Label className="text-xs">Bullet list (one per line)</Label>
          <Textarea
            rows={3}
            value={(block.bullets ?? []).join("\n")}
            disabled={readOnly}
            onChange={(e) =>
              onChange({ bullets: e.target.value.split("\n").map((l) => l.trimStart()) })
            }
          />
        </div>
      )}

      {showCta && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Button label {block.type !== "button" && "(optional)"}</Label>
            <Input
              value={block.ctaLabel ?? ""}
              disabled={readOnly}
              onChange={(e) => onChange({ ctaLabel: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Button link</Label>
            <Input
              placeholder="https://…"
              value={block.ctaUrl ?? ""}
              disabled={readOnly}
              onChange={(e) => onChange({ ctaUrl: e.target.value })}
            />
          </div>
        </div>
      )}

      {block.type === "cards" && (
        <div className="space-y-3">
          {(block.cards ?? []).map((card, i) => (
            <Card key={i} className="p-3 space-y-2 bg-muted/40">
              <div className="text-xs font-semibold text-muted-foreground">Card {i + 1}</div>
              <ImageField
                value={card.image}
                readOnly={readOnly}
                onChange={(image) => updateCard(i, { image })}
              />
              <Input
                placeholder="Heading"
                value={card.heading ?? ""}
                disabled={readOnly}
                onChange={(e) => updateCard(i, { heading: e.target.value })}
              />
              <Textarea
                rows={2}
                placeholder="Short description"
                value={card.body ?? ""}
                disabled={readOnly}
                onChange={(e) => updateCard(i, { body: e.target.value })}
              />
              <div className="grid gap-2 sm:grid-cols-2">
                <Input
                  placeholder="Button label"
                  value={card.ctaLabel ?? ""}
                  disabled={readOnly}
                  onChange={(e) => updateCard(i, { ctaLabel: e.target.value })}
                />
                <Input
                  placeholder="https://…"
                  value={card.ctaUrl ?? ""}
                  disabled={readOnly}
                  onChange={(e) => updateCard(i, { ctaUrl: e.target.value })}
                />
              </div>
            </Card>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-4 pt-1">
        {block.type !== "divider" && (
          <Choice
            label="Section background"
            value={block.background ?? "white"}
            readOnly={readOnly}
            options={[
              { value: "white", label: "White" },
              { value: "soft", label: "Soft green" },
            ]}
            onChange={(v) => onChange({ background: v as "white" | "soft" })}
          />
        )}
        {["hero", "text", "button"].includes(block.type) && (
          <Choice
            label="Alignment"
            value={block.align ?? "left"}
            readOnly={readOnly}
            options={[
              { value: "left", label: "Left" },
              { value: "center", label: "Centre" },
            ]}
            onChange={(v) => onChange({ align: v as "left" | "center" })}
          />
        )}
        {block.type === "feature" && (
          <Choice
            label="Layout"
            value={block.layout ?? "image-left"}
            readOnly={readOnly}
            options={[
              { value: "image-left", label: "Image left" },
              { value: "image-right", label: "Image right" },
            ]}
            onChange={(v) => onChange({ layout: v as "image-left" | "image-right" })}
          />
        )}
      </div>
    </Card>
  );
}
