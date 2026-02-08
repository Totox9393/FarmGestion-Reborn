import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const isPrivateHost = (host: string) => {
  const lower = host.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".local")) return true;
  return (
    lower.startsWith("127.") ||
    lower.startsWith("10.") ||
    lower.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(lower) ||
    lower === "0.0.0.0"
  );
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  // Allow Supabase client default headers so preflight passes
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
  }

  let body: { imageUrl?: string } = {};
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400, headers: corsHeaders });
  }

  const imageUrl = body.imageUrl?.trim();
  if (!imageUrl) {
    return new Response(JSON.stringify({ error: "Missing imageUrl" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  let url: URL;
  try {
    url = new URL(imageUrl);
  } catch {
    return new Response("Invalid URL", { status: 400, headers: corsHeaders });
  }

  if (!/^https?:$/.test(url.protocol)) {
    return new Response(JSON.stringify({ error: "Only http/https allowed" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  if (isPrivateHost(url.hostname)) {
    return new Response(JSON.stringify({ error: "Blocked host" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  try {
    const response = await fetch(url.toString());
    if (!response.ok) {
      return new Response(
        JSON.stringify({ error: "Fetch failed", status: response.status }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const contentType = response.headers.get("content-type") || "image/png";
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength && contentLength > MAX_BYTES) {
      return new Response(JSON.stringify({ error: "Image too large" }), {
        status: 413,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_BYTES) {
      return new Response(JSON.stringify({ error: "Image too large" }), {
        status: 413,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Chunked conversion to avoid "Maximum call stack size exceeded" on large arrays
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunkSize = 0x8000; // 32KB
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    const base64 = btoa(binary);
    const dataUrl = `data:${contentType};base64,${base64}`;

    return new Response(JSON.stringify({ dataUrl }), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Fetch error", message: err?.message ?? String(err) }),
      { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});
