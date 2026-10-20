const $ = (id) => document.getElementById(id);
const state = { lgas: [], wards: [], pollingUnits: [] };

async function api(action, options = {}) {
  const params = new URLSearchParams(options.params || {});
  params.set("action", action);
  const url = `/api?${params.toString()}`;
  const res = await fetch(url, {
    method: options.method || "GET",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  let data;
  try { data = await res.json(); } catch { throw new Error("Server returned an invalid response."); }
  if (!res.ok || !data.success) throw new Error(data?.error?.message || "Request failed.");
  return data.data;
}

function setStatus(message, type = "info") {
  const el = $("systemStatus"); el.textContent = message; el.className = `status ${type}`;
}
function clearErrors() { document.querySelectorAll(".error").forEach(e => e.textContent = "") }
function error(id, msg) { document.querySelector(`[data-error-for="${id}"]`).textContent = msg }
function fillSelect(select, items, placeholder, valueKey = "code", labelKey = "name") {
  select.innerHTML = `<option value="">${placeholder}</option>`;
  items.forEach(item => {
    const o = document.createElement("option"); o.value = item[valueKey]; o.textContent = item[labelKey]; select.appendChild(o);
  });
  select.disabled = false;
}
function resetSelect(select, placeholder) { select.innerHTML = `<option value="">${placeholder}</option>`; select.disabled = true }

async function loadLGAs() {
  try {
    const data = await api("getLGAs");
    state.lgas = data.items || [];
    fillSelect($("lga"), state.lgas, "Select local government");
    $("submitBtn").disabled = false;
    setStatus("Select a position and location to continue.", "info");
  } catch (e) {
    setStatus(e.message, "error");
  }
}
$("lga").addEventListener("change", async e => {
  resetSelect($("ward"), "Loading wards…"); resetSelect($("pollingUnit"), "Select ward first");
  if (!e.target.value) { resetSelect($("ward"), "Select LGA first"); return }
  try {
    const data = await api("getWards", { params: { lgaCode: e.target.value } });
    state.wards = data.items || []; fillSelect($("ward"), state.wards, "Select ward");
  } catch (err) { setStatus(err.message, "error") }
});
$("ward").addEventListener("change", async e => {
  resetSelect($("pollingUnit"), "Loading polling units…");
  if (!e.target.value) { resetSelect($("pollingUnit"), "Select ward first"); return }
  try {
    const data = await api("getPollingUnits", { params: { lgaCode: $("lga").value, wardCode: e.target.value } });
    state.pollingUnits = data.items || []; fillSelect($("pollingUnit"), state.pollingUnits, "Select polling unit");
  } catch (err) { setStatus(err.message, "error") }
});

function validate() {
  clearErrors(); let ok = true;
  if (!$("position").value) { error("position", "Please select a position."); ok = false }
  if ($("name").value.trim().length < 2) { error("name", "Enter the full name."); ok = false }
  if ($("phone").value.trim().length < 7) { error("phone", "Enter a valid phone number."); ok = false }
  if (!$("lga").value) { error("lga", "Please select an LGA."); ok = false }
  if (!$("ward").value) { error("ward", "Please select a ward."); ok = false }
  if (!$("pollingUnit").value) { error("pollingUnit", "Please select a polling unit."); ok = false }
  return ok;
}

$("coordinatorForm").addEventListener("submit", async e => {
  e.preventDefault(); if (!validate()) return;
  const btn = $("submitBtn"), text = btn.querySelector(".btn-text"), spin = btn.querySelector(".spinner");
  btn.disabled = true; text.textContent = "Submitting…"; spin.hidden = false;
  try {
    const data = await api("submitCoordinator", {
      method: "POST", body: {
        position: $("position").value, name: $("name").value.trim(), phone: $("phone").value.trim(),
        lgaCode: $("lga").value, wardCode: $("ward").value, pollingUnitCode: $("pollingUnit").value
      }
    });
    $("reference").textContent = data.recordId;
    $("coordinatorForm").closest(".card").hidden = true;
    $("successCard").hidden = false;
  } catch (err) {
    setStatus(err.message, "error"); window.scrollTo({ top: 0, behavior: "smooth" });
  } finally { btn.disabled = false; text.textContent = "Submit Record"; spin.hidden = true }
});
$("addAnother").addEventListener("click", () => {
  $("coordinatorForm").reset(); clearErrors(); resetSelect($("ward"), "Select LGA first"); resetSelect($("pollingUnit"), "Select ward first");
  $("successCard").hidden = true; $("coordinatorForm").closest(".card").hidden = false;
  setStatus("Ready for another record.", "success"); window.scrollTo({ top: 0, behavior: "smooth" });
});
loadLGAs();