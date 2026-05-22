// Chemical AI Lookup — deterministic, cache-backed lookup that always
// surfaces exact-name matches and remembers high-confidence results so
// repeat searches stay stable.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
- ALWAYS return between 5 and 10 candidates UNLESS you genuinely only know of one.
- ALWAYS include any candidate whose product name is an exact or near-exact match to the user's query — never drop those, even if you are less confident than for a different product.
- Order by confidence × country relevance. Confirmed country-registered products first.
- Include sibling/alternate-pack variants when applicable.
- If you must include results NOT confirmed for that country, set country_confirmed = false and add a note like "Not confirmed for <country> — verify registration".
- Never invent a manufacturer. If unsure, leave manufacturer null and lower confidence.
- Never guess rates. If unsure leave rate_per_unit null with a note "Rate varies — check label".

For each candidate infer:
- product_type ("liquid" for EC/SC/SL/foliar/liquid concentrate, "solid" for WG/WP/granule/powder).
- unit (one of "L", "mL", "kg", "g") matching product_type.
- rate_basis ("per_hectare" if the label rate is per hectare, "per_100L" if per 100 litres of spray volume).
- rate_per_unit numeric.
- WHP / REI only when confident from that country's label; otherwise null.
- category MUST be one of: Fungicide, Herbicide, Insecticide, Fertiliser, Bio-stimulant, Wetting agent / adjuvant, Other.
- target: typical pest/disease/weed or use-case.
- notes: concise (<240 chars), include compatibility cautions when known.
- safety_note: always remind user to verify against current label for their country.
- country / country_confirmed / confidence as defined.`;

const tools = [
  {
    type: "function",
    function: {
      name: "suggest_candidates",
      description: "Return 5–10 ranked candidate chemical/product matches.",
      parameters: {
        type: "object",
        properties: {
          candidates: {
            type: "array",
            items: {
              type: "object",
              properties: {
                product_name: { type: "string" },
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
                chemical_group: { type: "string" },
                manufacturer: { type: "string" },
                product_type: { type: "string", enum: ["liquid", "solid"] },
                unit: { type: "string", enum: ["L", "mL", "kg", "g"] },
                rate_basis: { type: "string", enum: ["per_hectare", "per_100L"] },
                rate_per_unit: { type: ["number", "null"] },
                withholding_period_days: { type: ["number", "null"] },
                re_entry_period_hours: { type: ["number", "null"] },
                target: { type: "string" },
                notes: { type: "string" },
                safety_note: { type: "string" },
                country: { type: "string" },
                country_confirmed: { type: "boolean" },
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

type LookupCandidate = {
  product_name?: string;
  active_ingredient?: string;
  category?: string;
  chemical_group?: string;
  manufacturer?: string;
  product_type?: "liquid" | "solid";
  unit?: "L" | "mL" | "kg" | "g";
  rate_basis?: "per_hectare" | "per_100L";
  rate_per_unit?: number | null;
  withholding_period_days?: number | null;
  re_entry_period_hours?: number | null;
  target?: string;
  notes?: string;
  safety_note?: string;
  country?: string;
  country_confirmed?: boolean;
  confidence?: "high" | "medium" | "low" | "unknown";
  cached?: boolean;
  was_applied?: boolean;
  times_seen?: number;
  source_hint?: string;
  last_seen_at?: string;
};

function normaliseChemicalLookupKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "").trim();
}

function normaliseQuery(s: string): string {
  return normaliseChemicalLookupKey(s);
}

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
  return Array.from(new Set([q, compact, hyphen, upper, title]));
}

const CONFIDENCE_WEIGHT: Record<string, number> = {
  high: 3,
  medium: 2,
  low: 1,
  unknown: 0,
};

function nameSimilarityScore(query: string, productName: string): number {
  const qn = normaliseQuery(query);
  const pn = normaliseQuery(productName || "");
  if (!qn || !pn) return 0;
  if (qn === pn) return 100;
  if (pn.startsWith(qn) || qn.startsWith(pn)) return 80;
  if (pn.includes(qn) || qn.includes(pn)) return 60;
  return 0;
}

function candidateKey(c: any): string {
  return `${normaliseQuery(c?.product_name || "")}|${normaliseQuery(c?.manufacturer || "")}`;
}

function countryMatches(requestCountry: string, candidateCountry?: string | null): boolean {
  if (!requestCountry) return true;
  return normaliseQuery(requestCountry) === normaliseQuery(candidateCountry || "");
}

function sourceWeight(sourceHint?: string | null): number {
  switch (sourceHint) {
    case "manual_applied":
      return 4;
    case "known_good_manual":
      return 3;
    case "previous_lookup":
      return 2;
    case "ai_gateway":
      return 1;
    default:
      return 0;
  }
}

function recencyWeight(value?: string | null): number {
  const ts = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(ts) ? ts : 0;
}

function getKnownCandidates(queryNorm: string, countryStr: string): LookupCandidate[] {
  if (queryNorm !== "cropsil") return [];
  if (countryStr && !/australia/i.test(countryStr)) return [];
  return [
    {
      product_name: "Crop SIL",
      manufacturer: "Switch Ag",
      category: "Bio-stimulant",
      active_ingredient: "Silicic acid / potassium / kelp / organic acids",
      product_type: "liquid",
      unit: "L",
      rate_basis: "per_hectare",
      rate_per_unit: null,
      target: "Silicon nutrition / plant health support",
      notes: "Known Australian Crop SIL candidate. Confirm current label, rate, and permitted use.",
      safety_note: "Verify against the current Australian label before use.",
      country: "Australia",
      country_confirmed: true,
      confidence: "high",
      source_hint: "known_good_manual",
      times_seen: 50,
    },
  ];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { product_name, country } = await req.json();
    const countryStr =
      typeof country === "string" && country.trim() ? country.trim() : "";
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

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const admin = SUPABASE_URL && SERVICE_ROLE
      ? createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })
      : null;

    const rawQuery = product_name.trim();
    const queryNorm = normaliseQuery(rawQuery);
    const variants = buildQueryExpansion(rawQuery);
    const regulator =
      /australia/i.test(countryStr) ? "APVMA"
      : /new zealand/i.test(countryStr) ? "ACVM/EPA NZ"
      : /united states|^us$|usa/i.test(countryStr) ? "US EPA"
      : /united kingdom|^uk$/i.test(countryStr) ? "UK HSE"
      : "the national regulator";

    // 1. Pull any cached candidates for this query (exact normalised match,
    //    plus country match or country-agnostic).
    let cached: any[] = [];
    if (admin) {
      const { data: cachedRows } = await admin
        .from("chemical_lookup_cache")
        .select("*")
        .eq("query_normalised", queryNorm)
        .in("country", countryStr ? [countryStr, ""] : [""])
        .order("was_applied", { ascending: false })
        .order("times_seen", { ascending: false })
        .order("last_seen_at", { ascending: false })
        .limit(50);
      cached = cachedRows ?? [];
    }

    const knownCandidates = getKnownCandidates(queryNorm, countryStr);

    const cachedCandidates: LookupCandidate[] = cached.map((row) => ({
      product_name: row.product_name,
      active_ingredient: row.active_ingredient ?? undefined,
      category: row.category ?? undefined,
      chemical_group: row.chemical_group ?? undefined,
      manufacturer: row.manufacturer || undefined,
      product_type: row.product_type ?? undefined,
      unit: row.unit ?? undefined,
      rate_basis: row.rate_basis ?? undefined,
      rate_per_unit: row.rate_per_unit ?? null,
      withholding_period_days: row.withholding_period_days ?? null,
      re_entry_period_hours: row.re_entry_period_hours ?? null,
      target: row.target ?? undefined,
      notes: row.notes ?? undefined,
      safety_note: row.safety_note ?? undefined,
      country: row.country || undefined,
      country_confirmed: row.country_confirmed ?? undefined,
      confidence: row.confidence ?? "medium",
      cached: true,
      was_applied: row.was_applied ?? false,
      times_seen: row.times_seen ?? 1,
      last_seen_at: row.last_seen_at ?? undefined,
      source_hint: row.source_hint ?? "previous_lookup",
    }));

    // 2. Call AI to enrich. Lower temperature for determinism.
    const userPrompt = `Vineyard country: ${countryStr || "UNKNOWN"}.
Regulator to prefer: ${regulator}.

Query: "${rawQuery}"
Internally consider these spelling/casing variants and common search suffixes:
${variants.map((v) => `- ${v}`).join("\n")}
Also consider: "${rawQuery} ${countryStr}", "${rawQuery} label", "${rawQuery} SDS", "${rawQuery} manufacturer", "${rawQuery} biostimulant", "${rawQuery} fungicide", "${rawQuery} fertiliser".

CRITICAL: Always include at least one candidate whose product_name closely matches the user's query "${rawQuery}". Do not drop exact-name matches.

Return 5–10 ranked candidate products. Prefer products registered or distributed in ${countryStr || "the user's country"}.`;

    let aiCandidates: any[] = [];
    let aiTimedOut = false;
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 60_000);
      let resp: Response;
      try {
        resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            temperature: 0.2,
            messages: [
              { role: "system", content: SYSTEM },
              { role: "user", content: userPrompt },
            ],
            tools,
            tool_choice: { type: "function", function: { name: "suggest_candidates" } },
          }),
          signal: ac.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      if (resp.ok) {
        const data = await resp.json();
        const call = data?.choices?.[0]?.message?.tool_calls?.[0];
        if (call?.function?.arguments) {
          try {
            const parsed = JSON.parse(call.function.arguments);
            aiCandidates = Array.isArray(parsed?.candidates) ? parsed.candidates : [];
          } catch (e) {
            console.error("parse ai args", e);
          }
        }
      } else if (resp.status === 429) {
        if (cachedCandidates.length === 0) {
          return new Response(
            JSON.stringify({ error: "AI lookup is rate limited. Please try again in a moment." }),
            { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      } else if (resp.status === 402) {
        if (cachedCandidates.length === 0) {
          return new Response(
            JSON.stringify({ error: "AI credits exhausted. Add credits in Settings → Workspace → Usage." }),
            { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      } else {
        const t = await resp.text();
        console.error("ai gateway error", resp.status, t);
      }
    } catch (e) {
      aiTimedOut = (e as any)?.name === "AbortError";
      console.error("ai gateway exception", aiTimedOut ? "timeout after 60s" : e);
    }

    if (aiTimedOut && cachedCandidates.length === 0) {
      return new Response(
        JSON.stringify({
          error: "AI lookup timed out. Please try again or enter the product manually.",
          candidates: [],
        }),
        { status: 504, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 3. Build a fresh candidate set every call. Order matters for dedupe
    //    (first occurrence of a key wins, so cached entries keep their
    //    "previously found" flag).
    console.log("[chemical-ai-lookup] raw counts", {
      query: rawQuery,
      country: countryStr,
      cached: cachedCandidates.length,
      ai: aiCandidates.length,
    });

    // Only add the exact-name skeleton if NOTHING in cache or AI is an
    // exact/near match — guarantees the user's typed query is always
    // selectable for manual entry without clobbering real matches.
    const preservedCandidates: LookupCandidate[] = [...knownCandidates, ...cachedCandidates];
    const appliedCandidates = preservedCandidates.filter((c) => c.was_applied);
    const exactCandidates = preservedCandidates.filter((c) => {
      const score = nameSimilarityScore(rawQuery, c.product_name ?? "");
      return score >= 80 || (score === 100 && countryMatches(countryStr, c.country));
    });

    const hasExactOrNear =
      preservedCandidates.some((c) => nameSimilarityScore(rawQuery, c.product_name ?? "") >= 60) ||
      aiCandidates.some((c) => nameSimilarityScore(rawQuery, c.product_name ?? "") >= 60);

    const exactNameSkeleton = {
      product_name: rawQuery,
      manufacturer: "",
      confidence: "low" as const,
      safety_note: "Manual entry — verify against current product label.",
      source_hint: "exact_name_fallback",
      cached: false,
    };

    const freshCandidates: LookupCandidate[] = [
      ...preservedCandidates,
      ...aiCandidates,
      ...(hasExactOrNear ? [] : [exactNameSkeleton]),
    ];

    const merged: any[] = [];
    const seen = new Set<string>();
    for (const c of freshCandidates) {
      const key = candidateKey(c);
      if (!key || key === "|") continue;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push({ ...c }); // clone — never mutate inputs
    }

    // 4. Deterministic ranking:
    //    exact-name match → near-match → country-confirmed → cached → AI confidence.
    merged.sort((a: LookupCandidate, b: LookupCandidate) => {
      const sa = nameSimilarityScore(rawQuery, a.product_name);
      const sb = nameSimilarityScore(rawQuery, b.product_name);
      const exactCountryA = sa === 100 && countryMatches(countryStr, a.country) ? 1 : 0;
      const exactCountryB = sb === 100 && countryMatches(countryStr, b.country) ? 1 : 0;
      if (exactCountryA !== exactCountryB) return exactCountryB - exactCountryA;
      const exactA = sa === 100 ? 1 : 0;
      const exactB = sb === 100 ? 1 : 0;
      if (exactA !== exactB) return exactB - exactA;
      if (sa !== sb) return sb - sa;
      const appliedA = a.was_applied ? 1 : 0;
      const appliedB = b.was_applied ? 1 : 0;
      if (appliedA !== appliedB) return appliedB - appliedA;
      const ca = a.country_confirmed === true ? 1 : 0;
      const cb = b.country_confirmed === true ? 1 : 0;
      if (ca !== cb) return cb - ca;
      const sourceA = sourceWeight(a.source_hint);
      const sourceB = sourceWeight(b.source_hint);
      if (sourceA !== sourceB) return sourceB - sourceA;
      const cachedA = a.cached ? 1 : 0;
      const cachedB = b.cached ? 1 : 0;
      if (cachedA !== cachedB) return cachedB - cachedA;
      const confDelta = (CONFIDENCE_WEIGHT[b.confidence ?? "unknown"] ?? 0) - (CONFIDENCE_WEIGHT[a.confidence ?? "unknown"] ?? 0);
      if (confDelta !== 0) return confDelta;
      const timesSeenDelta = (b.times_seen ?? 0) - (a.times_seen ?? 0);
      if (timesSeenDelta !== 0) return timesSeenDelta;
      return recencyWeight(b.last_seen_at) - recencyWeight(a.last_seen_at);
    });

    console.log("Chemical lookup sources", {
      query: rawQuery,
      normalisedKey: queryNorm,
      exactCandidates: exactCandidates.length,
      cachedCandidates: cachedCandidates.length,
      appliedCandidates: appliedCandidates.length,
      aiCandidates: aiCandidates.length,
      finalCandidates: merged.slice(0, 15).map((c) => ({
        name: c.product_name,
        manufacturer: c.manufacturer,
        source: c.source_hint,
        confidence: c.confidence,
      })),
    });

    console.log("[chemical-ai-lookup] merged", {
      query: rawQuery,
      total: merged.length,
      names: merged.map((m) => `${m.product_name}|${m.manufacturer || ""}${m.cached ? " [cached]" : ""}`),
    });

    // 5. Write high-confidence AI candidates to cache for future lookups.
    if (admin && aiCandidates.length) {
      const toCache = merged
        .filter((c) => c && c.product_name && (c.confidence === "high" || c.confidence === "medium") && c.source_hint !== "exact_name_fallback")
        .map((c) => ({
          query_normalised: queryNorm,
          country: countryStr || "",
          product_name: String(c.product_name).trim(),
          manufacturer: (c.manufacturer ?? "").toString().trim() || "",
          product_name_normalised: normaliseQuery(String(c.product_name).trim()),
          manufacturer_normalised: normaliseQuery((c.manufacturer ?? "").toString().trim() || ""),
          active_ingredient: c.active_ingredient ?? null,
          category: c.category ?? null,
          chemical_group: c.chemical_group ?? null,
          product_type: c.product_type ?? null,
          unit: c.unit ?? null,
          rate_basis: c.rate_basis ?? null,
          rate_per_unit: c.rate_per_unit ?? null,
          withholding_period_days: c.withholding_period_days ?? null,
          re_entry_period_hours: c.re_entry_period_hours ?? null,
          target: c.target ?? null,
          notes: c.notes ?? null,
          safety_note: c.safety_note ?? null,
          country_confirmed: c.country_confirmed ?? null,
          confidence: c.confidence ?? "medium",
          source_hint: c.source_hint ?? "ai_gateway",
          times_seen: Math.max(1, c.times_seen ?? 1),
          was_applied: c.was_applied ?? false,
          last_seen_at: new Date().toISOString(),
        }));
      if (toCache.length) {
        const { error: upErr } = await admin
          .from("chemical_lookup_cache")
          .upsert(toCache, { onConflict: "query_normalised,country,product_name_normalised,manufacturer_normalised", ignoreDuplicates: false, defaultToNull: false });
        if (upErr) console.error("cache upsert", upErr);

        const seenKeys = Array.from(new Set(toCache.map((c) => `${c.product_name_normalised}|${c.manufacturer_normalised}`)));
        for (const key of seenKeys) {
          const [productNameNormalised, manufacturerNormalised] = key.split("|");
          const { error: bumpErr } = await admin
            .from("chemical_lookup_cache")
            .update({ last_seen_at: new Date().toISOString() })
            .eq("query_normalised", queryNorm)
            .eq("country", countryStr || "")
            .eq("product_name_normalised", productNameNormalised)
            .eq("manufacturer_normalised", manufacturerNormalised);
          if (bumpErr) console.error("cache touch", bumpErr);
        }
      }
    }

    if (!merged.length) {
      return new Response(JSON.stringify({ error: "AI returned no suggestion", candidates: [] }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        candidates: merged.slice(0, 10),
        suggestion: merged[0] ?? null,
        query: rawQuery,
        country: countryStr || null,
        cache_hits: cachedCandidates.length,
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
