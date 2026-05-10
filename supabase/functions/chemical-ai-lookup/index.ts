// Chemical AI Lookup — uses Lovable AI Gateway to suggest one or more
// candidate matches for a vineyard chemical/product based on the product
// name. Australian viticulture bias (APVMA labels). Always returns a
// structured list of candidates via tool calling so the UI can preview
// multiple options before the user applies one.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SYSTEM = `You are an assistant helping Australian viticulture and vineyard managers fill in details about agricultural chemicals and products (fungicides, herbicides, insecticides, fertilisers, bio-stimulants, wetting agents, etc).

Rules:
- Bias strongly toward Australian product label information (APVMA registered products).
- Return up to 5 likely candidate products that match the user's query.
  - If the query is unambiguous (a single registered product), return one candidate.
  - If the query is ambiguous (active ingredient, partial name, generic), return multiple candidates ordered by likelihood.
- Never guess. If you are not confident about a field, leave it empty/null.
- For each candidate, infer:
    - product_type ("liquid" if the formulation is a liquid/EC/SC/SL, "solid" if WG/WP/granule/powder).
    - unit (one of "L", "mL", "kg", "g") matching the product_type.
    - rate_basis ("per_hectare" if label rate is per hectare, "per_100L" if per 100 litres of spray volume).
    - rate_per_unit numeric (e.g. 100 for "100 mL/100L", 1.5 for "1.5 L/ha").
- If a rate varies by target/disease/crop, leave rate_per_unit null and put a note in "notes" such as "Rate varies by target — check label".
- WHP (withholding period in days) and REI (re-entry interval in hours) only when confident from the Australian label. Otherwise null.
- Category MUST be one of: Fungicide, Herbicide, Insecticide, Fertiliser, Bio-stimulant, Wetting agent / adjuvant, Other.
- Always include a short safety_note reminding the user to verify the suggestion against the actual product label.
- Keep notes concise (under 240 characters).`;

const tools = [
  {
    type: "function",
    function: {
      name: "suggest_candidates",
      description: "Return one or more candidate chemical/product matches for the named query.",
      parameters: {
        type: "object",
        properties: {
          candidates: {
            type: "array",
            description: "Up to 5 candidate products ordered by likelihood.",
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
                chemical_group: { type: "string", description: "e.g. Group 3, DMI" },
                manufacturer: { type: "string" },
                product_type: { type: "string", enum: ["liquid", "solid"] },
                unit: { type: "string", enum: ["L", "mL", "kg", "g"] },
                rate_basis: { type: "string", enum: ["per_hectare", "per_100L"] },
                rate_per_unit: { type: ["number", "null"] },
                withholding_period_days: { type: ["number", "null"] },
                re_entry_period_hours: { type: ["number", "null"] },
                target: { type: "string", description: "Typical target pest/disease/weed" },
                notes: { type: "string" },
                safety_note: { type: "string" },
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { product_name } = await req.json();
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

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: `Look up Australian vineyard product candidates matching: "${product_name.trim()}". Return up to 5 likely matches ordered by likelihood.`,
          },
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
    // Backward-compat: also expose first candidate as `suggestion`.
    return new Response(
      JSON.stringify({ candidates, suggestion: candidates[0] ?? null }),
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
