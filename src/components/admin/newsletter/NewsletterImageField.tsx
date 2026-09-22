import { useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { NewsletterImageRef } from "@/lib/newsletter/blocks";
import { uploadNewsletterImage } from "@/lib/newsletter/imageUpload";
import { useToast } from "@/hooks/use-toast";

interface NewsletterImageFieldProps {
  value: NewsletterImageRef | null | undefined;
  label?: string;
  readOnly?: boolean;
  previewClassName?: string;
  onChange: (next: NewsletterImageRef | null) => void;
}

export function NewsletterImageField({
  value,
  label = "Image",
  readOnly,
  previewClassName = "h-20 w-28 rounded-md object-cover border",
  onChange,
}: NewsletterImageFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  return (
    <div className="space-y-2">
      <Label className="text-xs">{label}</Label>
      {value?.url ? (
        <div className="flex items-start gap-3">
          <img src={value.url} alt={value.alt ?? ""} className={previewClassName} />
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
                <X className="mr-1 h-4 w-4" /> Remove
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
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          setBusy(true);
          try {
            const uploaded = await uploadNewsletterImage(file);
            onChange({ url: uploaded.url, path: uploaded.path, alt: value?.alt ?? "" });
          } catch (error) {
            toast({
              title: "Couldn't upload the image",
              description: error instanceof Error ? error.message : String(error),
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