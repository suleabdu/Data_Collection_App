let session = "";
const $ = id => document.getElementById(id);
async function api(action, opts = {}) {
  const q = new URLSearchParams(); q.set("action", action);
  const res = await fetch(`/api?${q}`, { method: opts.method || "GET", headers: { "Content-Type": "application/json", "X-Admin-Session": session, ...(opts.headers || {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const d = await res.json().catch(() => ({ success: false, error: { message: "Invalid server response" } }));
  if (!res.ok || !d.success) throw new Error(d.error?.message || "Request failed"); return d.data;
}

$("login").onclick = async () => {
  $("loginMsg").textContent = "Signing in…";
  try {
    const d = await api("adminLogin", { method: "POST", headers: {}, body: { adminKey: $("adminKey").value } });
    session = d.session;
    $("loginCard").hidden = true;
    $("dashboard").hidden = false;
    $("logout").hidden = false;

    // INSTANT LOAD OPTIMIZATION: Render stats & master status immediately without blocking on heavy records table
    await Promise.all([loadStats(), loadMaster()]);

    // Load heavy records asynchronously in the background
    loadRecords();
  }
  catch (e) {
    $("loginMsg").textContent = e.message;
    $("loginMsg").className = "msg bad";
  }
};

$("logout").onclick = () => { session = ""; location.reload() };

async function refreshAll() {
  await Promise.all([loadStats(), loadMaster(), loadRecords()]);
}

async function loadStats() {
  try {
    const d = await api("getDashboardStats");
    $("stats").innerHTML = [
      ["Total Records", d.totalRecords],
      ["State Excos", d.stateExcos],
      ["LGA Coordinators", d.lgaCoordinators],
      ["Ward Coordinators", d.wardCoordinators]
    ].map(x => `<div class="stat"><b>${x[1]}</b><span>${x[0]}</span></div>`).join("");
  } catch (e) {
    console.error("Failed to load stats", e);
  }
}

async function loadMaster() {
  try {
    const d = await api("getMasterStatus");
    $("masterStatus").textContent = `${d.status} • ${d.count} valid geography rows`;
    $("masterStatus").className = "status " + (d.status === "READY" ? "ok" : "");
  } catch (e) {
    $("masterStatus").textContent = e.message;
  }
}

async function loadRecords() {
  try {
    const d = await api("listRecords");
    const items = d.items || [];
    if (items.length === 0) {
      $("records").innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--muted);">No records found.</td></tr>`;
      return;
    }
    $("records").innerHTML = items.map(r => `<tr><td>${esc(r.Record_ID)}</td><td>${esc(r.Name)}</td><td>${esc(r.Position)}</td><td>${esc(r.LGA)}</td><td>${esc(r.Ward)}</td><td>${esc(r.Phone)}</td><td>${esc(r.Verification_Status)}</td></tr>`).join("");
  } catch (e) {
    $("records").innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--red);">Failed to load records: ${esc(e.message)}</td></tr>`;
  }
}

function esc(v) { return String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])) }

$("refresh").onclick = () => loadRecords();
$("build").onclick = async () => {
  setImport("Building…");
  try { const d = await api("buildMasterList", { method: "POST" }); setImport(`Master list published: ${d.count} rows.`); await loadMaster() }
  catch (e) { setImport(e.message, true) }
};
$("validate").onclick = async () => {
  setImport("Validating…");
  try { const d = await api("validateMasterList", { method: "POST" }); setImport(`Validation: ${d.valid ? "PASSED" : "FAILED"} — ${d.count} rows.`) }
  catch (e) { setImport(e.message, true) }
};
$("upload").onclick = async () => {
  const f = $("csvFile").files[0]; if (!f) return setImport("Choose an official CSV file first.", true);
  if (f.size > 5 * 1024 * 1024) return setImport("CSV is too large. Maximum 5 MB.", true);
  setImport("Uploading…"); const text = await f.text();
  try { const d = await api("importGeographyCsv", { method: "POST", body: { csv: text, filename: f.name } }); setImport(`Imported ${d.count} raw rows. Click Build / Refresh Master List to publish.`); await loadMaster() }
  catch (e) { setImport(e.message, true) }
};
$("export").onclick = async () => {
  try {
    const d = await api("exportRecords");
    const blob = new Blob([d.csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "TK27_Ogun_Coordinator_Records.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) { alert(e.message) }
};

function setImport(t, bad = false) {
  $("importMsg").textContent = t;
  $("importMsg").className = "msg" + (bad ? " bad" : "");
}