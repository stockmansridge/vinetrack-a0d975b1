// Chemical AI Lookup — uses Lovable AI Gateway to suggest fields for a
// vineyard chemical/product based on the product name. Australian viticulture
// bias. Always returns a structured JSON suggestion via tool calling so the
// UI can preview before user saves.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SYSTEM = `You are an assistant helping Australian viticulture and vineyard managers fill in details about agricultural chemicals and products (fungicides, herbicides, insecticides, fertilisers, bio-stimulants, wetting agents, etc).

Rules:
- Bias strongly toward Australian product label information (APVMA registered products).
- Never guess. If you are not confident about a field, leave it empty/null.
- If a rate varies by target/disease/crop, leave rate_per_ha null and put a note in "notes" such as "Rate varies by target — check label".
- WHP (withholding period in days) and REI (re-entry interval in hours) must only be returned if you are confident from the Australian label. Otherwise leave null.
- Category MUST be one of: Fungicide, Herbicide, Insecticide, Fertiliser, Bio-stimulant, Wetting agent / adjuvant, Other. If unknown, use "Other".
- Always include a short safety_note reminder that the AI suggestion must be verified against the actual product label.
- Keep notes concise (under 240 characters).`;

const tools = [
  {
    type: "function",
    function: {
      name: "suggest_chemical",
      description: "Return suggested fields for the named chemical/product.",
      parameters: {
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
          rate_per_ha: { type: ["number", "null"] },
          rate_unit: { type: "string", description: "e.g. L/ha, g/ha, kg/ha" },
          withholding_period_days: { type: ["number", "null"] },
          re_entry_period_hours: { type: ["number", "null"] },
          notes: { type: "string" },
          safety_note: { type: "string" },
          confidence: {
            type: "string",
            enum: ["high", "medium", "low", "unknown"],
          },
        },
        required: ["product_name", "category", "confidence", "safety_note"],
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
            content: `Look up Australian vineyard product details for: "${product_name.trim()}". Return only confidently known fields.`,
          },
        ],
        tools,
        tool_choice: { type: "function", function: { name: "suggest_chemical" } },
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
    let suggestion: any;
    try {
      suggestion = JSON.parse(call.function.arguments);
    } catch {
      return new Response(JSON.stringify({ error: "Could not parse AI suggestion" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ suggestion }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("chemical-ai-lookup error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
