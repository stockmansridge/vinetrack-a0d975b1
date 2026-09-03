import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { CheckCircle2, Info, Save, ShieldAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { toast } from "sonner";
import { useIsSystemAdmin } from "@/lib/systemAdmin";
import {
  CANNED_MAINTENANCE_MESSAGES,
  DEFAULT_MAINTENANCE_MESSAGE,
  useMaintenance,
  useSaveMaintenance,
} from "@/lib/maintenanceMode";

export default function MaintenanceModePage() {
  const { isAdmin, loading: accessLoading } = useIsSystemAdmin();
  const { data, isLoading, error } = useMaintenance();
  const save = useSaveMaintenance();
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState(DEFAULT_MAINTENANCE_MESSAGE);

  useEffect(() => {
    if (!data) return;
    setEnabled(data.is_enabled);
    setMessage(data.message);
  }, [data]);

  if (accessLoading) return <div className="p-6 text-sm text-muted-foreground">Checking access…</div>;
  if (!isAdmin) return <Navigate to="/dashboard" replace />;

  const selectMessage = (value: string) => {
    const canned = CANNED_MAINTENANCE_MESSAGES.find((item) => item.label === value);
    if (canned) setMessage(canned.message);
  };

  const onSave = async () => {
    const trimmed = message.trim();
    if (!trimmed) {
      toast.error("Enter a maintenance message first");
      return;
    }
    try {
      await save.mutateAsync({ isEnabled: enabled, message: trimmed });
      toast.success(enabled ? "Maintenance mode enabled" : "Maintenance mode disabled");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save maintenance settings");
    }
  };

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-amber-600 dark:text-amber-400" />
          <h1 className="text-2xl font-semibold">Maintenance Mode</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Temporarily replace the sign-in form with a message for everyone visiting the portal.
        </p>
      </div>

      <Card className="border-amber-500/30 bg-amber-500/5 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Label htmlFor="maintenance-enabled" className="text-base font-semibold">
              Maintenance mode
            </Label>
            <p className="mt-1 text-sm text-muted-foreground">
              When enabled, users cannot sign in until you turn this off.
            </p>
          </div>
          <Switch
            id="maintenance-enabled"
            checked={enabled}
            onCheckedChange={setEnabled}
            disabled={save.isPending}
            aria-label="Enable maintenance mode"
          />
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <div>
          <Label htmlFor="canned-message">Use a saved response</Label>
          <Select onValueChange={selectMessage}>
            <SelectTrigger id="canned-message" className="mt-2">
              <SelectValue placeholder="Choose a canned response" />
            </SelectTrigger>
            <SelectContent>
              {CANNED_MAINTENANCE_MESSAGES.map((item) => (
                <SelectItem key={item.label} value={item.label}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="maintenance-message">Message shown on the login screen</Label>
            <span className="text-xs text-muted-foreground">{message.length}/600</span>
          </div>
          <Textarea
            id="maintenance-message"
            className="mt-2 min-h-32"
            maxLength={600}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder={DEFAULT_MAINTENANCE_MESSAGE}
          />
        </div>

        <div className="flex items-start gap-2 border-t pt-4 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>The setting is saved centrally and is checked each time the login screen opens.</span>
        </div>

        <div className="flex justify-end">
          <Button onClick={onSave} disabled={isLoading || save.isPending || !message.trim()}>
            {save.isPending ? <Save className="mr-2 h-4 w-4 animate-pulse" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
            {save.isPending ? "Saving…" : "Save maintenance settings"}
          </Button>
        </div>
      </Card>

      {error && (
        <p className="text-sm text-destructive">
          Could not load maintenance settings: {error instanceof Error ? error.message : String(error)}
        </p>
      )}
    </div>
  );
}
