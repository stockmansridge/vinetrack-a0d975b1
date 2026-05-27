import { Eye, EyeOff } from "lucide-react";

interface PasswordToggleButtonProps {
  visible: boolean;
  onToggle: () => void;
  className?: string;
}

export function PasswordToggleButton({ visible, onToggle, className }: PasswordToggleButtonProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={visible ? "Hide password" : "Show password"}
      aria-pressed={visible}
      tabIndex={0}
      className={
        "inline-flex items-center justify-center rounded-md p-1 text-[#055124] hover:bg-[#EDF7E8] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#055124]/40 transition-colors " +
        (className ?? "")
      }
    >
      {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
    </button>
  );
}
