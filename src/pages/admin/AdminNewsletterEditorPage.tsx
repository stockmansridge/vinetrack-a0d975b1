import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Monitor, Plus, Save, Send, Smartphone, CalendarClock, Loader2 } from "lucide-react";
import { AdminGate, AdminPageHeader, AdminError } from "./_shared";
import { NewsletterBlockEditor } from "@/components/admin/newsletter/NewsletterBlockEditor";
import { NewsletterImageField } from "@/components/admin/newsletter/NewsletterImageField";
import {
  ADDABLE_BLOCKS,
  BLOCK_LABELS,
  addBlock,
  duplicateBlock,
  moveBlock,
  newsletterTemplates,
  removeBlock,
  updateBlock,
  type NewsletterBlock,
} from "@/lib/newsletter/blocks";
import {
  isEditableStatus,
  statusLabel,
  useAudienceCounts,
  useCancelSchedule,
  useNewsletterCampaign,
  useNewsletterPreview,
  useSaveNewsletter,
  useScheduleNewsletter,
  useSendNewsletter,
  useSendTestNewsletter,
  type SaveCampaignInput,
} from "@/lib/newsletterAdmin";
import { ensureNewsletterBrandingLogo } from "@/lib/newsletter/imageUpload";
import vinetrackLogo from "@/assets/vinetrack-logo.png";
import { useToast } from "@/hooks/use-toast";

const TZ = "Australia/Sydney";

function CountRow({ label, value, strong }: { label: string; value: number | string; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between py-1 text-sm ${strong ? "font-semibold" : ""}`}>
      <span className={strong ? "" : "text-muted-foreground"}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

export default function AdminNewsletterEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const isNew = !id || id === "new";
  const { data, error, isLoading } = useNewsletterCampaign(id);
  const save = useSaveNewsletter();
  const sendTest = useSendTestNewsletter();
  const send = useSendNewsletter();
  const schedule = useScheduleNewsletter();
  const cancelSchedule = useCancelSchedule();

  const [templateKey, setTemplateKey] = useState<string | null>(null);
  const [form, setForm] = useState<SaveCampaignInput>({
    name: "New newsletter",
    subject: "",
    preheader: "",
    from_name: "VineTrack",
    reply_to: "support@vinetrack.com.au",
    logo_url: null,
    logo_path: null,
    logo_alt: "VineTrack",
    audience_current_users: false,
    audience_subscribers: false,
    blocks: [],
    timezone: TZ,
  });
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [testAddresses, setTestAddresses] = useState("");
  const [confirmSend, setConfirmSend] = useState(false);
  const [scheduleValue, setScheduleValue] = useState("");

  const status = String(data?.campaign?.status ?? "draft");
  const readOnly = !isNew && !isEditableStatus(status);

  useEffect(() => {
    if (!data?.campaign) return;
    const c = data.campaign;
    setForm({
      id: c.id,
      name: c.name,
      subject: c.subject,
      preheader: c.preheader ?? "",
      from_name: c.from_name ?? "VineTrack",
      reply_to: c.reply_to ?? "support@vinetrack.com.au",
      logo_url: c.logo_url ?? null,
      logo_path: c.logo_path ?? null,
      logo_alt: c.logo_alt ?? "VineTrack",
      audience_current_users: c.audience_current_users,
      audience_subscribers: c.audience_subscribers,
      blocks: Array.isArray(c.blocks) ? c.blocks : [],
      scheduled_at: c.scheduled_at,
      timezone: c.timezone ?? TZ,
    });
  }, [data?.campaign]);

  // The delivered email needs a durable public logo URL, so make sure the
  // branded copy exists in the shared image bucket before any send.
  useEffect(() => {
    void ensureNewsletterBrandingLogo(vinetrackLogo);
  }, []);

  const audience = useAudienceCounts(form.audience_current_users, form.audience_subscribers);

  // Live preview: debounced so typing doesn't hammer the renderer, but always
  // rendered by the SAME server renderer that produces the delivered email.
  const [previewForm, setPreviewForm] = useState<SaveCampaignInput>(form);
  useEffect(() => {
    const t = setTimeout(() => setPreviewForm(form), 300);
    return () => clearTimeout(t);
  }, [form]);
  const preview = useNewsletterPreview(previewForm, true);
  const previewStale = previewForm !== form || preview.isFetching;

  const anyAudience = form.audience_current_users || form.audience_subscribers;
  const finalCount = audience.data?.counts.final ?? 0;
  const canSend = anyAudience && finalCount > 0 && !!form.subject.trim() && !!form.id && !readOnly;

  const templates = useMemo(() => newsletterTemplates(), []);

  const applyTemplate = (key: string) => {
    const tpl = templates.find((t) => t.key === key);
    if (!tpl) return;
    setTemplateKey(key);
    setForm((f) => ({
      ...f,
      name: tpl.name,
      subject: tpl.subject,
      preheader: tpl.preheader,
      blocks: tpl.blocks,
    }));
  };

  const doSave = async (): Promise<string | null> => {
    try {
      const saved = await save.mutateAsync(form);
      setForm((f) => ({ ...f, id: saved.id }));
      if (isNew) navigate(`/admin/newsletters/${saved.id}`, { replace: true });
      toast({ title: "Draft saved" });
      return saved.id;
    } catch (e) {
      toast({
        title: "Couldn't save",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
      return null;
    }
  };

  if (isNew && !templateKey) {
    return (
      <AdminGate>
        <AdminPageHeader
          title="New newsletter"
          subtitle="Choose a starting point"
          back="/admin/newsletters"
        />
        <div className="grid gap-3 sm:grid-cols-2 max-w-3xl">
          {templates.map((t) => (
            <Card key={t.key} className="p-4 space-y-2">
              <div className="font-semibold">{t.label}</div>
              <p className="text-sm text-muted-foreground">{t.description}</p>
              <Button size="sm" onClick={() => applyTemplate(t.key)}>Use this template</Button>
            </Card>
          ))}
        </div>
      </AdminGate>
    );
  }

  return (
    <AdminGate>
      <AdminPageHeader
        title={form.name || "Newsletter"}
        subtitle={`${statusLabel(status)}${readOnly ? " · read-only — duplicate to edit" : ""}`}
        back="/admin/newsletters"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" className="gap-1" disabled={readOnly || save.isPending} onClick={doSave}>
              <Save className="h-4 w-4" /> Save draft
            </Button>
            <Button
              className="gap-1"
              disabled={!canSend || send.isPending}
              onClick={() => setConfirmSend(true)}
            >
              {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send now
            </Button>
          </div>
        }
      />
      <AdminError error={error} />
      {isLoading && <Card className="p-4 text-sm text-muted-foreground">Loading…</Card>}

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <Card className="p-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">Internal name</Label>
                <Input value={form.name} disabled={readOnly} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Email subject</Label>
                <Input value={form.subject} disabled={readOnly} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-xs">Preview text (preheader)</Label>
                <Input value={form.preheader ?? ""} disabled={readOnly} onChange={(e) => setForm({ ...form, preheader: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">From name</Label>
                <Input value={form.from_name ?? ""} disabled={readOnly} onChange={(e) => setForm({ ...form, from_name: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Reply-to</Label>
                <Input value={form.reply_to ?? ""} disabled={readOnly} onChange={(e) => setForm({ ...form, reply_to: e.target.value })} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Sent from the existing VineTrack sender address. Unsubscribe handling, bounces and
              complaints are managed by the VineTrack email service — account and billing emails are
              never affected.
            </p>
          </Card>

          <Card className="p-4 space-y-3">
            <div>
              <div className="font-semibold text-sm">Branding</div>
              <p className="text-xs text-muted-foreground">
                Used in both the newsletter header and footer. Removing it restores the standard VineTrack logo.
              </p>
            </div>
            <NewsletterImageField
              label="Logo image"
              value={form.logo_url ? { url: form.logo_url, path: form.logo_path, alt: form.logo_alt } : null}
              readOnly={readOnly}
              previewClassName="h-16 w-44 rounded-md border bg-muted/30 object-contain p-2"
              onChange={(logo) =>
                setForm((current) => ({
                  ...current,
                  logo_url: logo?.url ?? null,
                  logo_path: logo?.path ?? null,
                  logo_alt: logo ? logo.alt ?? current.logo_alt ?? "VineTrack" : "VineTrack",
                }))
              }
            />
          </Card>
        </div>


        <div className="space-y-4">
          <Card className="p-4 space-y-3">
            <div className="font-semibold text-sm">Audience</div>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={form.audience_current_users}
                disabled={readOnly}
                onCheckedChange={(v) => setForm({ ...form, audience_current_users: v === true })}
              />
              <span>
                Current Users
                <span className="block text-xs text-muted-foreground">People with a VineTrack account</span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={form.audience_subscribers}
                disabled={readOnly}
                onCheckedChange={(v) => setForm({ ...form, audience_subscribers: v === true })}
              />
              <span>
                Newsletter Subscribers
                <span className="block text-xs text-muted-foreground">People subscribed on the website</span>
              </span>
            </label>

            {!anyAudience ? (
              <p className="text-xs text-muted-foreground">Tick at least one audience to see the numbers.</p>
            ) : audience.isLoading ? (
              <p className="text-xs text-muted-foreground">Working out the audience…</p>
            ) : audience.data ? (
              <div className="border-t pt-2">
                <CountRow label="Current Users" value={audience.data.counts.current_users} />
                <CountRow label="Newsletter Subscribers" value={audience.data.counts.subscribers} />
                <CountRow label="Appearing in both" value={audience.data.counts.in_both} />
                <div className="border-t my-1" />
                <CountRow label="Unique potential recipients" value={audience.data.counts.unique_potential} />
                <CountRow label="Suppressed / unsubscribed" value={audience.data.counts.suppressed} />
                <CountRow label="Invalid / missing email" value={audience.data.counts.invalid} />
                <div className="border-t my-1" />
                <CountRow label="Final recipients" value={audience.data.counts.final} strong />
                {audience.data.warnings.map((w) => (
                  <p key={w} className="text-xs text-amber-600 dark:text-amber-400 mt-1">{w}</p>
                ))}
              </div>
            ) : null}
          </Card>

          <Card className="p-4 space-y-2">
            <div className="font-semibold text-sm flex items-center gap-1">
              <CalendarClock className="h-4 w-4" /> Schedule
            </div>
            {status === "scheduled" && form.scheduled_at ? (
              <>
                <p className="text-sm">
                  Scheduled for{" "}
                  <strong>
                    {new Date(form.scheduled_at).toLocaleString("en-AU", { timeZone: TZ })}
                  </strong>{" "}
                  <span className="text-xs text-muted-foreground">Australia/Sydney</span>
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={cancelSchedule.isPending || !form.id}
                  onClick={async () => {
                    try {
                      if (!form.id) return;
                      await cancelSchedule.mutateAsync(form.id);
                      toast({ title: "Schedule cancelled — back to draft" });
                    } catch (e) {
                      toast({
                        title: "Couldn't cancel",
                        description: e instanceof Error ? e.message : String(e),
                        variant: "destructive",
                      });
                    }
                  }}
                >
                  Cancel schedule
                </Button>
              </>
            ) : (
              <>
                <Input
                  type="datetime-local"
                  value={scheduleValue}
                  disabled={readOnly}
                  onChange={(e) => setScheduleValue(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Times are Australia/Sydney.</p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canSend || !scheduleValue || schedule.isPending}
                  onClick={async () => {
                    const savedId = form.id ?? (await doSave());
                    if (!savedId) return;
                    try {
                      await schedule.mutateAsync({
                        id: savedId,
                        scheduledAt: new Date(scheduleValue).toISOString(),
                      });
                      toast({ title: "Newsletter scheduled" });
                    } catch (e) {
                      toast({
                        title: "Couldn't schedule",
                        description: e instanceof Error ? e.message : String(e),
                        variant: "destructive",
                      });
                    }
                  }}
                >
                  Schedule
                </Button>
              </>
            )}
          </Card>

          {(data?.versions ?? []).length > 0 && (
            <Card className="p-4 space-y-2">
              <div className="font-semibold text-sm">Send history</div>
              {(data?.versions ?? []).map((v) => (
                <div key={v.id} className="text-xs border-t pt-2">
                  <div className="font-medium">{statusLabel(v.status)}</div>
                  <div className="text-muted-foreground">
                    {v.sent_count} sent · {v.suppressed_count} suppressed · {v.failed_count} failed
                    {v.sender_email ? ` · by ${v.sender_email}` : ""}
                  </div>
                  {v.error_message && <div className="text-red-600">{v.error_message}</div>}
                </div>
              ))}
            </Card>
          )}
        </div>
      </div>

      {/* Build newsletter — full page width, editor beside the live preview on
          wide System Admin screens, stacked below ~1280px. */}
      <section className="mt-6 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Build newsletter
        </h2>
        <div className="grid gap-4 xl:grid-cols-[55fr_45fr] items-start">
          <div className="space-y-3 min-w-0">
            {form.blocks.map((block, index) => (
              <NewsletterBlockEditor
                key={block.id}
                block={block}
                index={index}
                total={form.blocks.length}
                readOnly={readOnly}
                onChange={(patch: Partial<NewsletterBlock>) =>
                  setForm((f) => ({ ...f, blocks: updateBlock(f.blocks, block.id, patch) }))
                }
                onMove={(delta: number) =>
                  setForm((f) => ({ ...f, blocks: moveBlock(f.blocks, block.id, delta) }))
                }
                onDuplicate={() =>
                  setForm((f) => ({ ...f, blocks: duplicateBlock(f.blocks, block.id) }))
                }
                onDelete={() => setForm((f) => ({ ...f, blocks: removeBlock(f.blocks, block.id) }))}
              />
            ))}
            {!readOnly && (
              <Card className="p-3">
                <div className="text-xs font-semibold text-muted-foreground mb-2">Add a block</div>
                <div className="flex flex-wrap gap-2">
                  {ADDABLE_BLOCKS.map((type) => (
                    <Button
                      key={type}
                      size="sm"
                      variant="outline"
                      className="gap-1"
                      onClick={() => setForm((f) => ({ ...f, blocks: addBlock(f.blocks, type) }))}
                    >
                      <Plus className="h-3.5 w-3.5" /> {BLOCK_LABELS[type]}
                    </Button>
                  ))}
                </div>
              </Card>
            )}
          </div>

          <div className="min-w-0 xl:sticky xl:top-4 space-y-3">
            <Card className="p-3 space-y-3">
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant={device === "desktop" ? "default" : "outline"}
                  className="gap-1"
                  onClick={() => setDevice("desktop")}
                >
                  <Monitor className="h-4 w-4" /> Desktop
                </Button>
                <Button
                  size="sm"
                  variant={device === "mobile" ? "default" : "outline"}
                  className="gap-1"
                  onClick={() => setDevice("mobile")}
                >
                  <Smartphone className="h-4 w-4" /> Mobile
                </Button>
                {previewStale && (
                  <span className="text-xs text-muted-foreground">Updating preview…</span>
                )}
              </div>
              <div className="flex justify-center bg-muted/40 rounded-md p-3 overflow-auto max-h-[calc(100vh-14rem)]">
                <iframe
                  title="Newsletter preview"
                  srcDoc={
                    preview.data?.html ??
                    "<p style='font-family:sans-serif;padding:24px'>Preview loading…</p>"
                  }
                  style={{
                    width: device === "mobile" ? 390 : 640,
                    flex: "none",
                    height: 900,
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 8,
                    background: "#fff",
                  }}
                />
              </div>
            </Card>

            <Card className="p-3 space-y-2">
              <div className="text-sm font-semibold">Send a test</div>
              <Input
                placeholder="you@example.com, someone@example.com"
                value={testAddresses}
                onChange={(e) => setTestAddresses(e.target.value)}
              />
              <Button
                size="sm"
                variant="outline"
                className="gap-1"
                disabled={!testAddresses.trim() || sendTest.isPending}
                onClick={async () => {
                  try {
                    const res = await sendTest.mutateAsync({
                      campaign: form,
                      recipients: testAddresses
                        .split(/[,\s;]+/)
                        .map((a) => a.trim())
                        .filter(Boolean),
                    });
                    toast({
                      title: "Test sent",
                      description: `${res.sent} test email${res.sent === 1 ? "" : "s"} on the way.`,
                    });
                  } catch (e) {
                    toast({
                      title: "Couldn't send the test",
                      description: e instanceof Error ? e.message : String(e),
                      variant: "destructive",
                    });
                  }
                }}
              >
                {sendTest.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Send test
              </Button>
              <p className="text-xs text-muted-foreground">
                Test emails use the real newsletter renderer and sender, and never touch the audience.
              </p>
            </Card>
          </div>
        </div>
      </section>


      <Dialog open={confirmSend} onOpenChange={setConfirmSend}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send “{form.subject || form.name}”?</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 pt-2 text-sm">
                <div>
                  Audience:
                  <ul className="list-disc pl-5">
                    {form.audience_current_users && <li>Current Users</li>}
                    {form.audience_subscribers && <li>Newsletter Subscribers</li>}
                  </ul>
                </div>
                <div className="font-semibold">{finalCount} unique recipients</div>
                <div>Subject: {form.subject}</div>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmSend(false)}>Cancel</Button>
            <Button
              disabled={send.isPending}
              onClick={async () => {
                if (!form.id) return;
                try {
                  let result = await send.mutateAsync({ id: form.id });
                  // Deliver in batches; resuming continues the SAME frozen
                  // version, so no duplicate campaign is ever created.
                  let guard = 0;
                  while (result.remaining > 0 && guard < 200) {
                    guard += 1;
                    result = await send.mutateAsync({ id: form.id, resume: true });
                  }
                  setConfirmSend(false);
                  toast({
                    title: result.remaining > 0 ? "Still sending" : "Newsletter sent",
                    description: `${result.sent} delivered in this pass${result.failed ? `, ${result.failed} failed` : ""}.`,
                  });
                } catch (e) {
                  toast({
                    title: "Send failed",
                    description: e instanceof Error ? e.message : String(e),
                    variant: "destructive",
                  });
                }
              }}
            >
              {send.isPending ? "Sending…" : "Send newsletter"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminGate>
  );
}
