import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Columns3, RotateCcw } from "lucide-react";

interface ColumnSettingsMenuProps {
  onReset: () => void;
  label?: string;
}

/**
 * Small "Columns" button placed above a table. Currently exposes
 * "Reset column order"; future show/hide options can be added here.
 */
export function ColumnSettingsMenu({ onReset, label = "Columns" }: ColumnSettingsMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1">
          <Columns3 className="h-4 w-4" />
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Table settings</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onReset} className="gap-2">
          <RotateCcw className="h-4 w-4" />
          Reset column order
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
