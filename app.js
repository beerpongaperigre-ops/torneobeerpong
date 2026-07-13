const app = document.getElementById("app");
const sessionKey = "aperigre-team-session";
const notificationKeyPrefix = "aperigre-notified-match:";
const STATE_STALE_SECONDS = 60;
let cachedState = null;
let busy = false;
let latestRenderId = 0;

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[ch]));
}

function session() {
  try { return JSON.parse(localStorage.getItem(sessionKey) || "null"); } catch { return null; }
}

function setSession(value) { localStorage.setItem(sessionKey, JSON.stringify(value)); }
function clearSession() { localStorage.removeItem(sessionKey); }
function notificationKey(teamName) {
  return notificationKeyPrefix + String(teamName || "").toLowerCase();
}

function browserNotificationsAvailable() {
  return "Notification" in window && window.isSecureContext;
}

async function ensureNotificationPermission() {
  if (!browserNotificationsAvailable() || Notification.permission !== "default") return;
  try { await Notification.requestPermission(); } catch { }
}

function findTeamTable(state, teamName) {
  return tables(state).find(t => teams(t).some(team => String(team.nome).toLowerCase() === String(teamName).toLowerCase()));
}

function notifyTeamMatchIfNeeded(state) {
  const current = session();
  if (!current?.teamName || !browserNotificationsAvailable() || Notification.permission !== "granted") return;

  const table = findTeamTable(state, current.teamName);
  if (!table?.partita?.id) return;

  const key = notificationKey(current.teamName);
  if (localStorage.getItem(key) === String(table.partita.id)) return;
  localStorage.setItem(key, String(table.partita.id));

  const opponents = teams(table).map(team => team.nome).filter(Boolean).join(" vs ");
  const notification = new Notification("Partita iniziata", {
    body: `${current.teamName}: vai al tavolo ${table.nome}${opponents ? ` (${opponents})` : ""}`,
    tag: `match-${table.partita.id}`,
    renotify: true
  });
  notification.onclick = () => {
    window.focus();
    go("/squadra");
    notification.close();
  };
}

async function pollTeamNotification() {
  if (busy || !session()?.teamName) return;
  try {
    const state = await loadState();
    notifyTeamMatchIfNeeded(state);
  } catch { }
}

async function api(action, payload = {}) {
  const response = await fetch(`/api/sheets${action === "getState" ? "?action=getState" : ""}`, {
    method: action === "getState" ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: action === "getState" ? undefined : JSON.stringify({ action, ...payload })
  });
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(data.error || "Errore comunicazione");
  return data;
}

async function loadState() {
  const data = await api("getState");
  cachedState = data.state;
  if (!cachedState) throw new Error("Torneo non sincronizzato: abilita Google Sheets nel WinForms");
  if (stateAgeSeconds(cachedState) > STATE_STALE_SECONDS) throw new Error("PC offline o sincronizzazione Vercel disattivata nel WinForms");
  return cachedState;
}

function stateAgeSeconds(state) {
  const timestamp = Date.parse(state?.updatedAtUtc || "");
  if (!timestamp) return Infinity;
  return Math.max(0, Math.round((Date.now() - timestamp) / 1000));
}

function stateAge(state) {
  const seconds = stateAgeSeconds(state);
  if (!Number.isFinite(seconds)) return "offline";
  return seconds <= STATE_STALE_SECONDS ? "online" : `offline da ${seconds}s`;
}

function tables(state) { return Array.isArray(state?.tavoli) ? state.tavoli : Object.values(state?.tavoli || {}); }
function groups(state) { return Array.isArray(state?.gironi) ? state.gironi : Object.values(state?.gironi || {}); }
function teams(table) { return Array.isArray(table?.partita?.squadre) ? table.partita.squadre : Object.values(table?.partita?.squadre || {}); }
function players(team) { return Array.isArray(team?.giocatori) ? team.giocatori : Object.values(team?.giocatori || {}); }

function go(path) { if (location.pathname !== path) history.pushState({}, "", path); render(); }
document.querySelector("[data-brand-home]")?.addEventListener("click", () => go("/"));
window.addEventListener("popstate", () => render());

function shell(title, content, state) {
  app.innerHTML = `
    <div class="toolbar">
      <h1>${esc(title)}</h1>
      <div class="status">${state ? esc(stateAge(state)) : ""}</div>
    </div>
    ${content}
  `;
}

function renderHome() {
  app.innerHTML = `
    <section class="poster hero">
      <div class="hero-meta"><span>@APERIGRÈ_</span><span>2026</span><span>#APERIGRÈ2026</span></div>
      <div class="brand"><h1>APERIGRÈ</h1><p>BEER PONG 2026</p></div>
      <div class="event-row"><strong>TORNEO LIVE</strong><strong>MAGRE DI SCHIO</strong></div>
      <div class="subline">Punteggi, gironi, fasi finali e area squadre</div>
    </section>
    <section class="menu-grid">
<button class="menu-button" data-go="/gironi">Gironi</button>
      <button class="menu-button" data-go="/campi">Area campi</button>
      <button class="menu-button" data-go="/fasi-finali">Fasi finali</button>
      <button class="menu-button" data-go="/squadra">Squadra</button>
    </section>
  `;
  app.querySelectorAll("[data-go]").forEach(button => button.addEventListener("click", async () => {
    if (button.dataset.go === "/squadra") await ensureNotificationPermission();
    go(button.dataset.go);
  }));
}

async function renderDashboard(kind, renderId) {
  if (cachedState && stateAgeSeconds(cachedState) <= STATE_STALE_SECONDS) renderDashboardState(kind, cachedState);
  const state = await loadState();
  if (renderId !== latestRenderId) return;
  renderDashboardState(kind, state);
}

function renderDashboardState(kind, state) {
  if (kind === "campi") {
    shell("Area Campi", `<div class="grid">${tables(state).map(tableCard).join("")}</div>`, state);
    return;
  }
  if (kind === "gironi") {
    shell("Gironi", `<div class="grid wide-grid">${groups(state).map(groupCard).join("")}</div>`, state);
    return;
  }
  if (kind === "fasi-finali") {
    renderFinals(state);
    return;
  }
  renderHome();
}

function tableCard(table) {
  const matchTeams = teams(table);
  return `<article class="card"><h2>Tavolo ${esc(table.nome)}</h2>${matchTeams.length ? matchTeams.map(t => `<p>${esc(t.nome)}: <strong>${esc(t.punti ?? 0)}</strong></p>`).join("") : `<p>Nessuna partita assegnata.</p>`}</article>`;
}

function groupCard(group) {
  const rows = group.squadre || [];
  const matches = group.partite || [];
  return `<article class="card group-card"><h2>Girone ${esc(group.nome)}</h2>
    <div class="standings">${rows.map(t => `<p class="standing-row ${group.gironiConclusi ? (t.qualificata ? "qualified" : "eliminated") : ""}">${esc(t.posizione)}. ${esc(t.nome)} - <strong>${esc(t.punti ?? 0)} pt</strong></p>`).join("") || `<p>Nessuna squadra.</p>`}</div>
    <h3>Partite</h3>
    <div class="matches">${matches.map(matchMiniCard).join("") || `<p>Nessuna partita.</p>`}</div>
  </article>`;
}

function matchMiniCard(match) {
  return `<div class="match-row"><span>${esc(match.squadra1)}</span><strong>${esc(match.punti1 ?? 0)} - ${esc(match.punti2 ?? 0)}</strong><span>${esc(match.squadra2)}</span><small>${esc(match.stato || "-")}</small></div>`;
}

function matchCard(match) {
  return `<article class="card"><h2>${esc(match.squadra1)} ${esc(match.punti1 ?? 0)} - ${esc(match.punti2 ?? 0)} ${esc(match.squadra2)}</h2><p>${esc(match.stato || "-")}</p></article>`;
}

function renderFinals(state) {
  const finals = state.fasiFinali || {};
  if (!finals.disponibile) {
    shell("Fasi finali", `<div class="card"><h2>Non disponibili</h2><p>Le fasi finali saranno visibili quando vengono avviate da WinForms.</p></div>`, state);
    return;
  }

  const rounds = [
    ["Ottavi", finals.ottavi || []],
    ["Quarti", finals.quarti || []],
    ["Semifinali", finals.semifinali || []],
    ["Finale 3/4", finals.finali34 || []],
    ["Finale", finals.finali12 || []]
  ];
  shell("Fasi finali", `<div class="bracket">${rounds.map(([name, matches]) => `<section class="card bracket-round"><h2>${esc(name)}</h2>${matches.map(finalMatchCard).join("") || `<p>Da definire.</p>`}</section>`).join("")}</div>`, state);
}

function finalMatchCard(match) {
  return `<div class="final-match"><div><span>${esc(match.squadra1 || "-")}</span><strong>${esc(match.punti1 ?? 0)}</strong></div><div><span>${esc(match.squadra2 || "-")}</span><strong>${esc(match.punti2 ?? 0)}</strong></div><small>${esc(match.stato || "-")}</small></div>`;
}
async function login(event) {
  event.preventDefault();
  const password = event.target.password.value;
  const result = await api("login", { password });
  if (!result.ok) throw new Error(result.error || "Password non valida");
  setSession({ teamName: result.teamName });
  await ensureNotificationPermission();
  go("/squadra");
}

function renderLogin() {
  shell("Area Squadra", `
    <form class="poster hero login" data-login>
      <div class="brand"><h1>LOGIN</h1><p>SQUADRA</p></div>
<label class="field">Password<input class="input" name="password" type="password" autocomplete="current-password" required></label>
      <div class="actions"><button class="panel-button" type="submit">Entra</button><button class="panel-button secondary" type="button" data-home>Home</button></div>
</form>
  `);
  app.querySelector("[data-login]").addEventListener("submit", async event => {
    try { await login(event); } catch (error) { alert(error.message); }
  });
  app.querySelector("[data-home]").addEventListener("click", () => go("/"));
}

async function renderTeamPage(renderId) {
  const current = session();
  if (!current) { renderLogin(); return; }
  const state = await loadState();
  if (renderId !== latestRenderId) return;
  notifyTeamMatchIfNeeded(state);
  const table = findTeamTable(state, current.teamName);
  if (!table || !table.partita) {
    shell(current.teamName, `<div class="card"><h2>Nessuna partita al momento</h2><p>Aspetta la chiamata al tavolo.</p><div class="actions"><button class="panel-button secondary" data-logout>Esci</button></div></div>`, state);
    app.querySelector("[data-logout]").addEventListener("click", () => { clearSession(); go("/squadra"); });
    return;
  }

  const matchTeams = teams(table);
  const scoreLocked = matchTeams.some(team => team.consensoConcludi);
  shell(current.teamName, `
    <div class="notice">Partita al tavolo ${esc(table.nome)} - ${esc(table.partita.stato || "")}</div>
    <div class="score-layout">${matchTeams.map(team => renderTeam(team, table, scoreLocked)).join("")}</div>
    <div class="actions">
      <button class="panel-button" data-consent>${matchTeams.find(t => t.nome === current.teamName)?.consensoConcludi ? "Annulla consenso" : "Conferma fine partita"}</button>
      <button class="panel-button secondary" data-logout>Esci</button>
    </div>
  `, state);

  app.querySelectorAll("[data-score]").forEach(button => button.addEventListener("click", () => sendScore(button, table)));
  app.querySelector("[data-consent]").addEventListener("click", () => sendConsent(table, current.teamName));
  app.querySelector("[data-logout]").addEventListener("click", () => { clearSession(); go("/squadra"); });
}

function renderTeam(team, table, scoreLocked) {
  return `<section class="card team-card"><div class="team-top"><h2>${esc(team.nome)}</h2><div class="total">${esc(team.punti ?? 0)}</div></div>${players(team).map(player => `
    <div class="player"><div class="player-name">${esc(player.nome)}</div><div class="stepper">
      <button class="secondary" ${scoreLocked ? "disabled" : ""} data-score data-table="${esc(table.nome)}" data-match="${esc(table.partita.id)}" data-team="${esc(team.index)}" data-player="${esc(player.index)}" data-action="decrement">-</button>
      <div class="score">${esc(player.punti ?? 0)}</div>
      <button ${scoreLocked ? "disabled" : ""} data-score data-table="${esc(table.nome)}" data-match="${esc(table.partita.id)}" data-team="${esc(team.index)}" data-player="${esc(player.index)}" data-action="increment">+</button>
    </div></div>`).join("")}</section>`;
}

async function sendScore(button, table) {
  if (busy) return;
  busy = true;
  button.disabled = true;
  try {
    await api("command", { command: {
      type: "score",
      source: "teams",
      tavolo: button.dataset.table,
      matchId: button.dataset.match,
      team: `team${button.dataset.team}`,
      player: `player${button.dataset.player}`,
      action: button.dataset.action,
      clientCreatedAtUtc: new Date().toISOString()
    }});
    await renderTeamPage(++latestRenderId);
  } catch (error) {
    alert(error.message);
  } finally {
    busy = false;
  }
}

async function sendConsent(table, teamName) {
  await api("command", { command: {
    type: "consensoTerminate",
    source: "teams",
    tavolo: table.nome,
    matchId: table.partita.id,
    squadra: teamName,
    clientCreatedAtUtc: new Date().toISOString()
  }});
  await renderTeamPage(++latestRenderId);
}

async function render() {
  const renderId = ++latestRenderId;
  const path = location.pathname.replace(/^\//, "") || "home";
  try {
    if (path === "home") return renderHome();
    if (path === "squadra") return await renderTeamPage(renderId);
    if (["gironi", "campi", "fasi-finali"].includes(path)) return await renderDashboard(path, renderId);
    renderHome();
  } catch (error) {
    if (renderId !== latestRenderId) return;
    shell("Errore", `<div class="card"><h2>Qualcosa non torna</h2><p>${esc(error.message)}</p><div class="actions"><button class="panel-button" data-home>Home</button></div></div>`);
    const home = app.querySelector("[data-home]");
    if (home) home.addEventListener("click", () => go("/"));
  }
}

render();
setInterval(() => {
  const path = location.pathname;
  if (!busy && path !== "/" && path !== "" && !(path === "/squadra" && !session())) render();
}, 1000);
setInterval(pollTeamNotification, 3000);
