import { useState, useRef, ChangeEvent, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { supabase as lovableCloud } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { useVineyard } from "@/context/VineyardContext";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Paperclip, X } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Match iOS support form categories exactly.
const CATEGORY_OPTIONS = [
  { value: "general", label: "General" },
  { value: "bug", label: "Bug / Issue" },
  { value: "feature", label: "Feature Request" },
  { value: "account", label: "Account" },
  { value: "billing", label: "Billing" },
  { value: "other", label: "Other" },
];

const MAX_ATTACHMENTS = 5;
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"];

interface Attachment {
  name: string;
  mime: string;
  size: number;
  base64: string;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.includes(",") ? result.split(",")[1] : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function SupportRequestSheet({ open, onOpenChange }: Props) {
  const { user } = useAuth();
  const { selectedVineyardId, memberships, currentRole } = useVineyard();
  const { pathname } = useLocation();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [category, setCategory] = useState("general");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const vineyardName =
    memberships.find((m) => m.vineyard_id === selectedVineyardId)?.vineyard_name ?? null;

  const submitterName =
    (user?.user_metadata?.full_name as string | undefined) ??
    (user?.user_metadata?.name as string | undefined) ??
    null;
  const submitterEmail = user?.email ?? null;

  // Editable contact fields, prefilled from auth.
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");

  useEffect(() => {
    if (open) {
      setContactName(submitterName ?? "");
      setContactEmail(submitterEmail ?? "");
    }
  }, [open, submitterName, submitterEmail]);

  const reset = () => {
    setCategory("general");
    setSubject("");
    setMessage("");
    setAttachments([]);
  };

  const handleFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    if (attachments.length + files.length > MAX_ATTACHMENTS) {
      toast.error(`Maximum ${MAX_ATTACHMENTS} attachments`);
      return;
    }
    const next: Attachment[] = [];
    for (const f of files) {
      if (!ALLOWED_MIME.includes(f.type)) {
        toast.error(`${f.name}: unsupported type (use JPG, PNG, or WebP)`);
        return;
      }
      if (f.size > MAX_BYTES) {
        toast.error(`${f.name}: exceeds 10 MB`);
        return;
      }
      const base64 = await fileToBase64(f);
      next.push({ name: f.name, mime: f.type, size: f.size, base64 });
    }
    setAttachments((prev) => [...prev, ...next]);
  };

  const removeAttachment = (idx: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  };

  // Map portal category to the request_type values the edge function accepts.
  // The backend currently allows: support | bug | feature | other.
  const mapToRequestType = (cat: string): string => {
    switch (cat) {
      case "general":
        return "support";
      case "bug":
        return "bug";
      case "feature":
        return "feature";
      case "account":
      case "billing":
      case "other":
      default:
        return "other";
    }
  };

  const submit = async () => {
    if (!subject.trim()) {
      toast.error("Please add a subject");
      return;
    }
    if (!message.trim()) {
      toast.error("Please add details");
      return;
    }
    setSubmitting(true);
    try {
      const categoryLabel =
        CATEGORY_OPTIONS.find((c) => c.value === category)?.label ?? category;
      const payload = {
        request_type: mapToRequestType(category),
        // Prefix the subject with the iOS-style category label so admins
        // see the full taxonomy (Account/Billing) even though backend
        // request_type collapses to the allowed set.
        subject: `[${categoryLabel}] ${subject.trim()}`,
        message: message.trim(),
        page_path: pathname,
        browser_info: navigator.userAgent,
        vineyard_id: selectedVineyardId,
        vineyard_name: vineyardName,
        user_id: user?.id ?? null,
        user_email: contactEmail.trim() || submitterEmail,
        user_name: contactName.trim() || submitterName,
        user_role: currentRole,
        attachments: attachments.map((a) => ({
          name: a.name,
          mime: a.mime,
          base64: a.base64,
        })),
      };
      const { data, error } = await lovableCloud.functions.invoke(
        "submit-support-request",
        { body: payload },
      );
      if (error) throw error;
      const result = data as { ok?: boolean; email_queued?: boolean; email_error?: string | null };
      if (!result?.ok) throw new Error("Submission failed");
      if (result.email_queued === false) {
        toast.success("Request received. Email delivery is pending — your message has been saved.");
      } else {
        toast.success("Thanks! Your message has been sent.");
      }
      reset();
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong";
      toast.error(`Could not submit: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(v) => !submitting && onOpenChange(v)}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Contact Support</SheetTitle>
          <SheetDescription>What can we help with?</SheetDescription>
        </SheetHeader>
        <div className="mt-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="sr-category">Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger id="sr-category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="sr-subject">Subject</Label>
            <Input
              id="sr-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject"
              maxLength={200}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sr-message">Details</Label>
            <Textarea
              id="sr-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Describe your question, issue, or request…"
              rows={8}
              maxLength={5000}
            />
            <p className="text-xs text-muted-foreground">{message.length}/5000</p>
          </div>
          <div className="space-y-2">
            <Label>Attachments</Label>
            <input
              ref={fileInputRef}
              type="file"
              accept={ALLOWED_MIME.join(",")}
              multiple
              className="hidden"
              onChange={handleFiles}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={attachments.length >= MAX_ATTACHMENTS}
            >
              <Paperclip className="mr-2 h-4 w-4" />
              Add attachment
            </Button>
            <p className="text-xs text-muted-foreground">
              Optional. Add up to {MAX_ATTACHMENTS} photos or screenshots.
            </p>
            {attachments.length > 0 && (
              <ul className="space-y-1">
                {attachments.map((a, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between rounded-md border bg-muted/40 px-2 py-1 text-sm"
                  >
                    <span className="truncate">
                      {a.name}{" "}
                      <span className="text-muted-foreground">
                        ({Math.round(a.size / 1024)} KB)
                      </span>
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => removeAttachment(i)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-3 pt-2">
            <h3 className="text-sm font-semibold">Contact</h3>
            <div className="space-y-2">
              <Label htmlFor="sr-contact-name">Name</Label>
              <Input
                id="sr-contact-name"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="Your name"
                maxLength={120}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sr-contact-email">Email</Label>
              <Input
                id="sr-contact-email"
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="you@example.com"
                maxLength={255}
              />
            </div>
            <div className="space-y-2">
              <Label>Vineyard</Label>
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                {vineyardName ?? "—"}
              </div>
            </div>
          </div>

          <details className="rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none">Diagnostic context</summary>
            <div className="mt-2 space-y-1">
              <div>
                <span className="font-medium text-foreground">Page:</span> {pathname}
              </div>
              <div>
                <span className="font-medium text-foreground">Role:</span>{" "}
                {currentRole ?? "—"}
              </div>
            </div>
          </details>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="button" onClick={submit} disabled={submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Send
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
