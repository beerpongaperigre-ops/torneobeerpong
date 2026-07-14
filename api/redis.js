const redisUrl = (process.env.UPSTASH_REDIS_REST_URL || process.env.REDIS_REST_URL || "").replace(/\/$/, "");
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.REDIS_REST_TOKEN || "";

const STATE_KEY = "torneo:state";
const COMMANDS_KEY = "torneo:commands";

async function redis(command) {
  if (!redisUrl || !redisToken) {
    throw new Error("Redis non configurato su Vercel: imposta UPSTASH_REDIS_REST_URL e UPSTASH_REDIS_REST_TOKEN");
  }

  const response = await fetch(redisUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${redisToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(command)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    throw new Error(data.error || `Redis HTTP ${response.status}`);
  }

  return data.result;
}

async function getState() {
  const raw = await redis(["GET", STATE_KEY]);
  return { ok: true, state: raw ? JSON.parse(raw) : null };
}

async function login(password) {
  const raw = await redis(["GET", STATE_KEY]);
  const state = raw ? JSON.parse(raw) : null;
  const requested = String(password || "").trim().toUpperCase();
  const credentials = Array.isArray(state?.teamCredentials) ? state.teamCredentials : [];
  const team = credentials.find(item => String(item?.password || "").trim().toUpperCase() === requested);
  if (!team) return { ok: false, error: "Password non valida" };
  return { ok: true, teamName: String(team.teamName || "") };
}

async function addCommand(command) {
  const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await redis(["RPUSH", COMMANDS_KEY, JSON.stringify({ id, ...(command || {}) })]);
  return { ok: true, id };
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    const body = req.method === "POST" ? (req.body || {}) : {};
    const action = req.method === "GET" ? (req.query.action || "getState") : (body.action || "getState");

    if (action === "getState") return res.status(200).json(await getState());
    if (action === "login") return res.status(200).json(await login(body.password));
    if (action === "command") return res.status(200).json(await addCommand(body.command));

    return res.status(400).json({ ok: false, error: "Azione non valida" });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || String(error) });
  }
};