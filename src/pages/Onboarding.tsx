import { FormEvent, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useVineyard } from "@/context/VineyardContext";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import appIcon from "@/assets/vinetrack-app-icon.png";
import { BrandName } from "@/components/BrandName";
import { PageHead } from "@/components/PageHead";
import {
  createVineyardWithOwner,
  describeVineyardError,
} from "@/lib/vineyardSettingsQuery";
import { usePendingInvites } from "@/components/invites/PendingInvitesModal";



export default function Onboarding() {
  const { user, signOut, loading: authLoading } = useAuth();
  const { memberships, loading: vyLoading, selectVineyard } = useVineyard();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [country, setCountry] = useState("");

  const create = useMutation({
    mutationFn: async () => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Vineyard name is required");
      return createVineyardWithOwner({
        name: trimmed,
        country: country.trim() === "" ? null : country.trim(),
      });
    },
    onSuccess: async (vineyard) => {
      await qc.invalidateQueries({ queryKey: ["memberships", user?.id] });
      selectVineyard(vineyard.id);
      toast({ title: "Vineyard created", description: `${vineyard.name} is ready.` });
      navigate("/dashboard", { replace: true });
    },
    onError: (e) =>
      toast({
        title: "Couldn't create vineyard",
        description: describeVineyardError(e),
        variant: "destructive",
      }),
  });

  const { data: pendingInvites = [], isLoading: invitesLoading } = usePendingInvites();

  if (authLoading || vyLoading || invitesLoading) return <div className="p-8">Loading…</div>;
  // If user already has accessible vineyards, skip onboarding.
  if (memberships.length > 0) return <Navigate to="/select-vineyard" replace />;
  // If a pending invite is waiting, defer to the selector + invite modal.
  if (pendingInvites.length > 0) return <Navigate to="/select-vineyard" replace />;


  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  return (
    <>
      <PageHead
        title="Create your first vineyard"
        description="Set up your first vineyard in the VineTrack portal."
        path="/onboarding"
      />
      <div
        className="relative min-h-screen flex items-center justify-center p-4 overflow-hidden"
        style={{ background: "linear-gradient(135deg, #0F6E33 0%, #054721 50%, #022C17 100%)" }}
      >
        <div className="relative w-full max-w-md flex flex-col items-center gap-6 py-8">
          <div
            className="overflow-hidden bg-[#0B5128] ring-1 ring-white/25"
            style={{ width: 80, height: 80, borderRadius: 20, boxShadow: "0 8px 14px rgba(0,0,0,0.35)" }}
          >
            <img src={appIcon} alt="VineTrack" className="h-full w-full object-cover" />
          </div>

          <div className="text-center space-y-2">
            <h1
              className="text-white font-extrabold tracking-tight"
              style={{ fontSize: 28, lineHeight: 1.15, textShadow: "0 2px 2px rgba(0,0,0,0.28)" }}
            >
              Welcome to <BrandName className="text-white" />
            </h1>
            <p className="text-white/90 font-semibold text-[14px] leading-snug px-4">
              Create your first vineyard to start using the portal.
            </p>
          </div>

          <form
            onSubmit={onSubmit}
            className="w-full bg-white/95 backdrop-blur-sm p-5 space-y-4"
            style={{ borderRadius: 20, boxShadow: "0 10px 18px rgba(0,0,0,0.20)" }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="ob-name">Vineyard name</Label>
              <Input
                id="ob-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Coonawarra Block 4"
                maxLength={120}
                autoFocus
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ob-country">Country (optional)</Label>
              <Input
                id="ob-country"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                placeholder="e.g. Australia"
                maxLength={80}
              />
            </div>

            <Button
              type="submit"
              disabled={create.isPending || !name.trim()}
              className="w-full h-12 font-bold text-white"
              style={{ background: "#85B830", borderRadius: 13 }}
            >
              {create.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create vineyard
            </Button>

            <p className="text-[12px] text-center text-muted-foreground leading-snug">
              Were you invited to an existing vineyard? Ask the owner to confirm your
              invitation, then sign out and back in.
            </p>
          </form>

          <button
            type="button"
            onClick={() => signOut()}
            className="text-sm font-medium hover:underline"
            style={{ color: "#F0EBB8" }}
          >
            Sign out
          </button>
        </div>
      </div>
    </>
  );
}
