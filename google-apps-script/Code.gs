const STATE_SHEET = "State";
const COMMANDS_SHEET = "Commands";
const TEAMS_SHEET = "Teams";

function jsonOut(value) {
  return ContentService.createTextOutput(JSON.stringify(value || {})).setMimeType(ContentService.MimeType.JSON);
}

function parseBody(e) {
  return e && e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {};
}

function requireSecret(body) {
  const expected = PropertiesService.getScriptProperties().getProperty("API_SECRET") || "";
  if (expected && body.secret !== expected) throw new Error("Segreto API non valido");
}

function sheet(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (headers && sh.getLastRow() === 0) sh.appendRow(headers);
  return sh;
}

function stateSheet() {
  return sheet(STATE_SHEET, ["key", "json", "updatedAt"]);
}

function commandsSheet() {
  return sheet(COMMANDS_SHEET, ["id", "json", "status", "result", "createdAt", "ackAt"]);
}

function teamsSheet() {
  return sheet(TEAMS_SHEET, ["teamName", "password"]);
}

function setState(state) {
  const sh = stateSheet();
  const currentState = state || {};
  sh.getRange(2, 1, 1, 3).setValues([["state", JSON.stringify(currentState), new Date().toISOString()]]);
  syncTeams(currentState.teamCredentials || []);
  return { ok: true };
}

function syncTeams(credentials) {
  const sh = teamsSheet();
  const rows = [["teamName", "password"]];
  (credentials || []).forEach(item => {
    if (!item) return;
    rows.push([String(item.teamName || ""), String(item.password || "")]);
  });
  sh.clearContents();
  sh.getRange(1, 1, rows.length, 2).setValues(rows);
}

function getState() {
  const sh = stateSheet();
  const text = sh.getRange(2, 2).getValue();
  return { ok: true, state: text ? JSON.parse(text) : null };
}

function clearAll() {
  stateSheet().getRange(2, 1, Math.max(1, stateSheet().getMaxRows() - 1), 3).clearContent();
  commandsSheet().getRange(2, 1, Math.max(1, commandsSheet().getMaxRows() - 1), 6).clearContent();
  syncTeams([]);
  return { ok: true };
}

function getCommands() {
  const sh = commandsSheet();
  const lastRow = sh.getLastRow();
  if (lastRow <= 1) return { ok: true, commands: [] };

  const windowSize = Math.min(80, lastRow - 1);
  const startRow = lastRow - windowSize + 1;
  const values = sh.getRange(startRow, 1, windowSize, 6).getValues();
  const commands = values
    .filter(row => row[0] && row[2] !== "done")
    .map(row => ({ id: String(row[0]), ...JSON.parse(row[1] || "{}") }));
  return { ok: true, commands };
}

function addCommand(command) {
  const sh = commandsSheet();
  const id = Utilities.getUuid();
  sh.appendRow([id, JSON.stringify(command || {}), "new", "", new Date().toISOString(), ""]);
  return { ok: true, id };
}

function ackCommand(id, result) {
  const sh = commandsSheet();
  const lastRow = sh.getLastRow();
  if (lastRow <= 1) return { ok: true };

  const windowSize = Math.min(120, lastRow - 1);
  const startRow = lastRow - windowSize + 1;
  const values = sh.getRange(startRow, 1, windowSize, 1).getValues();
  for (let i = values.length - 1; i >= 0; i--) {
    if (String(values[i][0]) === String(id)) {
      sh.getRange(startRow + i, 3, 1, 3).setValues([["done", result || "", new Date().toISOString()]]);
      compactDoneCommands(sh);
      break;
    }
  }
  return { ok: true };
}

function compactDoneCommands(sh) {
  const lastRow = sh.getLastRow();
  if (lastRow < 250) return;
  const keepRows = 120;
  const deleteCount = lastRow - keepRows - 1;
  if (deleteCount > 0) sh.deleteRows(2, deleteCount);
}

function normalizePassword(value) {
  return String(value || "").trim().toUpperCase();
}

function login(password) {
  const requested = normalizePassword(password);
  const values = teamsSheet().getDataRange().getValues().slice(1);
  const row = values.find(r => normalizePassword(r[1]) === requested || normalizePassword(r[2]) === requested);
  if (!row) return { ok: false, error: "Password non valida" };
  return { ok: true, teamName: String(row[2] || row[0] || "").trim() };
}

function doPost(e) {
  try {
    const body = parseBody(e);
    requireSecret(body);
    switch (body.action) {
      case "setState": return jsonOut(setState(body.state));
      case "getState": return jsonOut(getState());
      case "clear": return jsonOut(clearAll());
      case "getCommands": return jsonOut(getCommands());
      case "addCommand": return jsonOut(addCommand(body.command));
      case "ackCommand": return jsonOut(ackCommand(body.id, body.result));
      case "login": return jsonOut(login(body.password));
      default: return jsonOut({ ok: false, error: "Azione non valida" });
    }
  } catch (error) {
    return jsonOut({ ok: false, error: error.message || String(error) });
  }
}

