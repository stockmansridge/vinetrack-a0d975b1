import PinDetailPanel, { type PinRecord } from "@/components/PinDetailPanel";
import SelectedPinMap from "@/components/SelectedPinMap";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pin: PinRecord | null;
  paddockName?: string | null;
  vineyardName?: string | null;
  paddockRowDirection?: number | null;
}

export default function PinDetailSheet({
  open,
  onOpenChange,
  pin,
  paddockName,
  vineyardName,
  paddockRowDirection,
}: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[88vh] overflow-y-auto rounded-t-lg px-0 pb-0">
        <SheetHeader className="px-4 pb-0 text-left">
          <SheetTitle>{pin?.title?.trim() || pin?.button_name?.trim() || "Pin details"}</SheetTitle>
        </SheetHeader>
        <div className="space-y-4 px-4 py-4">
          {pin ? (
            <>
              <SelectedPinMap pin={pin} />
              <PinDetailPanel
                pin={pin}
                paddockName={paddockName}
                vineyardName={vineyardName}
                paddockRowDirection={paddockRowDirection}
                onClose={() => onOpenChange(false)}
              />
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}