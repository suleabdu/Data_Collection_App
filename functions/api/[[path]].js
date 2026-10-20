export async function onRequest(context) {
  const { request, env } = context;

  // Get the Google Apps Script URL from Cloudflare Environment Variables or fallback
  const APPS_SCRIPT_URL = env.APPS_SCRIPT_URL || "https://script.google.com/macros/s/AKfycbwygXAWi9n5HF7PF5bf3QrA5bUD0lZJlhLLeruCsVQn3GngJ2x4dK__penZonXuK4dwAQ/exec";

  const url = new URL(request.url);
  const targetUrl = new URL(APPS_SCRIPT_URL);

  // Forward query parameters (like ?action=getGeography)
  url.searchParams.forEach((value, key) => {
    targetUrl.searchParams.set(key, value);
  });

  const proxyRequest = new Request(targetUrl.toString(), {
    method: request.method,
    headers: request.headers,
    body: request.method !== "GET" && request.method !== "HEAD" ? await request.clone().arrayBuffer() : undefined,
    redirect: "follow"
  });

  try {
    const response = await fetch(proxyRequest);
    return new Response(response.body, {
      status: response.status,
      headers: response.headers
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: { message: "Proxy error: " + err.message } }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}