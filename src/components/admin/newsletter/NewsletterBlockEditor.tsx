import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ArrowDown, ArrowUp, Copy, Trash2 } from "lucide-react";
import {
  BLOCK_LABELS,
  type NewsletterBlock,
  type NewsletterCardBlock,
} from "@/lib/newsletter/blocks";
import { NewsletterImageField } from "@/components/admin/newsletter/NewsletterImageField";
import {
  BACKGROUND_OPTIONS,
  BUTTON_BACKGROUND_OPTIONS,
  BUTTON_TEXT_OPTIONS,
  NEWSLETTER_BRAND,
  TEXT_OPTIONS,
  colourHex,
  contrastWarning,
  isValidHexColour,
  type ColourOption,
} from "@/lib/newsletter/palette";

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

const CUSTOM = "__custom";

/** Preset-first colour control with an optional validated hex. */
function ColourField({
  label,
  options,
  value,
  fallback,
  readOnly,
  onChange,
}: {
  label: string;
  options: ColourOption[];
  value: string;
  fallback: string;
  readOnly?: boolean;
  onChange: (value: string) => void;
}) {
  const custom = isValidHexColour(value) || (!!value && !options.some((o) => o.value === value));
  const [hex, setHex] = useState(custom ? value : fallback);
  const swatch = colourHex(options, value, fallback);

  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="h-8 w-8 shrink-0 rounded-md border"
          style={{ backgroundColor: swatch }}
        />
        <select
          className="h-9 flex-1 rounded-md border bg-background px-2 text-sm"
          aria-label={label}
          disabled={readOnly}
          value={custom ? CUSTOM : value}
          onChange={(e) => {
            if (e.target.value === CUSTOM) onChange(isValidHexColour(hex) ? hex : fallback);
            else onChange(e.target.value);
          }}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
          <option value={CUSTOM}>Custom colour…</option>
        </select>
      </div>
      {custom && (
        <div className="space-y-1">
          <Input
            className="h-8 font-mono text-xs"
            placeholder="#2A7140"
            value={hex}
            disabled={readOnly}
            onChange={(e) => {
              const next = e.target.value;
              setHex(next);
              if (isValidHexColour(next)) onChange(next);
            }}
          />
          {!isValidHexColour(hex) && (
            <p className="text-xs text-destructive">Use a hex colour such as #2A7140.</p>
          )}
        </div>
      )}
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
  const colourable = !["divider", "footer"].includes(block.type);
  const bgHex = colourHex(
    BACKGROUND_OPTIONS,
    block.bgColor ?? block.background ?? "white",
    NEWSLETTER_BRAND.white,
  );
  const textHex = colourHex(TEXT_OPTIONS, block.textColor ?? "ink", NEWSLETTER_BRAND.ink);
  const warning = colourable ? contrastWarning(bgHex, textHex) : null;

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
        <NewsletterImageField value={block.image} readOnly={readOnly} onChange={(image) => onChange({ image })} />
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
              <NewsletterImageField
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

      {colourable && (
        <div className="space-y-2 border-t pt-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <ColourField
              label="Background"
              options={BACKGROUND_OPTIONS}
              value={block.bgColor ?? block.background ?? "white"}
              fallback={NEWSLETTER_BRAND.white}
              readOnly={readOnly}
              onChange={(v) =>
                onChange({
                  bgColor: v,
                  background: v === "white" ? "white" : "soft",
                })
              }
            />
            <ColourField
              label="Text"
              options={TEXT_OPTIONS}
              value={block.textColor ?? "ink"}
              fallback={NEWSLETTER_BRAND.ink}
              readOnly={readOnly}
              onChange={(v) => onChange({ textColor: v })}
            />
          </div>
          {warning && (
            <p className="text-xs text-amber-600 dark:text-amber-400" data-testid="contrast-warning">
              {warning}
            </p>
          )}
          {showCta && (
            <div className="grid gap-3 sm:grid-cols-2">
              <ColourField
                label="Button background"
                options={BUTTON_BACKGROUND_OPTIONS}
                value={block.buttonBgColor ?? "green"}
                fallback={NEWSLETTER_BRAND.green}
                readOnly={readOnly}
                onChange={(v) => onChange({ buttonBgColor: v })}
              />
              <ColourField
                label="Button text"
                options={BUTTON_TEXT_OPTIONS}
                value={block.buttonTextColor ?? "white"}
                fallback={NEWSLETTER_BRAND.white}
                readOnly={readOnly}
                onChange={(v) => onChange({ buttonTextColor: v })}
              />
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
