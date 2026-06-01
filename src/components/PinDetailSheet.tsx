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
  side?: "bottom" | "right";
}

export default function PinDetailSheet({
  open,
  onOpenChange,
  pin,
  paddockName,
  vineyardName,
  paddockRowDirection,
  side = "bottom",
}: Props) {
  const contentClass =
    side === "right"
      ? "w-full sm:max-w-[440px] h-full overflow-y-auto px-0 pb-0"
      : "h-[88vh] overflow-y-auto rounded-t-lg px-0 pb-0";
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={side} className={contentClass}>
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
