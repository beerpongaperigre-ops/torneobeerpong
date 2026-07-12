const endpoint = process.env.GOOGLE_SHEETS_ENDPOINT;
const secret = process.env.GOOGLE_SHEETS_SECRET || process.env.API_SECRET || "";

async function callSheet(action, payload = {}) {
  if (!endpoint) {
    throw new Error("GOOGLE_SHEETS_ENDPOINT non configurato su Vercel");
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, secret, ...payload })
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `Google Sheets HTTP ${response.status}`);
  }

  return text ? JSON.parse(text) : {};
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
