import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useVineyard } from "@/context/VineyardContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createVineyardWithOwner,
  describeVineyardError,
} from "@/lib/vineyardSettingsQuery";

interface Props {
  trigger?: React.ReactNode;
  onCreated?: (vineyardId: string) => void;
}

export function CreateVineyardDialog({ trigger, onCreated }: Props) {
  const { user } = useAuth();
  const { selectVineyard } = useVineyard();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
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
    onSuccess: (vineyard) => {
      toast({
        title: "Vineyard created",
        description: `${vineyard.name} is ready to use.`,
      });
      qc.invalidateQueries({ queryKey: ["memberships", user?.id] });
      selectVineyard(vineyard.id);
      onCreated?.(vineyard.id);
      setName("");
      setCountry("");
      setOpen(false);
    },
    onError: (e) =>
      toast({
        title: "Couldn't create vineyard",
        description: describeVineyardError(e),
        variant: "destructive",
      }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm">
            <Plus className="h-4 w-4 mr-2" /> New vineyard
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a new vineyard</DialogTitle>
          <DialogDescription>
            You'll be set as the owner. Switching is instant — the new
            vineyard will appear in your selector and on iOS.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="cv-name">Vineyard name</Label>
            <Input
              id="cv-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Coonawarra Block 4"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cv-country">Country (optional)</Label>
            <Input
              id="cv-country"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              placeholder="e.g. Australia"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={create.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => create.mutate()}
            disabled={create.isPending || !name.trim()}
          >
            {create.isPending && (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            )}
            Create vineyard
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
