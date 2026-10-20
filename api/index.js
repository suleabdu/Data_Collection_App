export default async function handler(req, res) {
    // Pulls from Vercel Environment Variables, or falls back to your hardcoded deployment URL
    const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL || "https://script.google.com/macros/s/AKfycbwygXAWi9n5HF7PF5bf3QrA5bUD0lZJlhLLeruCsVQn3GngJ2x4dK__penZonXuK4dwAQ/exec";

    const targetUrl = new URL(APPS_SCRIPT_URL);

    // Forward query parameters
    for (const [key, value] of Object.entries(req.query)) {
        if (key !== 'path') targetUrl.searchParams.append(key, value);
    }

    try {
        const fetchOptions = {
            method: req.method,
            headers: {
                "Content-Type": "application/json",
                "X-Admin-Session": req.headers["x-admin-session"] || ""
            },
        };

        if (req.method !== 'GET' && req.method !== 'HEAD') {
            fetchOptions.body = JSON.stringify(req.body);
        }

        const response = await fetch(targetUrl.toString(), fetchOptions);
        const textData = await response.text();

        res.setHeader('Content-Type', 'application/json');
        return res.status(response.status).send(textData);
    } catch (error) {
        return res.status(500).json({
            success: false,
            error: { message: "Vercel Proxy Error: " + error.message }
        });
    }
}