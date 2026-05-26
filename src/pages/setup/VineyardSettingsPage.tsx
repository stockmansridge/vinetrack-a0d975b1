import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Archive,
  ImageOff,
  Loader2,
  Save,
  Upload,
} from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { useVineyard } from "@/context/VineyardContext";
import { useToast } from "@/hooks/use-toast";
import { useVineyardLogo } from "@/hooks/useVineyardLogo";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { CreateVineyardDialog } from "@/components/vineyard/CreateVineyardDialog";
import { PendingInvitationsSection } from "@/components/invites/PendingInvitesModal";
import {
  archiveVineyard,
  describeVineyardError,
  fetchVineyard,
  removeVineyardLogo,
  updateVineyardNameCountry,
  uploadVineyardLogo,
} from "@/lib/vineyardSettingsQuery";

export default function VineyardSettingsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { selectedVineyardId, currentRole, memberships } = useVineyard();
  const isOwner = currentRole === "owner";
  const canEdit = isOwner || currentRole === "manager";
  const qc = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const vQuery = useQuery({
    queryKey: ["vineyard-settings", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchVineyard(selectedVineyardId!),
  });

  const { data: logoUrl } = useVineyardLogo();

  const [name, setName] = useState("");
  const [country, setCountry] = useState("");

  useEffect(() => {
    if (!vQuery.data) return;
    setName(vQuery.data.name ?? "");
    setCountry(vQuery.data.country ?? "");
  }, [vQuery.data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!selectedVineyardId) throw new Error("No vineyard selected");
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Vineyard name is required");
      await updateVineyardNameCountry(selectedVineyardId, {
        name: trimmed,
        country: country.trim() === "" ? null : country.trim(),
      });
    },
    onSuccess: () => {
      toast({ title: "Vineyard updated", description: "Synced with iOS." });
      qc.invalidateQueries({ queryKey: ["vineyard-settings", selectedVineyardId] });
      qc.invalidateQueries({ queryKey: ["memberships", user?.id] });
    },
    onError: (e) =>
      toast({
        title: "Couldn't save changes",
        description: describeVineyardError(e),
        variant: "destructive",
      }),
  });

  const uploadLogo = useMutation({
    mutationFn: async (file: File) => {
      if (!selectedVineyardId) throw new Error("No vineyard selected");
      return uploadVineyardLogo(selectedVineyardId, file);
    },
    onSuccess: () => {
      toast({ title: "Logo updated" });
      qc.invalidateQueries({ queryKey: ["vineyard-settings", selectedVineyardId] });
      qc.invalidateQueries({ queryKey: ["vineyard-logo", selectedVineyardId] });
    },
    onError: (e) =>
      toast({
        title: "Couldn't upload logo",
        description: describeVineyardError(e),
        variant: "destructive",
      }),
  });

  const removeLogo = useMutation({
    mutationFn: async () => {
      if (!selectedVineyardId) throw new Error("No vineyard selected");
      await removeVineyardLogo(selectedVineyardId);
    },
    onSuccess: () => {
      toast({ title: "Logo removed" });
      qc.invalidateQueries({ queryKey: ["vineyard-settings", selectedVineyardId] });
      qc.invalidateQueries({ queryKey: ["vineyard-logo", selectedVineyardId] });
    },
    onError: (e) =>
      toast({
        title: "Couldn't remove logo",
        description: describeVineyardError(e),
        variant: "destructive",
      }),
  });

  const archive = useMutation({
    mutationFn: async () => {
      if (!selectedVineyardId) throw new Error("No vineyard selected");
      await archiveVineyard(selectedVineyardId);
    },
    onSuccess: () => {
      toast({
        title: "Vineyard archived",
        description: "Hidden from normal use. Historical records are kept.",
      });
      qc.invalidateQueries({ queryKey: ["memberships", user?.id] });
      // Drop the selection so the user is sent back to the picker.
      localStorage.removeItem("vt_selected_vineyard");
      navigate("/select-vineyard", { replace: true });
    },
    onError: (e) =>
      toast({
        title: "Couldn't archive vineyard",
        description: describeVineyardError(e),
        variant: "destructive",
      }),
  });

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!/^image\//.test(f.type)) {
      toast({ title: "Please choose an image file", variant: "destructive" });
      return;
    }
    if (f.size > 5 * 1024 * 1024) {
      toast({ title: "Image must be under 5 MB", variant: "destructive" });
      return;
    }
    uploadLogo.mutate(f);
  };

  const currentName =
    memberships.find((m) => m.vineyard_id === selectedVineyardId)?.vineyard_name ?? "";

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Vineyard Settings</h1>
          <p className="text-sm text-muted-foreground">
            Manage the currently selected vineyard. Changes sync to iOS in
            real time.
          </p>
        </div>
        <CreateVineyardDialog />
      </div>

      {!canEdit && (
        <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Read-only — only owners and managers can edit vineyard settings.
        </div>
      )}

      {vQuery.error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {describeVineyardError(vQuery.error)}
        </div>
      )}

      <PendingInvitationsSection
        title="Pending invitations"
        description="If you were invited to another vineyard, you can accept it here later."
      />

      <Card className="p-4 space-y-4">
        <div className="flex items-center gap-4">
          <div className="h-20 w-20 rounded-xl overflow-hidden border bg-muted/40 flex items-center justify-center">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={`${currentName || "Vineyard"} logo`}
                className="h-full w-full object-cover"
              />
            ) : (
              <ImageOff className="h-6 w-6 text-muted-foreground" />
            )}
          </div>
          <div className="space-y-1.5">
            <div className="text-sm font-medium">Vineyard logo</div>
            <p className="text-xs text-muted-foreground max-w-sm">
              JPG, PNG or WEBP. Square images work best. Up to 5 MB.
            </p>
            {canEdit && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={onPickFile}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadLogo.isPending}
                >
                  {uploadLogo.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4 mr-2" />
                  )}
                  {vQuery.data?.logo_path ? "Replace logo" : "Upload logo"}
                </Button>
                {vQuery.data?.logo_path && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => removeLogo.mutate()}
                    disabled={removeLogo.isPending}
                  >
                    Remove
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </Card>

      <Card className="p-4 space-y-4">
        {vQuery.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="vname">Vineyard name</Label>
                <Input
                  id="vname"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={!canEdit}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="vcountry">Country</Label>
                <Input
                  id="vcountry"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  placeholder="e.g. Australia"
                  disabled={!canEdit}
                />
              </div>
            </div>
            {canEdit && (
              <div className="flex items-center justify-end gap-2 pt-2">
                <Button
                  onClick={() => save.mutate()}
                  disabled={
                    save.isPending ||
                    !name.trim() ||
                    (name.trim() === (vQuery.data?.name ?? "") &&
                      country.trim() === (vQuery.data?.country ?? ""))
                  }
                >
                  {save.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4 mr-2" />
                  )}
                  Save changes
                </Button>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Location, coordinates and timezone are managed in{" "}
              <button
                className="underline underline-offset-2"
                onClick={() => navigate("/setup/vineyard-location")}
              >
                Vineyard Location
              </button>
              .
            </p>
          </>
        )}
      </Card>

      {isOwner && (
        <Card className="p-4 border-destructive/30">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive mt-0.5" />
              <div>
                <div className="text-sm font-medium">Archive vineyard</div>
                <p className="text-xs text-muted-foreground max-w-md">
                  Hides this vineyard from normal use across Lovable and iOS.
                  Paddocks, trips, spray records, pins and reports are kept.
                </p>
              </div>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={archive.isPending}
                >
                  {archive.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Archive className="h-4 w-4 mr-2" />
                  )}
                  Archive
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Archive this vineyard?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will hide it from normal use but will not delete its
                    historical records.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => archive.mutate()}
                  >
                    Archive vineyard
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </Card>
      )}
    </div>
  );
}
