// One shared secondary navigation for every Chemicals page.
// Order is fixed: Chemicals / Add Chemical / Chemical Inventory / Chemical Purchase.
// Add Chemical is an action that opens the existing Chemical Search (on the
// Chemicals page directly; elsewhere via /setup/chemicals?add=1).
import { Link, useNavigate } from "react-router-dom";
import { FlaskConical, Package, Plus, ShoppingCart } from "lucide-react";
import { useVineyard } from "@/context/VineyardContext";
import { canRecordChemicalPurchase, canViewChemicalInventory } from "@/lib/chemicalInventory";
import { cn } from "@/lib/utils";

export type ChemicalSection = "chemicals" | "inventory" | "purchases";
export const CHEMICAL_NAV_ITEMS = ["Chemicals", "Add Chemical", "Chemical Inventory", "Chemical Purchase"] as const;
export const ADD_CHEMICAL_PARAM = "add";

const base = "inline-flex items-center gap-1.5 whitespace-nowrap rounded px-3 py-1.5 text-sm transition";
const idle = "text-muted-foreground hover:bg-background/60 hover:text-foreground";
const active = "bg-background font-medium text-foreground shadow-sm";

export function ChemicalSectionNav({ active: current, onAddChemical }: { active: ChemicalSection; onAddChemical?: () => void }) {
  const { currentRole } = useVineyard();
  const navigate = useNavigate();
  const canAdd = currentRole === "owner" || currentRole === "manager";
  const canView = canViewChemicalInventory(currentRole);
  const canBuy = canRecordChemicalPurchase(currentRole);
  const add = () => (onAddChemical ? onAddChemical() : navigate(`/setup/chemicals?${ADD_CHEMICAL_PARAM}=1`));
  return (
    <nav aria-label="Chemicals section" data-testid="chemical-section-nav"
      className="-mx-1 overflow-x-auto px-1">
      <div className="inline-flex gap-1 rounded-md border bg-muted/30 p-1">
        <Link to="/setup/chemicals" aria-current={current === "chemicals" ? "page" : undefined} className={cn(base, current === "chemicals" ? active : idle)}>
          <FlaskConical className="h-4 w-4" />Chemicals
        </Link>
        {canAdd && (
          <button type="button" onClick={add} className={cn(base, idle)} data-testid="chemical-nav-add">
            <Plus className="h-4 w-4" />Add Chemical
          </button>
        )}
        {canView && (
          <Link to="/setup/chemicals/inventory" data-testid="chemical-inventory-link" aria-current={current === "inventory" ? "page" : undefined} className={cn(base, current === "inventory" ? active : idle)}>
            <Package className="h-4 w-4" />Chemical Inventory
          </Link>
        )}
        {canBuy && (
          <Link to="/setup/chemicals/purchases" data-testid="chemical-purchase-link" aria-current={current === "purchases" ? "page" : undefined} className={cn(base, current === "purchases" ? active : idle)}>
            <ShoppingCart className="h-4 w-4" />Chemical Purchase
          </Link>
        )}
      </div>
    </nav>
  );
}
