// Suggests an estimated fuel usage (L/hr) for a tractor based on brand/model/year.
// Uses Lovable AI Gateway with structured tool calling.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { brand, model, year } = await req.json().catch(() => ({}));
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "AI gateway not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const description = [brand, model, year].filter(Boolean).join(" ").trim();
    if (!description) {
      return new Response(
        JSON.stringify({ error: "Provide brand, model, or year." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const systemPrompt =
      "You estimate average diesel fuel consumption (litres per hour) for vineyard/orchard tractors during typical mixed work (spraying, mowing, light cultivation). " +
      "Return a single realistic number between 2 and 60. If the tractor is unknown, give a best estimate based on similar models of that brand and era. " +
      "Be conservative. Do not refuse.";

    const userPrompt = `Tractor: ${description}. Estimate average L/hr.`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "report_fuel_estimate",
              description: "Report the estimated fuel usage in L/hr.",
              parameters: {
                type: "object",
                properties: {
                  fuel_l_per_hour: {
                    type: "number",
                    description: "Estimated average diesel use in litres per hour (2-60).",
                  },
                  confidence: {
                    type: "string",
                    enum: ["low", "medium", "high"],
                  },
                  notes: {
                    type: "string",
                    description: "Brief one-sentence rationale.",
                  },
                },
                required: ["fuel_l_per_hour", "confidence"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "report_fuel_estimate" } },
      }),
    });

    if (aiResp.status === 429) {
      return new Response(JSON.stringify({ error: "Rate limit reached, try again shortly." }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (aiResp.status === 402) {
      return new Response(JSON.stringify({ error: "AI credits exhausted." }), {
        status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!aiResp.ok) {
      const t = await aiResp.text();
      console.error("AI gateway error", aiResp.status, t);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await aiResp.json();
    const call = data.choices?.[0]?.message?.tool_calls?.[0];
    let parsed: any = null;
    if (call?.function?.arguments) {
      try { parsed = JSON.parse(call.function.arguments); } catch { /* ignore */ }
    }
    const fuel = Number(parsed?.fuel_l_per_hour);
    if (!Number.isFinite(fuel) || fuel <= 0 || fuel > 1000) {
      return new Response(JSON.stringify({ error: "No usable estimate returned." }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        fuel_l_per_hour: Math.round(fuel * 10) / 10,
        confidence: parsed?.confidence ?? "low",
        notes: parsed?.notes ?? null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("suggest-tractor-fuel error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
