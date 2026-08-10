import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { AlertTriangle } from "lucide-react";
import {
  previewUserDeletion,
  deleteUserPermanently,
  type DeleteUserPreview,
} from "@/lib/adminDeleteUser";

interface Props {
  user: { user_id: string; email: string | null; display_name: string | null } | null;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}

/** Two-step confirmation before permanently deleting a user, their data and
 *  any vineyard they solely own. System admins only. */
export function DeleteUserDialog({ user, onOpenChange, onDeleted }: Props) {
  const [step, setStep] = useState<1 | 2>(1);
  const [preview, setPreview] = useState<DeleteUserPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");

  const open = !!user;
  const expected = (user?.email ?? "").trim().toLowerCase();

  useEffect(() => {
    if (!user) return;
    setStep(1);
    setPreview(null);
    setError(null);
    setConfirmText("");
    setLoading(true);
    previewUserDeletion(user.user_id)
      .then((p) => setPreview(p))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [user]);

  const onConfirm = async () => {
    if (!user) return;
    setDeleting(true);
    try {
      const res = await deleteUserPermanently(user.user_id);
      toast({
        title: "User deleted",
        description:
          `${user.email ?? user.user_id} removed` +
          (res.deleted_vineyards?.length
            ? ` · ${res.deleted_vineyards.length} vineyard(s) deleted`
            : ""),
      });
      if (res.errors?.length) {
        // eslint-disable-next-line no-console
        console.warn("[admin-delete-user] partial errors", res.errors);
      }
      onOpenChange(false);
      onDeleted?.();
    } catch (e) {
      toast({
        title: "Delete failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onOpenChange(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            {step === 1 ? "Delete this user?" : "Final confirmation"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {user?.display_name || user?.email || user?.user_id}
            {user?.display_name && user?.email ? ` · ${user.email}` : ""}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {step === 1 && (
          <div className="space-y-3 text-sm">
            {loading && <p className="text-muted-foreground">Checking impact…</p>}
            {error && <p className="text-destructive">{error}</p>}
            {preview && (
              <>
                <p>
                  This permanently deletes the user's login, profile and all of their
                  VineTrack data. This cannot be undone.
                </p>
                <div>
                  <div className="font-medium">
                    Vineyards that will also be deleted ({preview.vineyards_to_delete.length})
                  </div>
                  {preview.vineyards_to_delete.length === 0 ? (
                    <p className="text-muted-foreground">None — the user is not a sole owner.</p>
                  ) : (
                    <ul className="list-disc pl-5 text-destructive">
                      {preview.vineyards_to_delete.map((v) => (
                        <li key={v.id}>{v.name ?? v.id}</li>
                      ))}
                    </ul>
                  )}
                </div>
                {preview.vineyards_to_keep.length > 0 && (
                  <div>
                    <div className="font-medium">Vineyards kept</div>
                    <ul className="list-disc pl-5 text-muted-foreground">
                      {preview.vineyards_to_keep.map((v) => (
                        <li key={v.id}>
                          {v.name ?? v.id}
                          {v.reason ? ` — ${v.reason}` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3 text-sm">
            <p>
              Type <span className="font-mono font-medium">{expected || user?.user_id}</span> to
              confirm permanent deletion.
            </p>
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={expected || user?.user_id}
              autoComplete="off"
            />
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          {step === 1 ? (
            <Button
              variant="destructive"
              disabled={loading || !!error || !preview}
              onClick={() => setStep(2)}
            >
              Continue
            </Button>
          ) : (
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={
                deleting ||
                confirmText.trim().toLowerCase() !== (expected || (user?.user_id ?? "")).toLowerCase()
              }
              onClick={(e) => {
                e.preventDefault();
                void onConfirm();
              }}
            >
              {deleting ? "Deleting…" : "Delete permanently"}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
