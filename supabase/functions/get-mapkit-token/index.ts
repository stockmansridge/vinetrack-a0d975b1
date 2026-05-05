// Mints a short-lived MapKit JS token (ES256 JWT) using Apple credentials
// stored as Lovable Cloud secrets. No request body required.
//
// Required secrets (set in Cloud → Functions → Secrets):
//   APPLE_MAPKIT_PRIVATE_KEY  (full .p8 contents, BEGIN/END lines included)
//   APPLE_TEAM_ID             (10-char Team ID)
//   APPLE_MAPKIT_KEY_ID       (10-char Key ID for the MapKit JS key)
//
// Returns: { token: string, expiresAt: number } — token TTL ~30 min.
// READ-ONLY: this function only signs and returns a token; no DB access.

import { corsHeaders } from "@supabase/supabase-js/cors";

const TTL_SECONDS = 60 * 30; // 30 minutes

function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function b64urlEncodeStr(str: string): string {
  return b64urlEncode(new TextEncoder().encode(str));
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const cleaned = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(cleaned);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

// Apple wants raw R||S (64 bytes), WebCrypto returns that already for P-256.
async function signES256(privateKeyPem: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(privateKeyPem),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(data),
  );
  return new Uint8Array(sig);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const privateKey = Deno.env.get("APPLE_MAPKIT_PRIVATE_KEY");
  const teamId = Deno.env.get("APPLE_TEAM_ID");
  const keyId = Deno.env.get("APPLE_MAPKIT_KEY_ID");

  if (!privateKey || !teamId || !keyId) {
    return new Response(
      JSON.stringify({
        error: "mapkit_not_configured",
        message:
          "Apple MapKit secrets are not set. The portal will fall back to OpenStreetMap.",
      }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + TTL_SECONDS;

    const header = { alg: "ES256", kid: keyId, typ: "JWT" };
    const payload = { iss: teamId, iat: now, exp };

    const signingInput =
      b64urlEncodeStr(JSON.stringify(header)) + "." + b64urlEncodeStr(JSON.stringify(payload));
    const sig = await signES256(privateKey, signingInput);
    const token = signingInput + "." + b64urlEncode(sig);

    return new Response(JSON.stringify({ token, expiresAt: exp * 1000 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err) {
    console.error("get-mapkit-token error", err);
    return new Response(
      JSON.stringify({ error: "sign_failed", message: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
