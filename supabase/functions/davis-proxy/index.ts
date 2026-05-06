import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DAVIS_PROVIDER = "davis_weatherlink";
const DAVIS_BASE_URL = "https://api.weatherlink.com/v2";

const BodySchema = z
  .object({
    action: z.enum(["test_saved", "test"]),
    vineyardId: z.string().uuid(),
    apiKey: z.string().min(1).optional(),
    apiSecret: z.string().min(1).optional(),
    stationId: z.string().trim().min(1).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.action === "test") {
      if (!value.apiKey) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "apiKey is required for test", path: ["apiKey"] });
      }
      if (!value.apiSecret) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "apiSecret is required for test", path: ["apiSecret"] });
      }
    }
  });

type TestStatusCode = "ok" | "davis_invalid_credentials" | "davis_station_not_found" | "error";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function mapDavisFailure(status: number, message?: string) {
  const normalized = (message ?? "").toLowerCase();

  if (status === 401 || normalized.includes("invalid authentication credentials")) {
    return {
      code: "davis_invalid_credentials",
      httpStatus: 400,
      message: "Davis rejected the credentials. Check API key, secret, and station ID.",
      statusForRow: "davis_invalid_credentials" as TestStatusCode,
    };
  }

  if (status === 404) {
    return {
      code: "davis_station_not_found",
      httpStatus: 400,
      message: "Davis could not find that station. Check the station ID.",
      statusForRow: "davis_station_not_found" as TestStatusCode,
    };
  }

  return {
    code: `davis_http_${status}`,
    httpStatus: 502,
    message: message || `Davis returned HTTP ${status}.`,
    statusForRow: "error" as TestStatusCode,
  };
}

async function updateStoredTestStatus(
  serviceClient: ReturnType<typeof createClient>,
  vineyardId: string,
  lastTestStatus: TestStatusCode,
) {
  const { error } = await serviceClient
    .from("vineyard_weather_integrations")
    .update({
      last_test_status: lastTestStatus,
      last_tested_at: new Date().toISOString(),
    })
    .eq("vineyard_id", vineyardId)
    .eq("provider", DAVIS_PROVIDER);

  if (error) {
    console.error("davis-proxy updateStoredTestStatus failed", error.message);
  }
}

async function runDavisCheck(args: { apiKey: string; apiSecret: string; stationId?: string | null }) {
  const stationId = args.stationId?.trim() || null;
  const endpoint = stationId
    ? `${DAVIS_BASE_URL}/stations/${encodeURIComponent(stationId)}?api-key=${encodeURIComponent(args.apiKey)}`
    : `${DAVIS_BASE_URL}/stations?api-key=${encodeURIComponent(args.apiKey)}`;

  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "x-api-secret": args.apiSecret,
    },
  });

  let body: any = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    return {
      ok: false as const,
      ...mapDavisFailure(response.status, body?.message ?? body?.error ?? undefined),
    };
  }

  return {
    ok: true as const,
    message: stationId
      ? "Saved Davis credentials are valid for this station."
      : "Saved Davis credentials are valid.",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ code: "method_not_allowed", message: "Use POST." }, 405);
  }

  try {
    const supabaseUrl = getEnv("SUPABASE_URL");
    const supabaseAnonKey = getEnv("SUPABASE_ANON_KEY");
    const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

    const authHeader = req.headers.get("Authorization") || req.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) {
      return json({ code: "unauthorized", message: "Missing bearer token." }, 401);
    }

    const bodyResult = BodySchema.safeParse(await req.json().catch(() => null));
    if (!bodyResult.success) {
      return json(
        {
          code: "invalid_payload",
          message: "Invalid request to weather service.",
          details: bodyResult.error.flatten().fieldErrors,
        },
        400,
      );
    }

    const body = bodyResult.data;

    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userError } = await authClient.auth.getUser(token);
    if (userError || !userData.user) {
      return json({ code: "unauthorized", message: "Invalid or expired session." }, 401);
    }

    const { data: membership, error: membershipError } = await serviceClient
      .from("vineyard_members")
      .select("role")
      .eq("vineyard_id", body.vineyardId)
      .eq("user_id", userData.user.id)
      .maybeSingle();

    if (membershipError) {
      console.error("davis-proxy membership lookup failed", membershipError.message);
      return json({ code: "forbidden", message: "Could not verify vineyard access." }, 403);
    }

    const role = membership?.role ?? null;
    if (role !== "owner" && role !== "manager") {
      return json({ code: "forbidden", message: "Only vineyard Owners and Managers can test weather credentials." }, 403);
    }

    let credentials: { apiKey: string; apiSecret: string; stationId?: string | null };

    if (body.action === "test_saved") {
      const { data: integration, error: integrationError } = await serviceClient
        .from("vineyard_weather_integrations")
        .select("api_key, api_secret, station_id")
        .eq("vineyard_id", body.vineyardId)
        .eq("provider", DAVIS_PROVIDER)
        .maybeSingle();

      if (integrationError) {
        console.error("davis-proxy integration lookup failed", integrationError.message);
        return json({ code: "error", message: "Could not load saved weather credentials." }, 500);
      }

      if (!integration?.api_key || !integration?.api_secret) {
        return json({ code: "davis_credentials_missing", message: "No Davis credentials are saved yet. Save settings first." }, 400);
      }

      credentials = {
        apiKey: integration.api_key,
        apiSecret: integration.api_secret,
        stationId: integration.station_id,
      };
    } else {
      credentials = {
        apiKey: body.apiKey!,
        apiSecret: body.apiSecret!,
        stationId: body.stationId ?? null,
      };
    }

    const result = await runDavisCheck(credentials);

    if (!result.ok) {
      if (body.action === "test_saved") {
        await updateStoredTestStatus(serviceClient, body.vineyardId, result.statusForRow);
      }

      return json(
        {
          ok: false,
          code: result.code,
          message: result.message,
          last_test_status: body.action === "test_saved" ? result.statusForRow : null,
          last_tested_at: body.action === "test_saved" ? new Date().toISOString() : null,
        },
        result.httpStatus,
      );
    }

    if (body.action === "test_saved") {
      await updateStoredTestStatus(serviceClient, body.vineyardId, "ok");
    }

    return json({
      ok: true,
      code: "ok",
      message: result.message,
      last_test_status: body.action === "test_saved" ? "ok" : null,
      last_tested_at: body.action === "test_saved" ? new Date().toISOString() : null,
    });
  } catch (error) {
    console.error("davis-proxy unexpected error", error instanceof Error ? error.message : error);
    return json({ code: "error", message: "Weather service request failed." }, 500);
  }
});