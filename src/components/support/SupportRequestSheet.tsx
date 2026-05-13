import { useState, useRef, ChangeEvent } from "react";
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

const TYPE_OPTIONS = [
  { value: "support", label: "Support / question" },
  { value: "bug", label: "Bug report" },
  { value: "feature", label: "Feature request" },
  { value: "other", label: "Other" },
];

const MAX_ATTACHMENTS = 4;
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
      // Strip "data:...;base64," prefix
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

  const [requestType, setRequestType] = useState("support");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const vineyardName =
    memberships.find((m) => m.vineyard_id === selectedVineyardId)?.vineyard_name ?? null;

  const reset = () => {
    setRequestType("support");
    setSubject("");
    setMessage("");
    setAttachments([]);
  };

  const handleFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // allow re-pick
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

  const submit = async () => {
    if (!subject.trim()) {
      toast.error("Please add a subject");
      return;
    }
    if (!message.trim()) {
      toast.error("Please describe your request");
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        request_type: requestType,
        subject: subject.trim(),
        message: message.trim(),
        page_path: pathname,
        browser_info: navigator.userAgent,
        vineyard_id: selectedVineyardId,
        vineyard_name: vineyardName,
        user_id: user?.id ?? null,
        user_email: user?.email ?? null,
        user_name:
          (user?.user_metadata?.full_name as string | undefined) ??
          (user?.user_metadata?.name as string | undefined) ??
          null,
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
      const result = data as { ok?: boolean; email_sent?: boolean; email_error?: string | null };
      if (!result?.ok) throw new Error("Submission failed");
      if (result.email_sent === false) {
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
          <SheetTitle>Contact support</SheetTitle>
          <SheetDescription>
            Report a bug, request a feature, or ask a question. Goes straight to the team.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="sr-type">Type</Label>
            <Select value={requestType} onValueChange={setRequestType}>
              <SelectTrigger id="sr-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPE_OPTIONS.map((o) => (
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
              placeholder="Brief summary"
              maxLength={200}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sr-message">Message</Label>
            <Textarea
              id="sr-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="What's happening? Steps to reproduce, expected behaviour, etc."
              rows={8}
              maxLength={5000}
            />
            <p className="text-xs text-muted-foreground">{message.length}/5000</p>
          </div>
          <div className="space-y-2">
            <Label>Attachments (optional)</Label>
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
              Add screenshot
            </Button>
            <p className="text-xs text-muted-foreground">
              Up to {MAX_ATTACHMENTS} images, max 10 MB each (JPG, PNG, WebP).
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

          <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
            <div>
              <span className="font-medium text-foreground">Vineyard:</span>{" "}
              {vineyardName ?? "—"}
            </div>
            <div>
              <span className="font-medium text-foreground">Page:</span> {pathname}
            </div>
            <div>
              <span className="font-medium text-foreground">From:</span>{" "}
              {user?.email ?? "Not signed in"}
            </div>
          </div>

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
