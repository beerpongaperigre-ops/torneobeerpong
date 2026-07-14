const app = document.getElementById("app");
const sessionKey = "aperigre-team-session";
const notificationKeyPrefix = "aperigre-notified-match:";
const terminateKeyPrefix = "aperigre-terminate-scheduled:";
const STATE_STALE_SECONDS = 60;
let cachedState = null;
let busy = false;
let latestRenderId = 0;
let renderInProgress = false;
const pendingTerminateTimers = new Set();
const pendingScoreUpdates = new Map();

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

function sameTeam(a, b) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
}

function terminateKey(table) {
  return terminateKeyPrefix + String(table?.nome || "") + ":" + String(table?.partita?.id || "");
}

function browserNotificationsAvailable() {
  return "Notification" in window && window.isSecureContext;
}

async function ensureNotificationPermission() {
  if (!browserNotificationsAvailable() || Notification.permission !== "default") return;
  try { await Notification.requestPermission(); } catch { }
}

function findTeamTable(state, teamName) {
  return tables(state).find(t => teams(t).some(team => sameTeam(team.nome, teamName)));
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

function go(path) { if (location.pathname !== path) history.pushState({}, "", path); render(true); }
document.querySelector("[data-brand-home]")?.addEventListener("click", () => go("/"));
window.addEventListener("popstate", () => render(true));

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
  const form = event.target;
  const button = form.querySelector("[data-login-button]");
  const feedback = form.querySelector("[data-login-feedback]");
  const password = form.password.value;
  if (button) button.disabled = true;
  if (feedback) feedback.textContent = "Controllo password...";
  try {
    const result = await api("login", { password });
    if (!result.ok) throw new Error(result.error || "Password non valida");
    setSession({ teamName: result.teamName });
    if (feedback) feedback.textContent = `Accesso eseguito: ${result.teamName}`;
    await ensureNotificationPermission();
    go("/squadra");
  } catch (error) {
    if (feedback) feedback.textContent = error.message || "Password non valida";
    throw error;
  } finally {
    if (button) button.disabled = false;
  }
}

function renderLogin() {
  shell("Area Squadra", `
    <form class="poster hero login" data-login>
      <div class="brand"><h1>LOGIN</h1><p>SQUADRA</p></div>
<label class="field">Password<input class="input" name="password" type="password" autocomplete="current-password" required></label>
      <div class="actions"><button class="panel-button" type="submit" data-login-button>Entra</button><button class="panel-button secondary" type="button" data-home>Home</button></div>
      <div class="form-feedback" data-login-feedback></div>
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
  if (!cachedState || stateAgeSeconds(cachedState) > STATE_STALE_SECONDS) {
    shell(current.teamName, `<section class="poster hero team-waiting"><div class="brand"><h1>${esc(current.teamName)}</h1><p>CARICAMENTO</p></div><div class="empty-state">Controllo la tua partita...</div></section>`);
  }
  const state = await loadState();  if (renderId !== latestRenderId) return;
  notifyTeamMatchIfNeeded(state);
  const table = findTeamTable(state, current.teamName);
  if (!table || !table.partita) {
    shell(current.teamName, `<section class="poster hero team-waiting">
      <div class="brand"><h1>${esc(current.teamName)}</h1><p>NESSUNA PARTITA</p></div>
      <div class="empty-state">Aspetta la chiamata al tavolo.</div>
      <div class="actions"><button class="panel-button secondary" data-logout>Esci</button></div>
    </section>`, state);
    app.querySelector("[data-logout]").addEventListener("click", () => { clearSession(); go("/squadra"); });
    return;
  }

  const matchTeams = orderTeamsForCurrent(teams(table), current.teamName);
  const currentTeam = matchTeams.find(t => sameTeam(t.nome, current.teamName));
  const opponent = matchTeams.find(t => !sameTeam(t.nome, current.teamName));
  const scoreLocked = matchTeams.some(team => team.consensoConcludi);
  const bothConsented = matchTeams.length >= 2 && matchTeams.every(team => team.consensoConcludi);
  const canAskClose = !!table.partita.concludibile;
  scheduleTerminateIfReady(table, bothConsented && canAskClose);

  const consentText = currentTeam?.consensoConcludi ? "Annulla consenso" : "Conferma fine partita";
  const consentDisabled = !canAskClose;
  const closeMessage = closeStatusMessage(table, matchTeams, currentTeam, bothConsented, canAskClose);

  shell(current.teamName, `
    <section class="match-hero poster">
      <div class="hero-meta"><span>TAVOLO ${esc(table.nome)}</span><span>${esc(table.partita.stato || "-")}</span><span>${esc(stateAge(state))}</span></div>
      <div class="match-title"><h1>${esc(currentTeam?.nome || current.teamName)}</h1><p>vs ${esc(opponent?.nome || "-")}</p></div>
      <div class="match-score"><strong>${esc(currentTeam?.punti ?? 0)}</strong><span>-</span><strong>${esc(opponent?.punti ?? 0)}</strong></div>
      <div class="subline">${esc(closeMessage)}</div>
    </section>
    <div class="score-layout team-score-layout">${matchTeams.map(team => renderTeam(team, table, scoreLocked, current.teamName)).join("")}</div>
    <div class="actions team-actions">
      <button class="panel-button" data-consent ${consentDisabled ? "disabled" : ""}>${esc(consentText)}</button>
      <button class="panel-button secondary" data-refresh>Aggiorna</button>
      <button class="panel-button secondary" data-logout>Esci</button>
    </div>
    <div class="form-feedback" data-team-feedback></div>
  `, state);

  app.querySelectorAll("[data-score]").forEach(button => button.addEventListener("click", () => sendScore(button, table)));
  app.querySelector("[data-consent]").addEventListener("click", () => sendConsent(table, current.teamName));
  app.querySelector("[data-refresh]").addEventListener("click", () => renderTeamPage(++latestRenderId));
  app.querySelector("[data-logout]").addEventListener("click", () => { clearSession(); go("/squadra"); });
}

function orderTeamsForCurrent(matchTeams, teamName) {
  const own = matchTeams.find(team => sameTeam(team.nome, teamName));
  const others = matchTeams.filter(team => !sameTeam(team.nome, teamName));
  return own ? [own, ...others] : matchTeams;
}

function closeStatusMessage(table, matchTeams, currentTeam, bothConsented, canAskClose) {
  if (bothConsented && canAskClose) return "Entrambe le squadre hanno confermato: richiesta chiusura tra 10 secondi.";
  if (currentTeam?.consensoConcludi) return "Hai confermato la fine partita. Attesa conferma avversaria.";
  if (matchTeams.some(team => team.consensoConcludi)) return "L'altra squadra ha confermato la fine partita.";
  if (canAskClose) return "La partita e' terminabile: serve il consenso di entrambe le squadre.";
  return "Partita in corso: aggiorna i punti dei tuoi giocatori.";
}

function scheduleTerminateIfReady(table, ready) {
  if (!ready || !table?.partita?.id) return;
  const key = terminateKey(table);
  if (pendingTerminateTimers.has(key) || localStorage.getItem(key) === "sent") return;
  pendingTerminateTimers.add(key);
  localStorage.setItem(key, "scheduled");
  setTimeout(async () => {
    try {
      await api("command", { command: {
        type: "terminate",
        source: "teams",
        tavolo: table.nome,
        matchId: table.partita.id,
        clientCreatedAtUtc: new Date().toISOString()
      }});
      localStorage.setItem(key, "sent");
    } catch {
      localStorage.removeItem(key);
    } finally {
      pendingTerminateTimers.delete(key);
    }
  }, 10000);
}

function renderTeam(team, table, scoreLocked, currentTeamName) {
  const isMine = sameTeam(team.nome, currentTeamName);
  const scoreDisabled = scoreLocked || !isMine;
  const consent = team.consensoConcludi ? `<div class="team-badge">Consenso fine inviato</div>` : "";
  return `<section class="card team-card ${isMine ? "own-team" : ""}"><div class="team-top"><div><h2>${esc(team.nome)}</h2>${consent}</div><div class="total">${esc(displayTeamTotal(team, table))}</div></div>${players(team).map(player => `
    <div class="player"><div class="player-name">${esc(player.nome)}</div><div class="stepper">
      <button class="secondary" ${scoreDisabled ? "disabled" : ""} data-score data-table="${esc(table.nome)}" data-match="${esc(table.partita.id)}" data-team="${esc(team.index)}" data-player="${esc(player.index)}" data-action="decrement">-</button>
      <div class="score">${esc(displayPlayerScore(team, player, table))}</div>
      <button ${scoreDisabled ? "disabled" : ""} data-score data-table="${esc(table.nome)}" data-match="${esc(table.partita.id)}" data-team="${esc(team.index)}" data-player="${esc(player.index)}" data-action="increment">+</button>
    </div></div>`).join("")}</section>`;
}

function scoreUpdateKey(tableName, matchId, teamIndex, playerIndex) {
  return [tableName, matchId, teamIndex, playerIndex].map(value => String(value || "")).join(":");
}

function rememberOptimisticScore(button, expectedValue) {
  const key = scoreUpdateKey(button.dataset.table, button.dataset.match, button.dataset.team, button.dataset.player);
  pendingScoreUpdates.set(key, {
    expected: expectedValue,
    action: button.dataset.action,
    expiresAt: Date.now() + 15000
  });
}

function displayPlayerScore(team, player, table) {
  const key = scoreUpdateKey(table?.nome, table?.partita?.id, team?.index, player?.index);
  const pending = pendingScoreUpdates.get(key);
  const serverValue = Number(player?.punti || 0);
  if (!pending) return serverValue;
  if (Date.now() > pending.expiresAt) {
    pendingScoreUpdates.delete(key);
    return serverValue;
  }
  const reached = pending.action === "decrement" ? serverValue <= pending.expected : serverValue >= pending.expected;
  if (reached) {
    pendingScoreUpdates.delete(key);
    return serverValue;
  }
  return pending.expected;
}

function displayTeamTotal(team, table) {
  return players(team).reduce((sum, player) => sum + displayPlayerScore(team, player, table), 0);
}
function applyOptimisticScore(button) {
  const delta = button.dataset.action === "decrement" ? -1 : 1;
  const stepper = button.closest(".stepper");
  const scoreEl = stepper?.querySelector(".score");
  const card = button.closest(".team-card");
  const totalEl = card?.querySelector(".total");
  const expectedValue = Math.max(0, Number(scoreEl?.textContent || 0) + delta);
  if (scoreEl) scoreEl.textContent = expectedValue;
  if (totalEl) totalEl.textContent = Math.max(0, Number(totalEl.textContent || 0) + delta);
  rememberOptimisticScore(button, expectedValue);

  const tableState = tables(cachedState).find(t => String(t.nome) === String(button.dataset.table) && String(t.partita?.id) === String(button.dataset.match));
  const teamState = teams(tableState).find(t => String(t.index) === String(button.dataset.team));
  const playerState = players(teamState).find(p => String(p.index) === String(button.dataset.player));
  if (playerState) playerState.punti = Math.max(0, Number(playerState.punti || 0) + delta);
  if (teamState) teamState.punti = players(teamState).reduce((sum, player) => sum + Number(player.punti || 0), 0);
}

function scheduleFastTeamRefresh() {
  [250, 600, 1000, 1600, 2500, 4000].forEach(delay => {
    setTimeout(() => {
      if (!busy && location.pathname === "/squadra") render(true);
    }, delay);
  });
}
async function sendScore(button, table) {
  if (busy) return;
  busy = true;
  const feedback = app.querySelector("[data-team-feedback]");
  button.disabled = true;
  applyOptimisticScore(button);
  if (feedback) feedback.textContent = "Punto aggiornato. Invio a WinForms...";
  try {
    await api("command", { command: {
      type: "score",
      source: "teams",
      tavolo: button.dataset.table,
      matchId: button.dataset.match,
      team: `team${button.dataset.team}`,
      player: `player${button.dataset.player}`,
      action: button.dataset.action,
      squadra: session()?.teamName || "",
      clientCreatedAtUtc: new Date().toISOString()
    }});
    if (feedback) feedback.textContent = "Punto inviato. Sincronizzo con WinForms...";
    scheduleFastTeamRefresh();
  } catch (error) {
    if (feedback) feedback.textContent = error.message;
  } finally {
    busy = false;
  }
}

async function sendConsent(table, teamName) {
  if (busy) return;
  busy = true;
  const feedback = app.querySelector("[data-team-feedback]");
  if (feedback) feedback.textContent = "Invio consenso...";
  try {
    await api("command", { command: {
      type: "consensoTerminate",
      source: "teams",
      tavolo: table.nome,
      matchId: table.partita.id,
      squadra: teamName,
      clientCreatedAtUtc: new Date().toISOString()
    }});
    if (feedback) feedback.textContent = "Consenso inviato. Sincronizzo con WinForms...";
    scheduleFastTeamRefresh();
  } catch (error) {
    if (feedback) feedback.textContent = error.message;
  } finally {
    busy = false;
  }
}
async function render(force = false) {
  if (renderInProgress && !force) return;
  renderInProgress = true;
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
  } finally {
    renderInProgress = false;
  }
}

render();
setInterval(() => {
  const path = location.pathname;
  if (!busy && !renderInProgress && path !== "/" && path !== "" && !(path === "/squadra" && !session())) render();
}, 1000);
setInterval(pollTeamNotification, 3000);
