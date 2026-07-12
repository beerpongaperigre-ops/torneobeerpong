const app = document.getElementById("app");
const sessionKey = "aperigre-team-session";
let cachedState = null;
let busy = false;

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[ch]));
}

function session() {
  try { return JSON.parse(localStorage.getItem(sessionKey) || "null"); } catch { return null; }
}

function setSession(value) { localStorage.setItem(sessionKey, JSON.stringify(value)); }
function clearSession() { localStorage.removeItem(sessionKey); }

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
  return cachedState;
}

function stateAge(state) {
  const timestamp = Date.parse(state?.updatedAtUtc || "");
  if (!timestamp) return "offline";
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  return seconds <= 12 ? "online" : `offline da ${seconds}s`;
}

function tables(state) { return Array.isArray(state?.tavoli) ? state.tavoli : Object.values(state?.tavoli || {}); }
function groups(state) { return Array.isArray(state?.gironi) ? state.gironi : Object.values(state?.gironi || {}); }
function teams(table) { return Array.isArray(table?.partita?.squadre) ? table.partita.squadre : Object.values(table?.partita?.squadre || {}); }
function players(team) { return Array.isArray(team?.giocatori) ? team.giocatori : Object.values(team?.giocatori || {}); }

function go(path) { history.pushState({}, "", path); render(); }
window.addEventListener("popstate", render);

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
      <div class="hero-meta"><span>@APERIGRE_</span><span>2026</span><span>#APERIGRE2026</span></div>
      <div class="brand"><h1>APERIGRE</h1><p>BEER PONG 2026</p></div>
      <div class="event-row"><strong>TORNEO LIVE</strong><strong>MAGRE DI SCHIO</strong></div>
      <div class="subline">Punteggi, gironi, risultati e area squadre</div>
    </section>
    <section class="menu-grid">
      <button class="menu-button" data-go="/calendario">Calendario</button>
      <button class="menu-button" data-go="/classifiche">Classifiche live</button>
      <button class="menu-button" data-go="/gironi">Gironi</button>
      <button class="menu-button" data-go="/risultati">Risultati</button>
      <button class="menu-button" data-go="/campi">Area campi</button>
      <button class="menu-button" data-go="/squadra">Squadra</button>
      <button class="menu-button" data-go="/admin">Admin</button>
    </section>
  `;
  app.querySelectorAll("[data-go]").forEach(button => button.addEventListener("click", () => go(button.dataset.go)));
}

async function renderDashboard(kind) {
  const state = await loadState();
  if (kind === "admin") {
    shell("Admin", `<div class="card"><h2>Stato sincronizzazione</h2><p>Fase: ${esc(state.fase || "-")}</p><p>Ultimo aggiornamento: ${esc(state.updatedAtUtc || "-")}</p><p>Bridge: ${esc(state.bridgeVersion || "-")}</p><p>${esc(state.lastError || "Nessun errore")}</p></div>`, state);
    return;
  }
  if (kind === "campi" || kind === "calendario") {
    shell(kind === "campi" ? "Area Campi" : "Calendario", `<div class="grid">${tables(state).map(tableCard).join("")}</div>`, state);
    return;
  }
  if (kind === "gironi" || kind === "classifiche") {
    shell(kind === "gironi" ? "Gironi" : "Classifiche Live", `<div class="grid">${groups(state).map(groupCard).join("")}</div>`, state);
    return;
  }
  shell("Risultati", `<div class="grid">${groups(state).flatMap(g => g.partite || []).map(matchCard).join("") || `<div class="card"><p>Nessun risultato.</p></div>`}</div>`, state);
}

function tableCard(table) {
  const matchTeams = teams(table);
  return `<article class="card"><h2>Tavolo ${esc(table.nome)}</h2>${matchTeams.length ? matchTeams.map(t => `<p>${esc(t.nome)}: <strong>${esc(t.punti ?? 0)}</strong></p>`).join("") : `<p>Nessuna partita assegnata.</p>`}</article>`;
}

function groupCard(group) {
  const rows = group.squadre || [];
  return `<article class="card"><h2>Girone ${esc(group.nome)}</h2>${rows.map(t => `<p>${esc(t.posizione)}. ${esc(t.nome)} - <strong>${esc(t.punti ?? 0)} pt</strong></p>`).join("") || `<p>Nessuna squadra.</p>`}</article>`;
}

function matchCard(match) {
  return `<article class="card"><h2>${esc(match.squadra1)} ${esc(match.punti1 ?? 0)} - ${esc(match.punti2 ?? 0)} ${esc(match.squadra2)}</h2><p>${esc(match.stato || "-")}</p></article>`;
}

async function login(event) {
  event.preventDefault();
  const username = event.target.username.value.trim();
  const password = event.target.password.value;
  const result = await api("login", { username, password });
  if (!result.ok) throw new Error(result.error || "Credenziali non valide");
  setSession({ teamName: result.teamName, username });
  go("/squadra");
}

function renderLogin() {
  shell("Area Squadra", `
    <form class="poster hero login" data-login>
      <div class="brand"><h1>LOGIN</h1><p>SQUADRA</p></div>
      <label class="field">Utente<input class="input" name="username" autocomplete="username" required></label>
      <label class="field">Password<input class="input" name="password" type="password" autocomplete="current-password" required></label>
      <div class="actions"><button class="panel-button" type="submit">Entra</button><button class="panel-button secondary" type="button" data-home>Home</button></div>
      <div class="notice">Le credenziali si configurano nel foglio Google, tab Teams.</div>
    </form>
  `);
  app.querySelector("[data-login]").addEventListener("submit", async event => {
    try { await login(event); } catch (error) { alert(error.message); }
  });
  app.querySelector("[data-home]").addEventListener("click", () => go("/"));
}

async function renderTeamPage() {
  const current = session();
  if (!current) { renderLogin(); return; }
  const state = await loadState();
  const table = tables(state).find(t => teams(t).some(team => String(team.nome).toLowerCase() === String(current.teamName).toLowerCase()));
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
    await renderTeamPage();
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
  await renderTeamPage();
}

async function render() {
  const path = location.pathname.replace(/^\//, "") || "home";
  try {
    if (path === "home") return renderHome();
    if (path === "squadra") return await renderTeamPage();
    if (["calendario", "classifiche", "gironi", "risultati", "campi", "admin"].includes(path)) return await renderDashboard(path);
    renderHome();
  } catch (error) {
    shell("Errore", `<div class="card"><h2>Qualcosa non torna</h2><p>${esc(error.message)}</p><div class="actions"><button class="panel-button" data-home>Home</button></div></div>`);
    const home = app.querySelector("[data-home]");
    if (home) home.addEventListener("click", () => go("/"));
  }
}

render();
setInterval(() => {
  if (location.pathname === "/squadra" && session()) renderTeamPage();
}, 1500);
