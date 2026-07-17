const app = document.getElementById("app");
const sessionKey = "aperigre-team-session";
const notificationKeyPrefix = "aperigre-notified-match:";
const terminateKeyPrefix = "aperigre-terminate-scheduled:";
const STATE_STALE_SECONDS = 60;
let cachedState = null;
let busy = false;
let latestRenderId = 0;
let renderInProgress = false;
let teamOfflineActive = false;
const pendingTerminateTimers = new Map();
const pendingScoreUpdates = new Map();

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[ch]));
}

function eventYear() {
  return new Date().getFullYear();
}

function updateTopStripYear() {
  const hashtag = document.querySelector("[data-event-hashtag]");
  if (hashtag) hashtag.textContent = `#APERIGRÈ${eventYear()}`;
}

function session() {
  try { return JSON.parse(localStorage.getItem(sessionKey) || "null"); } catch { return null; }
}

function setSession(value) { localStorage.setItem(sessionKey, JSON.stringify(value)); }
function clearSession() { localStorage.removeItem(sessionKey); }
function normalizePassword(value) { return String(value || "").trim().toUpperCase(); }
function sessionMatchesState(current, state) {
  if (!current?.teamName || !current?.password) return false;
  const credentials = Array.isArray(state?.teamCredentials) ? state.teamCredentials : [];
  return credentials.some(item =>
    sameTeam(item?.teamName, current.teamName) &&
    normalizePassword(item?.password) === normalizePassword(current.password)
  );
}
function notificationKey(teamName) {
  return notificationKeyPrefix + String(teamName || "").toLowerCase();
}

function sameTeam(a, b) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
}

function terminateKey(table) {
  return terminateKeyPrefix + String(table?.nome || "") + ":" + String(table?.partita?.id || "");
}

function terminateSentKey(table) {
  return terminateKey(table) + ":sent";
}

function terminateDueAtKey(table) {
  return terminateKey(table) + ":dueAt";
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
  const response = await fetch(`/api/redis${action === "getState" ? "?action=getState" : ""}`, {
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
  if (!cachedState) throw new Error("Torneo non sincronizzato: abilita Vercel nell'host");
  if (stateAgeSeconds(cachedState) > STATE_STALE_SECONDS) throw new Error("Host offline o sincronizzazione Vercel disattivata");
  teamOfflineActive = false;
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

function shell(title, content, state, viewClass = "") {
  app.className = `app-shell${viewClass ? ` ${viewClass}` : ""}`;
  app.innerHTML = `
    <div class="toolbar">
      <h1>${esc(title)}</h1>
      <div class="status">${state ? esc(stateAge(state)) : ""}</div>
    </div>
    ${content}
  `;
}

function renderHome() {
  const year = eventYear();
  app.className = "app-shell";
  app.innerHTML = `
    <section class="poster hero">
      <div class="hero-meta"><span>@APERIGRÈ_</span><span>${esc(year)}</span><span>#APERIGRÈ${esc(year)}</span></div>
      <div class="brand"><h1>APERIGRÈ</h1><p>BEER PONG ${esc(year)}</p></div>
      <div class="event-row"><strong>TORNEO LIVE</strong><strong>MAGRÈ DI SCHIO</strong></div>
      <div class="subline">Punteggi, gironi, fasi finali e area squadre</div>
    </section>
    <section class="menu-grid">
<button class="menu-button" data-go="/gironi">Gironi</button>
      <button class="menu-button" data-go="/classifica-giocatori">Classifica giocatori</button>
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
  if (kind === "classifica-giocatori") {
    renderPlayerRanking(state);
    return;
  }
  renderHome();
}

function renderPlayerRanking(state) {
  const ranking = Array.isArray(state.classificaGiocatori) ? state.classificaGiocatori : [];
  const rows = ranking.map(player => `
    <div class="leaderboard-row player-rank-${esc(player.posizione)}">
      <strong class="leaderboard-position">${esc(player.posizione)}</strong>
      <span class="leaderboard-name">${esc(player.nome)}</span>
      <span class="leaderboard-team">${esc(player.squadra)}</span>
      <span>${esc(player.centriFatti ?? 0)}</span>
      <span>${esc(player.centriSubiti ?? 0)}</span>
      <span>${esc(player.differenza ?? 0)}</span>
      <span>${esc(player.partiteFatte ?? 0)}</span>
      <strong>${Number(player.rateo || 0).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
    </div>`).join("");

  shell("Classifica giocatori", `
    <div class="leaderboard-wrap">
      <div class="leaderboard">
        <div class="leaderboard-row leaderboard-head">
          <span>Pos.</span><span>Giocatore</span><span>Squadra</span><span>Fatti</span>
          <span>Subiti</span><span>Diff.</span><span>Partite</span><span>Rateo</span>
        </div>
        ${rows || `<div class="leaderboard-empty">Classifica non ancora disponibile.</div>`}
      </div>
    </div>`, state);
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
  return `<div class="match-row">
    ${matchTeamResult(match, 1)}
    <span class="match-versus">VS</span>
    ${matchTeamResult(match, 2)}
  </div>`;
}

function matchCard(match) {
  return `<article class="card"><div class="match-row">${matchTeamResult(match, 1)}<span class="match-versus">VS</span>${matchTeamResult(match, 2)}</div></article>`;
}

function matchOutcome(match) {
  const status = String(match?.stato || "").trim().toUpperCase();
  if (status === "VINTA_1") return { winner: 1, overtime: false };
  if (status === "VINTA_2") return { winner: 2, overtime: false };
  if (status === "VINTASUPPL_1") return { winner: 1, overtime: true };
  if (status === "VINTASUPPL_2") return { winner: 2, overtime: true };
  return { winner: 0, overtime: false };
}

function matchTeamResult(match, teamIndex) {
  const outcome = matchOutcome(match);
  const resultClass = outcome.winner === teamIndex
    ? (outcome.overtime ? "match-team-overtime" : "match-team-winner")
    : (outcome.winner ? "match-team-loser" : "");
  const name = match?.[`squadra${teamIndex}`] || "-";
  const points = match?.[`punti${teamIndex}`] ?? 0;
  return `<div class="match-team-result ${resultClass}"><span title="${esc(name)}">${esc(name)}</span><strong>${esc(points)}</strong></div>`;
}

function renderFinals(state) {
  const finals = state.fasiFinali || {};
  if (!finals.disponibile) {
    shell("Fasi finali", `<div class="card"><h2>Non disponibili</h2><p>Le fasi finali saranno visibili quando vengono avviate dall'host.</p></div>`, state);
    return;
  }

  const previousStage = app.querySelector(".bracket-stage");
  const previousScroll = previousStage
    ? { left: previousStage.scrollLeft, top: previousStage.scrollTop }
    : { left: 0, top: 0 };
  const allRounds = Array.isArray(finals.rounds) && finals.rounds.length
    ? finals.rounds.map(round => [round.nome, round.partite || []])
    : [
        ...(Array.isArray(finals.sedicesimi) && finals.sedicesimi.some(match => match.id)
          ? [["Sedicesimi", finals.sedicesimi]]
          : []),
        ["Ottavi", finals.ottavi || []],
        ["Quarti", finals.quarti || []],
        ["Semifinali", finals.semifinali || []],
        ["Finale", finals.finali12 || []],
        ["Finale 3/4", finals.finali34 || []]
      ];

  const thirdPlace = allRounds.find(([name]) => String(name).includes("3/4"));
  const rounds = allRounds.filter(([name, matches]) =>
    !String(name).includes("3/4") && Array.isArray(matches) && matches.length);
  if (!rounds.length) {
    shell("Fasi finali", `<div class="card"><h2>Tabellone in preparazione</h2><p>Le partite saranno visibili appena definite dall'host.</p></div>`, state);
    return;
  }

  const cardWidth = 226;
  const cardHeight = 88;
  const columnGap = 86;
  const titleHeight = 46;
  const baseCount = Math.max(...rounds.map(([, matches]) => matches.length));
  const slotHeight = baseCount >= 16 ? 102 : 114;
  const treeWidth = rounds.length * cardWidth + Math.max(0, rounds.length - 1) * columnGap;
  const treeHeight = Math.max(430, titleHeight + baseCount * slotHeight + 24);
  const cardTop = (matchIndex, matchCount) =>
    titleHeight + ((matchIndex + .5) * baseCount / matchCount * slotHeight) - cardHeight / 2;

  const columns = rounds.map(([name, matches], roundIndex) => {
    const left = roundIndex * (cardWidth + columnGap);
    return `<section class="bracket-round" data-round-index="${roundIndex}" style="left:${left}px;width:${cardWidth}px">
      <h2>${esc(name)}</h2>
      ${matches.map((match, matchIndex) => finalMatchCard(
        match,
        `data-round="${roundIndex}" data-match="${matchIndex}"`,
        cardTop(matchIndex, matches.length))).join("")}
    </section>`;
  }).join("");

  const thirdMatches = thirdPlace?.[1] || [];
  const thirdMarkup = thirdMatches.length
    ? `<section class="third-place" style="left:${(rounds.length - 1) * (cardWidth + columnGap)}px;top:${Math.min(treeHeight - 142, treeHeight / 2 + 92)}px;width:${cardWidth}px">
        <h2>Finale 3/4</h2>
        ${finalMatchCard(thirdMatches[0], `data-third-place="true"`, 38)}
      </section>`
    : "";

  shell("Fasi finali", `<div class="bracket-stage">
    <div class="bracket-tree" data-tree-width="${treeWidth}" data-tree-height="${treeHeight}" style="width:${treeWidth}px;height:${treeHeight}px">
      <svg class="bracket-connectors" aria-hidden="true" width="${treeWidth}" height="${treeHeight}"></svg>
      ${columns}${thirdMarkup}
    </div>
  </div>`, state, "finals-view");

  requestAnimationFrame(() => {
    drawFinalsConnectors();
    const stage = app.querySelector(".bracket-stage");
    if (stage) {
      stage.scrollLeft = previousScroll.left;
      stage.scrollTop = previousScroll.top;
    }
  });
}

function finalMatchCard(match, attributes = "", top = 0) {
  return `<div class="final-match" ${attributes} style="top:${top}px">${matchTeamResult(match, 1)}${matchTeamResult(match, 2)}</div>`;
}

function drawFinalsConnectors() {
  const tree = app.querySelector(".bracket-tree");
  const svg = tree?.querySelector(".bracket-connectors");
  if (!tree || !svg) return;

  const treeRect = tree.getBoundingClientRect();
  const paths = [];
  const point = element => {
    const rectangle = element.getBoundingClientRect();
    return {
      left: rectangle.left - treeRect.left,
      right: rectangle.right - treeRect.left,
      centerY: rectangle.top - treeRect.top + rectangle.height / 2
    };
  };
  const connect = (source, destination, dashed = false) => {
    const from = point(source);
    const to = point(destination);
    const middleX = from.right + (to.left - from.right) / 2;
    paths.push(`<path class="bracket-link${dashed ? " bracket-link-secondary" : ""}" d="M ${from.right} ${from.centerY} H ${middleX} V ${to.centerY} H ${to.left}"/>`);
  };

  const roundElements = [...tree.querySelectorAll(".bracket-round")];
  for (let roundIndex = 1; roundIndex < roundElements.length; roundIndex += 1) {
    const previous = [...roundElements[roundIndex - 1].querySelectorAll(".final-match")];
    const current = [...roundElements[roundIndex].querySelectorAll(".final-match")];
    current.forEach((destination, matchIndex) => {
      const start = Math.floor(matchIndex * previous.length / current.length);
      const end = Math.max(start, Math.floor((matchIndex + 1) * previous.length / current.length) - 1);
      for (let sourceIndex = start; sourceIndex <= end; sourceIndex += 1) {
        if (previous[sourceIndex]) connect(previous[sourceIndex], destination);
      }
    });
  }

  const thirdPlace = tree.querySelector("[data-third-place]");
  if (thirdPlace && roundElements.length >= 2) {
    const semifinals = [...roundElements[roundElements.length - 2].querySelectorAll(".final-match")];
    semifinals.forEach(semifinal => connect(semifinal, thirdPlace, true));
  }
  svg.innerHTML = paths.join("");
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
    setSession({ teamName: result.teamName, password });
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
  if (!cachedState && !teamOfflineActive) {
    shell(current.teamName, `<section class="poster hero team-waiting"><div class="brand"><h1>${esc(current.teamName)}</h1><p>CARICAMENTO</p></div><div class="empty-state">Controllo la tua partita...</div></section>`);
  }
  const state = await loadState();  if (renderId !== latestRenderId) return;
  if (!sessionMatchesState(current, state)) {
    clearSession();
    renderLogin();
    const feedback = app.querySelector("[data-login-feedback]");
    if (feedback) feedback.textContent = "Sessione scaduta: inserisci la password del progetto attuale.";
    return;
  }
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
  const countdown = terminateCountdownSeconds(table, bothConsented && canAskClose);
  scheduleTerminateIfReady(table, bothConsented && canAskClose);

  const consentText = currentTeam?.consensoConcludi ? "Annulla consenso" : "Conferma fine partita";
  const consentDisabled = !canAskClose;
  const closeMessage = closeStatusMessage(table, matchTeams, currentTeam, bothConsented, canAskClose, countdown);
  const countdownHtml = countdown > 0 ? `<div class="countdown-box">Chiusura richiesta all'host tra <strong>${esc(countdown)}</strong> secondi</div>` : "";

  shell(current.teamName, `
    <section class="match-hero poster">
      <div class="hero-meta"><span>TAVOLO ${esc(table.nome)}</span><span>${esc(table.partita.stato || "-")}</span><span>${esc(stateAge(state))}</span></div>
      <div class="match-title"><h1>${esc(currentTeam?.nome || current.teamName)}</h1><p>vs ${esc(opponent?.nome || "-")}</p></div>
      <div class="match-score"><strong>${esc(currentTeam?.punti ?? 0)}</strong><span>-</span><strong>${esc(opponent?.punti ?? 0)}</strong></div>
      <div class="subline">${esc(closeMessage)}</div>
      ${countdownHtml}
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

function renderTeamOffline(error) {
  const current = session();
  if (!current) { renderLogin(); return; }
  teamOfflineActive = true;
  shell(current.teamName, `<section class="poster hero team-waiting">
    <div class="brand"><h1>${esc(current.teamName)}</h1><p>OFFLINE</p></div>
    <div class="empty-state">${esc(error?.message || "Host offline o sincronizzazione Vercel disattivata")}</div>
    <div class="actions">
      <button class="panel-button" data-refresh>Aggiorna</button>
      <button class="panel-button secondary" data-logout>Esci</button>
      <button class="panel-button secondary" data-home>Home</button>
    </div>
  </section>`, cachedState);
  app.querySelector("[data-refresh]").addEventListener("click", () => render(true));
  app.querySelector("[data-logout]").addEventListener("click", () => { clearSession(); go("/squadra"); });
  app.querySelector("[data-home]").addEventListener("click", () => go("/"));
}

function orderTeamsForCurrent(matchTeams, teamName) {
  const own = matchTeams.find(team => sameTeam(team.nome, teamName));
  const others = matchTeams.filter(team => !sameTeam(team.nome, teamName));
  return own ? [own, ...others] : matchTeams;
}

function closeStatusMessage(table, matchTeams, currentTeam, bothConsented, canAskClose, countdown = 0) {
  if (bothConsented && canAskClose && countdown > 0) return `Entrambe le squadre hanno confermato: richiesta chiusura tra ${countdown} secondi.`;
  if (bothConsented && canAskClose) return "Entrambe le squadre hanno confermato: richiesta chiusura inviata all'host.";
  if (currentTeam?.consensoConcludi) return "Hai confermato la fine partita. Attesa conferma avversaria.";
  if (matchTeams.some(team => team.consensoConcludi)) return "L'altra squadra ha confermato la fine partita.";
  if (canAskClose) return "La partita e' terminabile: serve il consenso di entrambe le squadre.";
  return "Partita in corso: aggiorna i punti dei tuoi giocatori.";
}

function terminateCountdownSeconds(table, ready) {
  if (!ready || !table?.partita?.id) return 0;
  const dueAt = Number(localStorage.getItem(terminateDueAtKey(table)) || 0);
  if (!dueAt) return 10;
  return Math.max(0, Math.ceil((dueAt - Date.now()) / 1000));
}

function scheduleTerminateIfReady(table, ready) {
  if (!table?.partita?.id) return;
  const key = terminateKey(table);
  if (!ready) {
    localStorage.removeItem(key);
    localStorage.removeItem(terminateDueAtKey(table));
    localStorage.removeItem(terminateSentKey(table));
    clearPendingTerminateTimer(key);
    return;
  }

  if (pendingTerminateTimers.has(key) || localStorage.getItem(terminateSentKey(table)) === "1") return;
  localStorage.setItem(key, "scheduled");
  if (!Number(localStorage.getItem(terminateDueAtKey(table)) || 0)) {
    localStorage.setItem(terminateDueAtKey(table), String(Date.now() + 10000));
  }
  scheduleCountdownRefresh();
  const timerId = setTimeout(async () => {
    try {
      await api("command", { command: {
        type: "terminate",
        source: "teams",
        tavolo: table.nome,
        matchId: table.partita.id,
        clientCreatedAtUtc: new Date().toISOString()
      }});
      localStorage.setItem(terminateSentKey(table), "1");
      localStorage.removeItem(terminateDueAtKey(table));
    } catch {
      localStorage.removeItem(key);
      localStorage.removeItem(terminateDueAtKey(table));
      localStorage.removeItem(terminateSentKey(table));
    } finally {
      pendingTerminateTimers.delete(key);
      if (location.pathname === "/squadra") render(true);
    }
  }, 10000);
  pendingTerminateTimers.set(key, timerId);
}

function scheduleCountdownRefresh() {
  for (let delay = 250; delay <= 10500; delay += 1000) {
    setTimeout(() => {
      if (!busy && location.pathname === "/squadra") render(true);
    }, delay);
  }
}

function clearPendingTerminateTimer(key) {
  const timerId = pendingTerminateTimers.get(key);
  if (timerId) clearTimeout(timerId);
  pendingTerminateTimers.delete(key);
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
  if (feedback) feedback.textContent = "Punto aggiornato. Invio all'host...";
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
    if (feedback) feedback.textContent = "Punto inviato. Sincronizzo con l'host...";
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
    clearPendingTerminateTimer(terminateKey(table));
    localStorage.removeItem(terminateKey(table));
    localStorage.removeItem(terminateDueAtKey(table));
    localStorage.removeItem(terminateSentKey(table));
    await api("command", { command: {
      type: "consensoTerminate",
      source: "teams",
      tavolo: table.nome,
      matchId: table.partita.id,
      squadra: teamName,
      clientCreatedAtUtc: new Date().toISOString()
    }});
    if (feedback) feedback.textContent = "Consenso inviato. Sincronizzo con l'host...";
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
    if (["gironi", "campi", "fasi-finali", "classifica-giocatori"].includes(path)) return await renderDashboard(path, renderId);
    renderHome();
  } catch (error) {
    if (renderId !== latestRenderId) return;
    if (path === "squadra" && session()) {
      renderTeamOffline(error);
      return;
    }
    shell("Errore", `<div class="card"><h2>Qualcosa non torna</h2><p>${esc(error.message)}</p><div class="actions"><button class="panel-button" data-home>Home</button></div></div>`);
    const home = app.querySelector("[data-home]");
    if (home) home.addEventListener("click", () => go("/"));
  } finally {
    renderInProgress = false;
  }
}

updateTopStripYear();
render();
setInterval(() => {
  const path = location.pathname;
  if (!busy && !renderInProgress && path !== "/" && path !== "" && !(path === "/squadra" && !session())) render();
}, 1000);
setInterval(pollTeamNotification, 3000);
