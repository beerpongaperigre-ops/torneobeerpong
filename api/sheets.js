const endpoint = process.env.GOOGLE_SHEETS_ENDPOINT;
const secret = process.env.GOOGLE_SHEETS_SECRET || process.env.API_SECRET || "";

function normalizeEndpoint(value) {
  return String(value || "").trim();
}

async function callSheet(action, payload = {}) {
  const scriptUrl = normalizeEndpoint(endpoint);
  if (!scriptUrl) {
    throw new Error("GOOGLE_SHEETS_ENDPOINT non configurato su Vercel");
  }

  if (!scriptUrl.includes("script.google.com") || !scriptUrl.includes("/exec")) {
    throw new Error("GOOGLE_SHEETS_ENDPOINT deve essere l'URL Web App di Apps Script che termina con /exec");
  }

  const response = await fetch(scriptUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, secret, ...payload })
  });

  const text = await response.text();
  const contentType = response.headers.get("content-type") || "";

  if (!contentType.includes("application/json")) {
    const looksLikeGoogleLogin = text.includes("ServiceLogin") || text.includes("accounts.google") || text.includes("storage_access");
    if (looksLikeGoogleLogin) {
      throw new Error("Google Apps Script non e' pubblico: pubblica la Web App con accesso 'Anyone' e usa l'URL /exec.");
    }

    throw new Error("Google Apps Script ha risposto con HTML invece che JSON. Controlla GOOGLE_SHEETS_ENDPOINT e la pubblicazione Web App.");
  }

  const data = text ? JSON.parse(text) : {};
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || `Google Sheets HTTP ${response.status}`);
  }

  return data;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    const body = req.method === "POST" ? (req.body || {}) : {};
    const action = req.method === "GET" ? (req.query.action || "getState") : (body.action || "getState");

    if (action === "getState") {
      return res.status(200).json(await callSheet("getState"));
    }

    if (action === "login") {
      return res.status(200).json(await callSheet("login", {
        username: body.username,
        password: body.password
      }));
    }

    if (action === "command") {
      return res.status(200).json(await callSheet("addCommand", { command: body.command }));
    }

    return res.status(400).json({ ok: false, error: "Azione non valida" });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || String(error) });
  }
};
