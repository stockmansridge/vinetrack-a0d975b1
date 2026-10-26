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
      <p className="mt-1">The same MAIT connection can also be used for a MAIT irrigation controller. Go to <strong>Irrigation Setup</strong>, choose the controller module, map MAIT outputs to VineTrack valves, then use <strong>Sync now</strong>.</p>
      <p className="mt-2 text-muted-foreground">VineTrack currently reads MAIT data only. It does not start, stop or program MAIT irrigation hardware.</p>
    </section>
  </ProviderSetupHelp>;
}