import { ProviderSetupHelp } from "@/components/weather/ProviderSetupHelp";

export function MaitSetupHelp() {
  return <ProviderSetupHelp label="MAIT setup instructions" title="How to configure MAIT iNTELLiWeb" intro="Each vineyard connects its own MAIT iNTELLiWeb account. You will need an iNTELLiWeb user with getdata access, the account password, and the MAIT Network ID for the vineyard.">
    <ol className="list-decimal space-y-5 pl-5 marker:font-semibold">
      <li className="pl-1"><h3 className="font-semibold">Get your MAIT details</h3>
        <ul className="list-disc pl-5"><li>Username</li><li>Password</li><li>Network ID</li><li>The iNTELLiWeb user must have getdata access.</li></ul>
        <p className="mt-1 text-muted-foreground">If you do not know these details, contact your MAIT/iNTELLiWeb administrator or MAIT Industries.</p>
      </li>
      <li className="pl-1"><h3 className="font-semibold">Test the connection</h3>
        <ul className="list-disc pl-5"><li>Select <strong>Connect MAIT</strong>.</li><li>Enter Username, Password and Network ID.</li><li>Select <strong>Test connection</strong>.</li></ul>
        <p className="mt-1 text-muted-foreground">VineTrack will verify the account and list the MAIT modules available on that network.</p>
      </li>
      <li className="pl-1"><h3 className="font-semibold">Save the connection</h3>
        <p>After a successful test, select <strong>Save &amp; continue</strong>.</p>
        <p className="text-muted-foreground">Your MAIT password is stored securely and is never displayed again.</p>
      </li>
      <li className="pl-1"><h3 className="font-semibold">Choose the weather station</h3>
        <ul className="list-disc pl-5"><li>Load the available modules.</li><li>Select the MAIT module that represents the vineyard weather station.</li><li>Select <strong>Save weather module</strong>.</li></ul>
      </li>
      <li className="pl-1"><h3 className="font-semibold">Map the weather channels</h3>
        <p>Select <strong>Inspect weather channels</strong>. VineTrack shows the channel number, MAIT label, unit and latest reading.</p>
        <p className="mt-1">Map each relevant channel to the correct VineTrack measurement, such as Air temperature, Relative humidity, Wind speed, Wind direction, Wind gust, Rainfall, Rain rate, Leaf wetness, Soil moisture or Soil temperature. Leave channels you do not use as <strong>Ignore</strong>.</p>
        <p className="mt-2 rounded-md border bg-muted/40 p-3 font-medium">MAIT channel numbers are not universal. Always confirm the MAIT label and unit before saving a mapping.</p>
      </li>
      <li className="pl-1"><h3 className="font-semibold">Rainfall</h3>
        <p>If MAIT supplies rainfall, confirm whether the mapped channel is <strong>Daily cumulative rainfall</strong>.</p>
        <p className="text-muted-foreground">Only a confirmed daily-cumulative rainfall channel can be used for VineTrack daily rainfall records.</p>
      </li>
      <li className="pl-1"><h3 className="font-semibold">Make MAIT the live weather source</h3>
        <p>After the weather module and mappings are complete, select <strong>Use MAIT for live observations</strong>.</p>
        <p className="text-muted-foreground">Forecasts remain separate and continue to use the vineyard's selected forecast provider.</p>
      </li>
    </ol>
    <section className="border-t pt-4"><h3 className="font-semibold">Using MAIT for irrigation</h3>
      <p className="mt-1">The same MAIT connection can also be used for a MAIT irrigation controller. Go to <strong>Irrigation Setup</strong> and follow the controller acceptance checklist.</p>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        <li>Connect and test the MAIT network in Weather setup. A saved connection alone does not prove controller access.</li>
        <li>Load available modules without saving or importing. Identify a confirmed MAIT irrigation controller, not a weather or soil sensor module. Ask MAIT to confirm compatible controller and getdata access if none is available.</li>
        <li>Link the confirmed controller to an active VineTrack irrigation system and match its outputs to active valves in that exact system.</li>
        <li>Verify each valve's saved block and row allocations. Keep the existing five mapping methods: Rows, Manual percentage, Emitter count, Vine count and Irrigated area.</li>
        <li>Select <strong>Preview MAIT usage (read-only)</strong>. Compare output numbers, start times, durations and reported water volumes with MAIT. Empty or partial data does not prove complete coverage; no records are created by preview.</li>
        <li>Use <strong>Sync now</strong> only after reviewing today's saved mappings and allocations, then explicitly confirm. Valid runs may immediately create irrigation records for the last three local days.</li>
        <li>Compare the imported Irrigation Records and Reports against MAIT records.</li>
        <li>Only then consider pilot scheduled retrieval with an authorised System Admin who also has vineyard access. The scheduler remains installed but paused; this checklist does not activate it.</li>
      </ol>
      <p className="mt-2 text-muted-foreground">VineTrack currently reads MAIT data only. It does not start, stop or program MAIT irrigation hardware.</p>
      <p className="mt-2 text-muted-foreground">Manual sync is operational: it imports controller-reported run history and recorded water volumes, not live flow measurements. Automatic retrieval and automatic record creation are System Admin-only pilot preferences. Scheduler installed but paused: automatic syncing is not running; saving preferences does not start a sync.</p>
    </section>
  </ProviderSetupHelp>;
}