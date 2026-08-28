// Chemical Search — live acceptance script (developer tool, NOT app code).
//
// Runs one authoritative structured lookup per product against the shared
// `chemical-info-lookup` resolver and reports the GRAPEVINE evidence only.
//
// Fix (preflight): the previous ad-hoc acceptance run described the rate rows
// of NON-grapevine directions (CITRUS: "400 to 500 g/100 L", "200 to 300
// g/100 L") as if they were the grapevine rates. Grapevine rows are now
// selected exactly the way the Portal selects them — by crop text — before any
// rate is printed, and every direction is printed with its own direction_id
// and its own rate_ids so two directions can never be described as one.
//
// Usage:  node scripts/chemical-acceptance.mjs [--retries 6] [--concurrency 2]

const URL = "https://tbafuqwruefgkbyxrxyb.supabase.co/functions/v1/chemical-info-lookup";
const KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRiYWZ1cXdydWVmZ2tieXhyeHliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyOTY0NDcsImV4cCI6MjA5Mjg3MjQ0N30.tvOzn1ketbd0zYJWDujh_DGcWVDeitJaoVWw3aqtuRw";

const PRODUCTS = [
  { name: "THIOVIT JET", reg: "53904" },
  { name: "KUMULUS DF", reg: "30552" },
  { name: "PROSARO 420 SC", reg: "63243" },
  { name: "TRIVOR", reg: "80807" },
  { name: "RIDOMIL GOLD MZ", reg: "50267" },
  { name: "ROUNDUP", reg: "31393" },
  { name: "MANCOZEB", reg: "63839" },
  // Additional catalogue records for the system mix (herbicide / insecticide /
  // miticide / alternate formulations and bases).
  { name: "LORSBAN 500 EC", reg: "34715" },
  { name: "APPARENT SPRAYSEAL", reg: "33182" },
  { name: "TOPAS 100 EC", reg: "34681" },
  { name: "SPRAYSEED 250", reg: "36000" },
];


const GRAPEVINE = /\b(grape|grapevine|grapevines|vine|vines|vitis)\b/i;

const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? Number(process.argv[i + 1]) : fallback;
};
const RETRIES = arg("--retries", 6);
const CONCURRENCY = arg("--concurrency", 2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function lookup(product) {
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetch(URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: KEY,
          Authorization: `Bearer ${KEY}`,
        },
        body: JSON.stringify({
          action: "structured",
          productName: product.name,
          product_name: product.name,
          country: "AU",
          country_code: "AU",
          structured: true,
          registration_number: product.reg,
          registrationNumber: product.reg,
          client: {
            platform: "portal",
            app_version: "acceptance",
            app_build: "acceptance",
            correlation_id: `acceptance-${product.reg}-${attempt}`,
          },
        }),
      });
      const body = await res.json();
      if (res.ok && !body.error) return body;
      console.error(`[${product.reg}] attempt ${attempt}: ${res.status} ${body.error ?? ""}`);
    } catch (e) {
      console.error(`[${product.reg}] attempt ${attempt}: ${e.message}`);
    }
    await sleep(3000);
  }
  return null;
}

const rateText = (r) =>
  r.min_value != null && r.max_value != null
    ? `${r.min_value}-${r.max_value} ${r.unit}`
    : `${r.value} ${r.unit}`;

function report(product, payload) {
  const lines = [];
  const p = (s) => lines.push(s);
  p(`\n=== ${product.name} / APVMA ${product.reg} ===`);
  if (!payload) {
    p("LOOKUP UNAVAILABLE after retries");
    return lines.join("\n");
  }
  const reg = payload.registration ?? {};
  p(`identity        : ${payload.product_name} | ${reg.registration_number} | ${reg.registrant}`);
  p(`match_source    : ${payload.match_source}`);
  p(`form_type       : ${payload.form_type ?? "unknown"}  -> inventory unit ${
    payload.form_type === "solid" ? "kg" : payload.form_type === "liquid" ? "L" : "(unset)"
  }`);
  p(`category        : ${payload.product_category ?? "(unset)"} [prov ${
    payload.field_provenance?.product_category ?? "none"
  }]`);
  p(
    `actives         : ${(payload.active_ingredients ?? [])
      .map((a) => `${a.name} ${a.concentration}${a.concentration_unit} (${a.activity_group?.code ?? "-"})`)
      .join(" + ") || "(none)"}`,
  );
  p(`groups          : ${(payload.activity_groups ?? []).join(", ") || "(none)"}`);
  const uses = payload.registered_uses ?? [];
  const grape = uses.filter((u) => GRAPEVINE.test(u.crop ?? ""));
  p(`registered_uses : ${uses.length} total, ${grape.length} grapevine`);
  for (const u of grape) {
    p(`  - direction ${u.direction_id}`);
    p(`    crop=${u.crop} target=${u.target_raw ?? u.target ?? "-"}`);
    for (const r of u.rates ?? []) {
      p(
        `    rate ${r.rate_id}: ${rateText(r)} basis=${r.basis}${
          r.condition_ambiguous ? " condition_ambiguous" : ""
        }${r.label ? ` label=${r.label}` : ""}`,
      );
    }
    if (!(u.rates ?? []).length) p("    rate: (none stated)");
    p(
      `    WHP=${u.withholding_period_text ?? u.withholding_period_days ?? "-"} REI=${
        u.re_entry_period_hours ?? "unresolved"
      }`,
    );
  }
  const whpText = uses.find((u) => u.restrictions)?.restrictions ?? "";
  const m = whpText.match(/WITHOLDING PERIOD:[^\n]*/i) || whpText.match(/WITHHOLDING PERIOD:[^\n]*/i);
  if (m) p(`whp evidence    : ${m[0]}`);
  return lines.join("\n");
}

const results = new Array(PRODUCTS.length);
let cursor = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= PRODUCTS.length) return;
      results[i] = report(PRODUCTS[i], await lookup(PRODUCTS[i]));
      console.error(`done ${PRODUCTS[i].reg}`);
    }
  }),
);
console.log(results.join("\n"));
