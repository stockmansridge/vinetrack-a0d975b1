import FuelPurchasesPage from "./FuelPurchasesPage";
import TractorFuelLogsPage from "./TractorFuelLogsPage";

export default function FuelPage() {
  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-semibold">Fuel</h1>
        <p className="text-sm text-muted-foreground">
          Track fuel purchases used for weighted cost per litre, and fuel
          fills for Vineyard Machines.
        </p>
      </div>

      <section aria-label="Fuel Purchases">
        <FuelPurchasesPage />
      </section>

      <section aria-label="Fuel Logs" className="border-t pt-8">
        <TractorFuelLogsPage />
      </section>
    </div>
  );
}
