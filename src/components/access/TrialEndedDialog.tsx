import { useSyncExternalStore } from "react";
import { useNavigate } from "react-router-dom";
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
import { readOnlyStore } from "@/lib/vineyardWriteAccess";

/** One shared purchase prompt, opened whenever a write is blocked in read-only mode. */
export function TrialEndedDialog() {
  const navigate = useNavigate();
  const { promptOpen } = useSyncExternalStore(readOnlyStore.subscribe, readOnlyStore.get);
  return (
    <AlertDialog open={promptOpen} onOpenChange={(o) => !o && readOnlyStore.closePrompt()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Your VineTrack trial has ended</AlertDialogTitle>
          <AlertDialogDescription>
            Your vineyard data is still available in read-only mode. Purchase a VineTrack
            subscription to make changes.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Close</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              readOnlyStore.closePrompt();
              navigate("/billing");
            }}
          >
            Choose a plan
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default TrialEndedDialog;
