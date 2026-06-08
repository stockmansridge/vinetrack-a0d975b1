import FuelPurchasesPage from "./FuelPurchasesPage";
import TractorFuelLogsPage from "./TractorFuelLogsPage";

export default function FuelPage() {
  return (
    <div className="space-y-10">
      <div>
        <div className="mb-3">
          <h1 className="text-2xl font-semibold">Fuel</h1>
          <p className="text-sm text-muted-foreground">
            Track fuel purchases used for weighted cost per litre, and fuel
            fills for Vineyard Machines.
          </p>
        </div>
      </div>

      <section aria-labelledby="fuel-purchases-heading" className="space-y-3">
        <div>
          <h2 id="fuel-purchases-heading" className="text-lg font-semibold">
            Fuel Purchases
          </h2>
          <p className="text-sm text-muted-foreground">
            Record fuel purchases used to calculate weighted fuel cost per litre.
          </p>
        </div>
        <FuelPurchasesPage />
      </section>

      <section aria-labelledby="fuel-logs-heading" className="space-y-3 border-t pt-8">
        <div>
          <h2 id="fuel-logs-heading" className="text-lg font-semibold">
            Fuel Logs
          </h2>
          <p className="text-sm text-muted-foreground">
            Record fuel fills for Vineyard Machines and calculate usage over time.
          </p>
        </div>
        <TractorFuelLogsPage />
      </section>
    </div>
  );
}
