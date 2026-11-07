import { useState } from "react";
import { Pencil, RefreshCw, Save, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AdminGate, AdminPageHeader } from "./_shared";
import { releaseError, releaseForm, releaseValidation, raisesMinimum, useAppReleasePolicies, useSaveAppReleasePolicy,
  type AppReleasePolicy, type ReleasePlatform, type ReleaseForm } from "@/lib/appReleases";

const PLATFORMS: { platform: ReleasePlatform; label: string }[] = [
  { platform: "ios", label: "iOS (App Store)" }, { platform: "android", label: "Android (Google Play)" },
];

export default function AppReleasesPage() {
  return <AdminGate><AppReleasesContent /></AdminGate>;
}
function AppReleasesContent() {
  const list = useAppReleasePolicies();
  return <div className="p-6 space-y-4 min-w-0">
    <AdminPageHeader title="App Releases" actions={<Button variant="outline" disabled={list.isFetching} onClick={() => void list.refetch()}>
      <RefreshCw className="h-4 w-4 mr-2" />Refresh
    </Button>} />
    <div className="text-sm text-muted-foreground space-y-2">
      <p>Set Latest build only after the release is live in the store. Use the store build number: iOS = the App Store build (e.g. 238), Android = the versionCode (e.g. 1794000017), not the version name.</p>
      <p>Raise Minimum supported build only when older versions must stop working.</p>
    </div>
    {list.isPending && <p className="text-sm text-muted-foreground">Loading release policies…</p>}
    {list.error && <p role="alert" className="text-sm text-destructive">{releaseError(list.error)}</p>}
    {list.data && <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 min-w-0">
      {PLATFORMS.map(({ platform, label }) => {
        const row = list.data.find(r => r.platform === platform);
        return row ? <ReleasePolicyCard key={platform} row={row} label={label} readFailed={!!list.error} />
          : <Card key={platform} className="p-5"><h2 className="text-lg font-semibold">{label}</h2><p className="text-sm text-muted-foreground mt-3">No policy was returned for this platform. Refresh to check again.</p></Card>;
      })}
    </div>}
  </div>;
}

export function ReleasePolicyCard({ row, label, readFailed = false }: { row: AppReleasePolicy; label: string; readFailed?: boolean }) {
  const [form, setForm] = useState<ReleaseForm | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = useSaveAppReleasePolicy();
  const errors = form ? releaseValidation(form) : [];
  const raised = form ? raisesMinimum(row, form) : false;
  const update = <K extends keyof ReleaseForm>(key: K, value: ReleaseForm[K]) => {
    if (form) setForm({ ...form, [key]: value });
  };
  const submit = async () => {
    if (!form || errors.length || (raised && !understood) || readFailed || save.isPending) return;
    setError(null);
    try {
      await save.mutateAsync({ platform: row.platform, form });
      setConfirming(false); setForm(null);
      toast.success(`${label} release policy saved`);
    } catch (e) { setError(releaseError(e)); }
  };
  return <Card className="p-5 space-y-4 min-w-0">
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <h2 className="text-lg font-semibold flex items-center gap-2"><Smartphone className="h-5 w-5 text-muted-foreground" />{label}</h2>
      <Badge variant={row.active ? "default" : "secondary"}>{row.active ? "Active" : "Inactive"}</Badge>
    </div>
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
      <dt className="text-muted-foreground">Latest version / build</dt><dd className="break-words">{row.latest_version || "—"} / {row.latest_build}</dd>
      <dt className="text-muted-foreground">Minimum version / build</dt><dd className="break-words">{row.minimum_supported_version || "—"} / {row.minimum_supported_build}</dd>
      <dt className="text-muted-foreground">Prompt title</dt><dd className="break-words">{row.update_title || "—"}</dd>
      <dt className="text-muted-foreground">Prompt message</dt><dd className="whitespace-pre-wrap break-words">{row.update_message || "—"}</dd>
      <dt className="text-muted-foreground">Store URL</dt><dd className="break-all">{row.store_url || "—"}</dd>
      <dt className="text-muted-foreground">Last updated</dt><dd>{row.updated_at ? new Date(row.updated_at).toLocaleString() : "—"}</dd>
    </dl>
    {!form ? <Button variant="outline" disabled={readFailed} onClick={() => { setForm(releaseForm(row)); setError(null); }}><Pencil className="h-4 w-4 mr-2" />Edit</Button> :
      <form className="border-t border-border pt-4 space-y-4" onSubmit={e => { e.preventDefault(); if (!errors.length && !readFailed) { setUnderstood(false); setError(null); setConfirming(true); } }}>
        <fieldset disabled={save.isPending || confirming} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {([['latest_version', 'Latest version'], ['latest_build', 'Latest build'], ['minimum_supported_version', 'Minimum supported version'], ['minimum_supported_build', 'Minimum supported build']] as const).map(([key, name]) => <div key={key} className="space-y-1">
              <Label htmlFor={`${row.platform}-${key}`}>{name}</Label>
              <Input id={`${row.platform}-${key}`} type={key.endsWith('build') ? 'number' : 'text'} min={key.endsWith('build') ? 0 : undefined} step={key.endsWith('build') ? 1 : undefined}
                placeholder={key.endsWith('version') ? '3.2.0' : undefined} value={form[key]} onChange={e => update(key, e.target.value)} />
            </div>)}
          </div>
          <div className="space-y-1"><Label htmlFor={`${row.platform}-title`}>Prompt title (optional)</Label><Input id={`${row.platform}-title`} maxLength={100} value={form.update_title} onChange={e => update('update_title', e.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor={`${row.platform}-message`}>Prompt message (optional)</Label><Textarea id={`${row.platform}-message`} maxLength={800} rows={4} value={form.update_message} onChange={e => update('update_message', e.target.value)} /></div>
          <div className="flex items-center gap-3"><Switch id={`${row.platform}-active`} checked={form.active} onCheckedChange={v => update('active', v)} /><Label htmlFor={`${row.platform}-active`}>Active</Label></div>
          <div className="space-y-1"><Label htmlFor={`${row.platform}-reason`}>Reason for change (required)</Label><Textarea id={`${row.platform}-reason`} value={form.reason} onChange={e => update('reason', e.target.value)} required rows={2} /></div>
        </fieldset>
        {errors.length > 0 && <ul className="text-sm text-destructive space-y-1">{errors.map(msg => <li key={msg}>{msg}</li>)}</ul>}
        <div className="flex gap-2"><Button type="submit" disabled={errors.length > 0 || save.isPending || readFailed || confirming}><Save className="h-4 w-4 mr-2" />Save</Button><Button type="button" variant="ghost" disabled={save.isPending || confirming} onClick={() => setForm(null)}>Cancel</Button></div>
      </form>}
    <Dialog open={confirming} onOpenChange={open => { if (!save.isPending) setConfirming(open); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>Confirm {label} release policy</DialogTitle><DialogDescription>Review the effect before saving this change.</DialogDescription></DialogHeader>
        {form && <div className="space-y-3 text-sm">
          <p>Latest: {form.latest_version || "—"} · build {form.latest_build}. Minimum: {form.minimum_supported_version || "—"} · build {form.minimum_supported_build}.</p>
          {form.active ? <p>Users on builds below {form.latest_build} will see an 'Update available' prompt they can postpone for 24 hours.</p> : <p>No update prompts will be shown on this platform.</p>}
          {raised && <><p className="text-destructive font-semibold">Users on builds below {form.minimum_supported_build} will be BLOCKED from using the app until they update.</p>
            {!form.active && <p className="text-muted-foreground">This minimum will take effect when update prompts are active.</p>}
            <div className="flex items-center gap-2"><Checkbox id={`${row.platform}-understand`} checked={understood} disabled={save.isPending} onCheckedChange={v => setUnderstood(v === true)} /><Label htmlFor={`${row.platform}-understand`}>I understand</Label></div></>}
          <p className="whitespace-pre-wrap break-words">Reason: {form.reason}</p>
        </div>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button variant="ghost" disabled={save.isPending} onClick={() => setConfirming(false)}>Cancel</Button><Button disabled={save.isPending || errors.length > 0 || (raised && !understood) || readFailed} onClick={() => void submit()}>{save.isPending ? "Saving…" : "Confirm change"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </Card>;
}