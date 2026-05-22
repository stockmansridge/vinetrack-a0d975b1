// Chemical AI Lookup — uses Lovable AI Gateway to suggest one or more
// candidate matches for a vineyard chemical/product based on the product
// name. Country-aware (defaults bias to the vineyard's country, e.g. APVMA
// labels for Australia). Always returns a structured list of candidates via
// tool calling so the UI can preview multiple options before the user
// applies one.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SYSTEM = `You are an expert assistant helping viticulture and vineyard managers identify agricultural chemicals and inputs (fungicides, herbicides, insecticides, fertilisers, bio-stimulants, wetting agents, silicon/kelp/potassium foliars, adjuvants, etc).

Behave like a knowledgeable agronomist who knows the regional product landscape:
- The user will provide the vineyard's COUNTRY. Strongly prioritise products registered or commonly used in that country and use that country's regulator (APVMA for Australia, ACVM/EPA for New Zealand, EPA for the United States, HSE for the UK, etc.).
- The user may give a product name with odd spacing/casing (e.g. "Crop SIL", "CROP SIL", "CropSIL", "crop-sil"). Treat these as the same query and EXPAND it internally:
    * exact form, no-space form, hyphenated form, ALLCAPS, Title Case
    * common suffixes ("Australia", "label", "SDS", "biostimulant", "fertiliser", "fungicide", manufacturer name)
    * known synonyms / sibling products in the same range
- Consider regional distributors and manufacturers (e.g. Switch Ag, Nufarm, Syngenta, Bayer, ADAMA, Sumitomo, UPL, Grochem, Yara, Nutrien, Elders) and list the most plausible candidate first, with alternatives below.

Return a RICH, RANKED candidate list:
- ALWAYS return between 5 and 10 candidates UNLESS you genuinely only know of one (then return 1–2 plus a clearly-marked "manual entry suggested" option is NOT needed — the UI handles that).
- Order by confidence × country relevance. Confirmed country-registered products first.
- Include sibling/alternate-pack variants when applicable (e.g. different formulations or pack sizes) so the user can pick.
- If you must include results NOT confirmed for that country, set country_confirmed = false and add a note like "Not confirmed for <country> — verify registration".
- Never invent a manufacturer. If unsure, leave manufacturer null and lower confidence.
- Never guess rates. If unsure leave rate_per_unit null with a note "Rate varies — check label".

For each candidate infer:
- product_type ("liquid" for EC/SC/SL/foliar/liquid concentrate, "solid" for WG/WP/granule/powder).
- unit (one of "L", "mL", "kg", "g") matching product_type.
- rate_basis ("per_hectare" if the label rate is per hectare, "per_100L" if per 100 litres of spray volume).
- rate_per_unit numeric (e.g. 100 for "100 mL/100L", 1.5 for "1.5 L/ha", 4 for "4 L/ha").
- WHP (withholding period in days) and REI (re-entry interval in hours) only when confident from that country's label; otherwise null.
- category MUST be one of: Fungicide, Herbicide, Insecticide, Fertiliser, Bio-stimulant, Wetting agent / adjuvant, Other.
- target: typical pest/disease/weed or use-case (e.g. "Powdery mildew", "Silicon/potassium foliar for vine strength").
- notes: concise (<240 chars), include compatibility cautions (e.g. "Avoid tank-mixing with copper — jar test first") when known.
- safety_note: always remind user to verify against current label for their country.
- country: primary country of registration for THIS specific candidate.
- country_confirmed: true only if confirmed registered in the user's vineyard country.
- confidence: high / medium / low / unknown.`;

const tools = [
  {
    type: "function",
    function: {
      name: "suggest_candidates",
      description: "Return 5–10 ranked candidate chemical/product matches for the named query, country-aware.",
      parameters: {
        type: "object",
        properties: {
          candidates: {
            type: "array",
            description: "5–10 candidate products ordered by likelihood and country relevance.",
            items: {
              type: "object",
              properties: {
                product_name: { type: "string", description: "Cleaned product name" },
                active_ingredient: { type: "string" },
                category: {
                  type: "string",
                  enum: [
                    "Fungicide",
                    "Herbicide",
                    "Insecticide",
                    "Fertiliser",
                    "Bio-stimulant",
                    "Wetting agent / adjuvant",
                    "Other",
                  ],
                },
                chemical_group: { type: "string", description: "e.g. Group 3, DMI, silicon/kelp blend" },
                manufacturer: { type: "string" },
                product_type: { type: "string", enum: ["liquid", "solid"] },
                unit: { type: "string", enum: ["L", "mL", "kg", "g"] },
                rate_basis: { type: "string", enum: ["per_hectare", "per_100L"] },
                rate_per_unit: { type: ["number", "null"] },
                withholding_period_days: { type: ["number", "null"] },
                re_entry_period_hours: { type: ["number", "null"] },
                target: { type: "string", description: "Typical target pest/disease/weed or use-case" },
                notes: { type: "string" },
                safety_note: { type: "string" },
                country: { type: "string", description: "Primary country of registration for this product." },
                country_confirmed: { type: "boolean", description: "True if confirmed registered in the user's vineyard country." },
                confidence: { type: "string", enum: ["high", "medium", "low", "unknown"] },
              },
              required: ["product_name", "category", "confidence", "safety_note"],
              additionalProperties: false,
            },
          },
        },
        required: ["candidates"],
        additionalProperties: false,
      },
    },
  },
];

function buildQueryExpansion(raw: string): string[] {
  const q = raw.trim();
  const compact = q.replace(/\s+/g, "");
  const hyphen = q.replace(/\s+/g, "-");
  const upper = q.toUpperCase();
  const title = q
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  const variants = new Set([q, compact, hyphen, upper, title]);
  return Array.from(variants);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { product_name, country } = await req.json();
    const countryStr = typeof country === "string" && country.trim() ? country.trim() : "";
    if (!product_name || typeof product_name !== "string" || !product_name.trim()) {
      return new Response(JSON.stringify({ error: "product_name is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "AI key not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const variants = buildQueryExpansion(product_name);
    const regulator =
      /australia/i.test(countryStr) ? "APVMA"
      : /new zealand/i.test(countryStr) ? "ACVM/EPA NZ"
      : /united states|^us$|usa/i.test(countryStr) ? "US EPA"
      : /united kingdom|^uk$/i.test(countryStr) ? "UK HSE"
      : "the national regulator";

    const userPrompt = `Vineyard country: ${countryStr || "UNKNOWN"}.
Regulator to prefer: ${regulator}.

Query: "${product_name.trim()}"
Internally consider these spelling/casing variants and common search suffixes:
${variants.map((v) => `- ${v}`).join("\n")}
Also consider variants like: "${product_name.trim()} ${countryStr || ""}", "${product_name.trim()} label", "${product_name.trim()} SDS", "${product_name.trim()} manufacturer", "${product_name.trim()} biostimulant", "${product_name.trim()} fungicide", "${product_name.trim()} fertiliser".

Return 5–10 ranked candidate products for the vineyard manager to choose from. Prefer products registered or distributed in ${countryStr || "the user's country"}. Include the most likely local manufacturer/distributor (e.g. for Australia consider Switch Ag, Grochem, Nufarm, Syngenta, Bayer, ADAMA, Sumitomo, UPL, Yara, Nutrien, Elders, etc. where relevant). Mark any out-of-country results with country_confirmed=false.`;

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userPrompt },
        ],
        tools,
        tool_choice: { type: "function", function: { name: "suggest_candidates" } },
      }),
    });

    if (!resp.ok) {
      if (resp.status === 429) {
        return new Response(
          JSON.stringify({ error: "AI lookup is rate limited. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (resp.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Add credits in Settings → Workspace → Usage." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const t = await resp.text();
      console.error("ai gateway error", resp.status, t);
      return new Response(JSON.stringify({ error: "AI lookup failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    const call = data?.choices?.[0]?.message?.tool_calls?.[0];
    if (!call?.function?.arguments) {
      return new Response(JSON.stringify({ error: "AI returned no suggestion" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    let parsed: any;
    try {
      parsed = JSON.parse(call.function.arguments);
    } catch {
      return new Response(JSON.stringify({ error: "Could not parse AI suggestion" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const candidates = Array.isArray(parsed?.candidates) ? parsed.candidates : [];

    // Rank: confirmed-country first, then by confidence.
    const confidenceWeight: Record<string, number> = { high: 3, medium: 2, low: 1, unknown: 0 };
    candidates.sort((a: any, b: any) => {
      const ac = a?.country_confirmed === true ? 1 : 0;
      const bc = b?.country_confirmed === true ? 1 : 0;
      if (ac !== bc) return bc - ac;
      return (confidenceWeight[b?.confidence] ?? 0) - (confidenceWeight[a?.confidence] ?? 0);
    });

    return new Response(
      JSON.stringify({
        candidates,
        suggestion: candidates[0] ?? null,
        query: product_name.trim(),
        country: countryStr || null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("chemical-ai-lookup error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
