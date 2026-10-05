// One shared section navigation for every Chemicals page.
// Destinations (fixed order): Chemicals / Chemical Inventory / Chemical Purchase.
// Add Chemical is an action, not a destination: it is rendered beside the nav
// (never inside it) on the Chemicals page and opens the existing Chemical
// Search. Other pages reach it via /setup/chemicals?add=1.
import { Link } from "react-router-dom";
import { FlaskConical, Package, Plus, ShoppingCart } from "lucide-react";
import { useVineyard } from "@/context/VineyardContext";
import { canRecordChemicalPurchase, canViewChemicalInventory } from "@/lib/chemicalInventory";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ChemicalSection = "chemicals" | "inventory" | "purchases";
export const CHEMICAL_NAV_ITEMS = ["Chemicals", "Chemical Inventory", "Chemical Purchase"] as const;
export const ADD_CHEMICAL_PARAM = "add";

const base =
  "inline-flex min-h-11 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-md px-4 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const idle = "text-foreground hover:bg-secondary hover:text-secondary-foreground";
const activeCls = "bg-primary text-primary-foreground shadow-sm";

export function ChemicalSectionNav({ active: current, onAddChemical }: { active: ChemicalSection; onAddChemical?: () => void }) {
  const { currentRole } = useVineyard();
  const canAdd = currentRole === "owner" || currentRole === "manager";
  const canView = canViewChemicalInventory(currentRole);
  const canBuy = canRecordChemicalPurchase(currentRole);
  const item = (key: ChemicalSection, to: string, label: string, Icon: typeof FlaskConical, testId?: string) => (
    <Link to={to} data-testid={testId} aria-current={current === key ? "page" : undefined}
      className={cn(base, current === key ? activeCls : idle)}>
      <Icon className="h-4 w-4" />{label}
    </Link>
  );
  return (
    <div className="w-full self-stretch">
      {/* Fixed-height action row above the menu so the menu never shifts between pages. */}
      <div className="mb-2 flex h-9 items-center justify-end">
        {canAdd && onAddChemical && (
          <Button type="button" size="sm" onClick={onAddChemical} data-testid="chemical-nav-add">
            <Plus className="mr-1 h-4 w-4" />Add Chemical
          </Button>
        )}
      </div>
    <div className="w-full rounded-lg border bg-card p-3 shadow-sm" data-testid="chemical-section">
      <div className="mb-2 flex items-center">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Chemical tools</span>
      </div>
      <nav aria-label="Chemical tools" data-testid="chemical-section-nav" className="vt-scroll -mx-1 overflow-x-auto px-1">
        <div className="flex min-w-max gap-1 rounded-md border bg-muted p-1 sm:min-w-0">
          {item("chemicals", "/setup/chemicals", "Chemicals", FlaskConical)}
          {canView && item("inventory", "/setup/chemicals/inventory", "Chemical Inventory", Package, "chemical-inventory-link")}
          {canBuy && item("purchases", "/setup/chemicals/purchases", "Chemical Purchase", ShoppingCart, "chemical-purchase-link")}
        </div>
      </nav>
    </div>
    </div>
  );
}
