// Trip admin: reads and writes data/*.json and images in the GitHub repo through the GitHub API.
const { esc, toUtc } = HC;
const $ = id => document.getElementById(id);
const store = {
  get: k => { try { return localStorage.getItem(k) || ""; } catch { return ""; } },
  set: (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch {} }
};
const DEFAULT_REPO = "TheLaw1864/homecoming";

let token = store.get("hc.ghToken"), repo = store.get("hc.ghRepo") || DEFAULT_REPO;
let site = null, siteSha = null, tripsDoc = null, tripsSha = null, airports = null;
let editing = null;        // trip being edited (a copy)
let newShots = [];         // [{file, dataUrl, show}]

function toast(msg, err) {
  const t = document.createElement("div");
  t.className = "toast" + (err ? " err" : ""); t.textContent = msg; t.setAttribute("role", "status");
  document.body.appendChild(t); setTimeout(() => t.remove(), err ? 6000 : 3500);
}

// ---------- GitHub ----------
async function gh(path, opts = {}) {
  const r = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(opts.headers || {}) }
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    const e = new Error(body.message || r.statusText); e.status = r.status; throw e;
  }
  return r.status === 204 ? null : r.json();
}
const b64FromText = s => { const bytes = new TextEncoder().encode(s); let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(bin); };
const textFromB64 = b => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\n/g, "")), c => c.charCodeAt(0)));
async function getFile(path) {
  const f = await gh(`/contents/${path}?ref=main&t=${Date.now()}`);
  return { sha: f.sha, text: textFromB64(f.content) };
}
async function putFile(path, base64, message, sha) {
  const res = await gh(`/contents/${path}`, { method: "PUT", body: JSON.stringify({ message, content: base64, branch: "main", ...(sha ? { sha } : {}) }) });
  return res.content.sha;
}
async function deleteFile(path, message) {
  try {
    const f = await gh(`/contents/${path}?ref=main`);
    await gh(`/contents/${path}`, { method: "DELETE", body: JSON.stringify({ message, sha: f.sha, branch: "main" }) });
  } catch (e) { if (e.status !== 404) throw e; }
}
async function loadData() {
  const [s, t] = await Promise.all([getFile("data/site.json"), getFile("data/trips.json")]);
  site = JSON.parse(s.text); siteSha = s.sha;
  tripsDoc = JSON.parse(t.text); tripsSha = t.sha;
}
async function saveTrips(message) {
  tripsSha = await putFile("data/trips.json", b64FromText(JSON.stringify(tripsDoc, null, 2) + "\n"), message, tripsSha);
}
async function saveSite(message) {
  siteSha = await putFile("data/site.json", b64FromText(JSON.stringify(site, null, 2) + "\n"), message, siteSha);
}
const saveError = e => e.status === 409 || e.status === 422
  ? "Something changed on GitHub since you opened this page. Refresh the page and try again."
  : e.status === 401 || e.status === 403 ? "GitHub refused the save. Check your token can write to Contents, then sign in again." : "Couldn't save: " + e.message;

// ---------- Airports ----------
async function loadAirports() {
  if (!airports) airports = await HC.loadJson("data/airports.json");
  return airports;
}
function airport(code) {
  const a = airports?.[String(code || "").trim().toUpperCase()];
  return a ? { code: String(code).trim().toUpperCase(), name: a[0], city: a[1], country: a[2], lat: a[3], lon: a[4], tz: a[5] } : null;
}
function bindAirport(input, out) {
  const show = () => {
    const v = input.value.trim();
    const a = airport(v);
    input.classList.toggle("bad", !!v && !a);
    out.classList.toggle("bad", !!v && !a);
    out.textContent = !v ? "" : a ? `${a.city} · ${a.name}` : "Unknown airport code";
  };
  input.addEventListener("input", show); show();
}

// ---------- Images ----------
function readDataUrl(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
}
async function compress(dataUrl, max = 1600, quality = .85) {
  const img = new Image(); img.src = dataUrl; await img.decode();
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
  const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", quality);
}
const b64OfDataUrl = d => d.slice(d.indexOf(",") + 1);

// ---------- Sign in ----------
async function connect() {
  $("connectMsg").textContent = "Checking...";
  try {
    const info = await gh("");
    if (!info.permissions?.push) throw new Error("This token can read the repository but can't write to it.");
    store.set("hc.ghToken", token); store.set("hc.ghRepo", repo);
    await Promise.all([loadData(), loadAirports()]);
    $("connect").hidden = true; $("app").hidden = false; $("signOut").hidden = false;
    renderTrips(); renderSettings(); galleries.forEach(g => g.load());
  } catch (e) {
    $("connect").hidden = false; $("app").hidden = true;
    $("connectMsg").textContent = e.status === 401 ? "GitHub didn't accept that token. Check it and try again." : e.status === 404 ? `Can't find ${repo}, or the token doesn't include it.` : e.message;
  }
}
$("connectBtn").addEventListener("click", () => { token = $("ghToken").value.trim(); repo = $("ghRepo").value.trim() || DEFAULT_REPO; if (token) connect(); });
$("signOut").addEventListener("click", () => { store.set("hc.ghToken", ""); location.reload(); });

// ---------- Tabs ----------
document.querySelectorAll(".tab").forEach(b => b.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach(x => x.setAttribute("aria-selected", x === b));
  for (const t of ["trips", "photos", "why", "settings"]) $("tab-" + t).hidden = t !== b.dataset.tab;
  $("editor").hidden = true;
}));

// ---------- Trip list ----------
function tripRange(tr) {
  return HC.tripRange(HC.prepareTrip(tr, site), site);
}
function renderTrips() {
  const list = [...tripsDoc.trips].sort((a, b) => (a.arriveHome || "").localeCompare(b.arriveHome || ""));
  $("tripList").innerHTML = list.length ? list.map(tr => `
    <div class="trip-item">
      <div><div class="t">${esc(tr.title)}</div><div class="d">${esc(tr.destination || "")} · ${esc(tripRange(tr))} · ${(tr.flights || []).length} flights</div></div>
      <div class="row-actions">
        <button class="btn small ghost" data-edit="${esc(tr.id)}" type="button">Edit</button>
        <button class="x" data-del="${esc(tr.id)}" type="button">Delete</button>
      </div>
    </div>`).join("") : `<p class="hint">No trips yet. Add your first one.</p>`;
}
$("tripList").addEventListener("click", async e => {
  const ed = e.target.closest("[data-edit]"), del = e.target.closest("[data-del]");
  if (ed) openEditor(tripsDoc.trips.find(t => t.id === ed.dataset.edit));
  if (del) {
    const b = del;
    if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "Tap again to delete"; setTimeout(() => { b.dataset.confirm = ""; b.textContent = "Delete"; }, 4000); return; }
    const tr = tripsDoc.trips.find(t => t.id === b.dataset.del);
    b.disabled = true; b.textContent = "Deleting...";
    try {
      for (const s of tr.screenshots || []) await deleteFile(s.path, `Remove screenshot for ${tr.title}`);
      tripsDoc.trips = tripsDoc.trips.filter(t => t !== tr);
      await saveTrips(`Delete trip: ${tr.title}`);
      renderTrips(); toast("Trip deleted. The site updates in about a minute.");
    } catch (err) { toast(saveError(err), true); b.disabled = false; b.textContent = "Delete"; }
  }
});

// ---------- Editor ----------
const KIND_OPTS = [["flying", "Flying"], ["event", "Event"], ["meetings", "Meetings"], ["free", "Free time"], ["other", "Other"]];
function openEditor(tr) {
  editing = tr ? structuredClone(tr) : { id: "", title: "", destination: "", destAirport: "", destTz: "", leaveHome: null, arriveHome: "", days: [], flights: [], screenshots: [], notes: "" };
  newShots = [];
  $("tab-trips").hidden = true; $("editor").hidden = false;
  $("editorTitle").textContent = tr ? `Edit: ${tr.title}` : "New trip";
  $("tTitle").value = editing.title; $("tDest").value = editing.destination; $("tDestAp").value = editing.destAirport || "";
  $("tLeave").value = editing.leaveHome || ""; $("tHome").value = editing.arriveHome || "";
  $("flightRows").innerHTML = ""; editing.flights.forEach(addFlightRow);
  $("dayRows").innerHTML = ""; editing.days.forEach(addDayRow);
  if (!editing.flights.length) addFlightRow();
  if (!editing.days.length) addDayRow();
  renderShots(); $("saveMsg").textContent = ""; $("readMsg").textContent = "";
  document.querySelector("#tDestApR").textContent = ""; bindAirport($("tDestAp"), $("tDestApR"));
  scrollTo({ top: 0 });
}
function closeEditor() { $("editor").hidden = true; $("tab-trips").hidden = false; editing = null; renderTrips(); }
$("newTrip").addEventListener("click", () => openEditor(null));
$("cancelTrip").addEventListener("click", closeEditor);

function addFlightRow(f = {}) {
  const row = document.createElement("div");
  row.className = "flight-row";
  row.innerHTML = `
    <label class="field"><span>Flight</span><input class="code fNum" type="text" placeholder="SA585" value="${esc(f.number || "")}" style="text-transform:uppercase"></label>
    <label class="field span2"><span>Airline</span><input class="fAir" type="text" value="${esc(f.airline || "")}"></label>
    <label class="field span2"><span>Operated by (if different)</span><input class="fOp" type="text" value="${esc(f.operatedBy || "")}"></label>
    <div class="field" style="align-self:end"><button class="x fDel" type="button">Remove</button></div>
    <label class="field"><span>From</span><input class="code fFrom" type="text" maxlength="3" placeholder="DUR" value="${esc(f.from?.code || "")}"><span class="resolved"></span></label>
    <label class="field span2"><span>Departs (local time)</span><input class="fDep" type="datetime-local" value="${esc(f.dep || "")}"></label>
    <label class="field"><span>To</span><input class="code fTo" type="text" maxlength="3" placeholder="JNB" value="${esc(f.to?.code || "")}"><span class="resolved"></span></label>
    <label class="field span2"><span>Arrives (local time)</span><input class="fArr" type="datetime-local" value="${esc(f.arr || "")}"></label>`;
  row.querySelector(".fDel").addEventListener("click", () => row.remove());
  bindAirport(row.querySelector(".fFrom"), row.querySelector(".fFrom + .resolved"));
  bindAirport(row.querySelector(".fTo"), row.querySelector(".fTo + .resolved"));
  $("flightRows").appendChild(row);
}
function addDayRow(d = {}) {
  const row = document.createElement("div");
  row.className = "day-row";
  row.innerHTML = `
    <label class="field"><span>From</span><input class="dFrom" type="date" value="${esc(d.from || "")}"></label>
    <label class="field"><span>To (optional)</span><input class="dTo" type="date" value="${esc(d.to && d.to !== d.from ? d.to : "")}"></label>
    <label class="field what"><span>What's happening</span><input class="dLabel" type="text" placeholder="Attending MKTE" value="${esc(d.label || "")}"></label>
    <label class="field"><span>Type</span><select class="dKind">${KIND_OPTS.map(([v, l]) => `<option value="${v}" ${d.kind === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
    <button class="x dDel" type="button">Remove</button>`;
  row.querySelector(".dDel").addEventListener("click", () => row.remove());
  $("dayRows").appendChild(row);
}
$("addFlight").addEventListener("click", () => addFlightRow());
$("addDay").addEventListener("click", () => addDayRow());

function readFlights() {
  return [...document.querySelectorAll(".flight-row")].map(r => ({
    number: r.querySelector(".fNum").value.trim().toUpperCase().replace(/\s+/g, ""),
    airline: r.querySelector(".fAir").value.trim(),
    operatedBy: r.querySelector(".fOp").value.trim(),
    fromCode: r.querySelector(".fFrom").value.trim().toUpperCase(),
    toCode: r.querySelector(".fTo").value.trim().toUpperCase(),
    dep: r.querySelector(".fDep").value, arr: r.querySelector(".fArr").value
  })).filter(f => f.number || f.fromCode || f.toCode || f.dep);
}
function readDays() {
  return [...document.querySelectorAll(".day-row")].map(r => {
    const from = r.querySelector(".dFrom").value, to = r.querySelector(".dTo").value || from;
    return { from, to: to < from ? from : to, label: r.querySelector(".dLabel").value.trim(), kind: r.querySelector(".dKind").value };
  }).filter(d => d.from && d.label);
}
$("fillDays").addEventListener("click", () => {
  const have = new Set(readDays().map(d => d.from));
  const dates = [...new Set(readFlights().map(f => f.dep.slice(0, 10)).filter(Boolean))].filter(d => !have.has(d));
  document.querySelectorAll(".day-row").forEach(r => { if (!r.querySelector(".dFrom").value && !r.querySelector(".dLabel").value) r.remove(); });
  dates.forEach(d => addDayRow({ from: d, to: d, label: "Flying", kind: "flying" }));
  sortDayRows();
  if (!dates.length) toast("Every flight date already has a line.");
});
function sortDayRows() {
  const rows = [...document.querySelectorAll(".day-row")].sort((a, b) => (a.querySelector(".dFrom").value || "9").localeCompare(b.querySelector(".dFrom").value || "9"));
  rows.forEach(r => $("dayRows").appendChild(r));
}

// Screenshots
function renderShots() {
  const saved = (editing.screenshots || []).map((s, i) => `
    <div class="shot"><img src="${esc(s.path)}" alt="Saved itinerary">
      <span>On the trip page</span><button class="x" data-rm-saved="${i}" type="button">Remove from site</button></div>`);
  const fresh = newShots.map((s, i) => `
    <div class="shot"><img src="${s.dataUrl}" alt="New screenshot">
      <label><input type="checkbox" data-show="${i}" ${s.show ? "checked" : ""}> Also show it on the trip page</label>
      <button class="x" data-rm-new="${i}" type="button">Remove</button></div>`);
  $("shots").innerHTML = [...saved, ...fresh].join("");
  $("readBtn").disabled = !newShots.length;
  $("readMsg").textContent = newShots.length && !store.get("hc.aiKey") ? "Add a Claude API key in Settings to read screenshots, or type the flights in below." : "";
}
$("shots").addEventListener("click", e => {
  const a = e.target.closest("[data-rm-saved]"), b = e.target.closest("[data-rm-new]");
  if (a) { editing.removedShots = [...(editing.removedShots || []), editing.screenshots[+a.dataset.rmSaved]]; editing.screenshots.splice(+a.dataset.rmSaved, 1); renderShots(); }
  if (b) { newShots.splice(+b.dataset.rmNew, 1); renderShots(); }
});
$("shots").addEventListener("change", e => {
  const c = e.target.closest("[data-show]");
  if (c) {
    newShots[+c.dataset.show].show = c.checked;
    if (c.checked) toast("Anyone with the link can see it. Crop out booking references and ticket numbers first.");
  }
});
async function addShots(files) {
  for (const file of files) if (file.type.startsWith("image/")) newShots.push({ file, dataUrl: await compress(await readDataUrl(file)), show: false });
  renderShots();
}
$("drop").addEventListener("click", () => $("shotInput").click());
$("drop").addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("shotInput").click(); } });
$("shotInput").addEventListener("change", e => { addShots([...e.target.files]); e.target.value = ""; });
$("drop").addEventListener("dragover", e => { e.preventDefault(); $("drop").classList.add("over"); });
$("drop").addEventListener("dragleave", () => $("drop").classList.remove("over"));
$("drop").addEventListener("drop", e => { e.preventDefault(); $("drop").classList.remove("over"); addShots([...e.dataTransfer.files]); });
addEventListener("paste", e => { if (!$("editor").hidden) { const f = [...e.clipboardData.files]; if (f.length) addShots(f); } });

// Read flights with Claude
const FLIGHT_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["tripTitle", "destination", "destinationAirport", "flights"],
  properties: {
    tripTitle: { type: "string" }, destination: { type: "string" }, destinationAirport: { type: "string" },
    flights: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["number", "airline", "operatedBy", "from", "to", "depDate", "depTime", "arrDate", "arrTime"],
        properties: {
          number: { type: "string" }, airline: { type: "string" }, operatedBy: { type: "string" },
          from: { type: "string" }, to: { type: "string" },
          depDate: { type: "string" }, depTime: { type: "string" }, arrDate: { type: "string" }, arrTime: { type: "string" }
        }
      }
    }
  }
};
$("readBtn").addEventListener("click", async () => {
  const key = store.get("hc.aiKey");
  if (!key) { toast("Add a Claude API key in Settings first.", true); return; }
  const btn = $("readBtn"); btn.disabled = true; $("readMsg").textContent = "Reading the screenshot. This takes up to a minute...";
  try {
    const { default: Anthropic } = await import("https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.128.0/+esm");
    const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
    const msg = await client.beta.messages.create({
      model: "claude-opus-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { format: { type: "json_schema", schema: FLIGHT_SCHEMA } },
      messages: [{
        role: "user",
        content: [
          ...newShots.map(s => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64OfDataUrl(s.dataUrl) } })),
          { type: "text", text:
            `These are screenshots of a flight itinerary for someone who lives in ${site.home.city} (airport ${site.home.airport}).\n` +
            `List every flight segment in the order flown. For each: flight number without spaces, marketing airline, the operating airline if a different one is shown (otherwise an empty string), ` +
            `IATA codes for the departure and arrival airports (work them out from the airport or city names if the codes aren't printed), ` +
            `and departure and arrival dates (YYYY-MM-DD) and 24-hour times (HH:MM) exactly as printed, which are local to each airport.\n` +
            `Also give a short trip name, the destination city or country being visited, and that destination's main airport IATA code.\n` +
            `Leave out booking references, ticket numbers and passenger names.` }
        ]
      }]
    });
    if (msg.stop_reason === "refusal") throw new Error("Claude declined to read this image.");
    const text = msg.content.find(b => b.type === "text")?.text;
    const out = JSON.parse(text);
    if (!out.flights?.length) throw new Error("No flights found in the screenshot.");
    applyExtraction(out);
    $("readMsg").textContent = `Found ${out.flights.length} flight${out.flights.length > 1 ? "s" : ""}. Check them below before saving.`;
  } catch (e) {
    $("readMsg").textContent = e.status === 401 ? "The Claude API key was rejected. Check it in Settings." : "Couldn't read it: " + (e.message || e) + ". You can type the flights in instead.";
  } finally { btn.disabled = !newShots.length; }
});
function applyExtraction(out) {
  if (!$("tTitle").value) $("tTitle").value = out.tripTitle;
  if (!$("tDest").value) $("tDest").value = out.destination;
  if (!$("tDestAp").value && airport(out.destinationAirport)) { $("tDestAp").value = out.destinationAirport; $("tDestAp").dispatchEvent(new Event("input")); }
  // Replace empty flight rows, keep ones already typed
  document.querySelectorAll(".flight-row").forEach(r => { if (!r.querySelector(".fNum").value && !r.querySelector(".fFrom").value) r.remove(); });
  const have = new Set(readFlights().map(f => f.number + f.dep));
  for (const f of out.flights) {
    const dep = `${f.depDate}T${f.depTime}`, arr = `${f.arrDate}T${f.arrTime}`;
    if (have.has(f.number + dep)) continue;
    addFlightRow({ number: f.number, airline: f.airline, operatedBy: f.operatedBy, from: { code: f.from }, to: { code: f.to }, dep, arr });
  }
  suggestHomeTimes();
  $("fillDays").click();
}
// Leave home 2.5h before a flight from home; back home 45 min after landing at home
function suggestHomeTimes() {
  const fl = readFlights().filter(f => f.dep && f.arr).sort((a, b) => (toUtc(a.dep, airport(a.fromCode)?.tz || "UTC")) - (toUtc(b.dep, airport(b.fromCode)?.tz || "UTC")));
  const shift = (local, mins) => { const d = new Date(local + ":00Z"); d.setUTCMinutes(d.getUTCMinutes() + mins); return d.toISOString().slice(0, 16); };
  const first = fl[0], last = fl.at(-1);
  if (first && !$("tLeave").value && first.fromCode === site.home.airport) $("tLeave").value = shift(first.dep, -150);
  if (last && !$("tHome").value && last.toCode === site.home.airport) $("tHome").value = shift(last.arr, 45);
}

// Save
const slug = s => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "trip";
$("saveTrip").addEventListener("click", async () => {
  const msg = $("saveMsg"), btn = $("saveTrip");
  const title = $("tTitle").value.trim(), arriveHome = $("tHome").value, leaveHome = $("tLeave").value || null;
  const problems = [];
  if (!title) problems.push("Give the trip a name.");
  if (!arriveHome) problems.push("Add when you'll be back home.");
  const destAp = $("tDestAp").value.trim().toUpperCase(), dest = airport(destAp);
  if (destAp && !dest) problems.push(`Destination airport ${destAp} isn't a known code.`);
  const flights = [];
  readFlights().forEach((f, i) => {
    const from = airport(f.fromCode), to = airport(f.toCode), n = f.number || `Flight ${i + 1}`;
    if (!f.number) problems.push(`Flight ${i + 1} needs a flight number.`);
    if (!from || !to) problems.push(`${n}: check the airport codes.`);
    if (!f.dep || !f.arr) problems.push(`${n}: add departure and arrival times.`);
    if (from && to && f.dep && f.arr && toUtc(f.arr, to.tz) <= toUtc(f.dep, from.tz)) problems.push(`${n} lands before it takes off. Check the dates and times.`);
    if (from && to) flights.push({
      number: f.number, airline: f.airline, operatedBy: f.operatedBy,
      from: { code: from.code, city: from.city, name: from.name, tz: from.tz, lat: from.lat, lon: from.lon },
      to: { code: to.code, city: to.city, name: to.name, tz: to.tz, lat: to.lat, lon: to.lon },
      dep: f.dep, arr: f.arr
    });
  });
  if (leaveHome && arriveHome && leaveHome >= arriveHome) problems.push("Back home needs to be after leaving home.");
  if (problems.length) { msg.textContent = problems.join(" "); msg.classList.add("warn"); return; }
  msg.classList.remove("warn");

  btn.disabled = true;
  try {
    const trip = editing;
    trip.title = title; trip.destination = $("tDest").value.trim();
    trip.destAirport = dest ? dest.code : ""; trip.destTz = dest ? dest.tz : "";
    trip.leaveHome = leaveHome; trip.arriveHome = arriveHome;
    trip.flights = flights; trip.days = readDays();
    if (!trip.id) {
      let id = slug(title) + "-" + arriveHome.slice(0, 7), n = 2;
      while (tripsDoc.trips.some(t => t.id === id)) id = slug(title) + "-" + arriveHome.slice(0, 7) + "-" + n++;
      trip.id = id;
    }
    for (const s of trip.removedShots || []) { msg.textContent = "Removing old screenshot..."; await deleteFile(s.path, `Remove screenshot for ${title}`); }
    delete trip.removedShots;
    const toShow = newShots.filter(s => s.show);
    for (const [i, s] of toShow.entries()) {
      msg.textContent = `Uploading screenshot ${i + 1} of ${toShow.length}...`;
      const path = `uploads/${trip.id}-${Date.now()}-${i}.jpg`;
      await putFile(path, b64OfDataUrl(s.dataUrl), `Add screenshot for ${title}`);
      trip.screenshots.push({ path });
    }
    msg.textContent = "Saving trip...";
    // Merge onto the latest copy so a save from another device isn't lost
    const latest = await getFile("data/trips.json");
    tripsDoc = JSON.parse(latest.text); tripsSha = latest.sha;
    const idx = tripsDoc.trips.findIndex(t => t.id === trip.id);
    if (idx >= 0) tripsDoc.trips[idx] = trip; else tripsDoc.trips.push(trip);
    await saveTrips(`${idx >= 0 ? "Update" : "Add"} trip: ${title}`);
    newShots = [];
    toast("Saved. The live site updates in about a minute.");
    closeEditor();
  } catch (e) {
    msg.textContent = saveError(e); msg.classList.add("warn");
  } finally { btn.disabled = false; }
});

// ---------- Photo galleries (site.photos and site.reasons) ----------
const GROUPS = [["family", "Family"], ["friends", "Friends"], ["animals", "Animals"]];
function makeGallery(sectionId, key, { groups = false, noun = "photos" } = {}) {
  const sec = $(sectionId), grid = sec.querySelector("[data-grid]"), input = sec.querySelector("[data-input]"), msg = sec.querySelector("[data-msg]"), saveBtn = sec.querySelector("[data-save]");
  let items = [];
  const render = () => {
    grid.innerHTML = items.map((p, i) => `
      <div class="photo">
        <img src="${p.dataUrl || esc(p.src)}" alt="">
        <input type="text" data-cap="${i}" value="${esc(p.caption || "")}" placeholder="${groups ? "Who or what, e.g. Gran" : "Caption"}" aria-label="Caption">
        ${groups ? `<select data-group="${i}" aria-label="Group">${GROUPS.map(([v, l]) => `<option value="${v}" ${p.group === v ? "selected" : ""}>${l}</option>`).join("")}</select>` : ""}
        <div class="row-actions">
          <button class="x" data-up="${i}" type="button" ${i ? "" : "disabled"} aria-label="Move earlier">&larr;</button>
          <button class="x" data-rep="${i}" type="button">Replace</button>
          <button class="x" data-rm="${i}" type="button">Remove</button>
        </div>
      </div>`).join("") || `<p class="hint">No photos yet.</p>`;
  };
  const dirty = () => { msg.textContent = "Unsaved changes. Press Save to put them on the site."; };
  const replaceInput = Object.assign(document.createElement("input"), { type: "file", accept: "image/*", hidden: true });
  sec.appendChild(replaceInput);
  let replacing = -1;
  replaceInput.addEventListener("change", async e => {
    const file = e.target.files[0]; e.target.value = "";
    if (!file || replacing < 0) return;
    items[replacing] = { ...items[replacing], dataUrl: await compress(await readDataUrl(file), 1000, .82) };
    replacing = -1; render(); dirty();
  });
  grid.addEventListener("input", e => {
    const c = e.target.closest("[data-cap]"), g = e.target.closest("[data-group]");
    if (c) items[+c.dataset.cap].caption = c.value;
    if (g) items[+g.dataset.group].group = g.value;
    dirty();
  });
  grid.addEventListener("change", e => { const g = e.target.closest("[data-group]"); if (g) items[+g.dataset.group].group = g.value; });
  grid.addEventListener("click", e => {
    const up = e.target.closest("[data-up]"), rm = e.target.closest("[data-rm]"), rp = e.target.closest("[data-rep]");
    if (up) { const i = +up.dataset.up; [items[i - 1], items[i]] = [items[i], items[i - 1]]; render(); dirty(); }
    if (rm) { items.splice(+rm.dataset.rm, 1); render(); dirty(); }
    if (rp) { replacing = +rp.dataset.rep; replaceInput.click(); }
  });
  sec.querySelector("[data-add]").addEventListener("click", () => input.click());
  input.addEventListener("change", async e => {
    for (const file of e.target.files) items.push({ src: "", caption: "", ...(groups ? { group: "family" } : {}), dataUrl: await compress(await readDataUrl(file), 1000, .82) });
    e.target.value = ""; render(); dirty();
  });
  saveBtn.addEventListener("click", async () => {
    saveBtn.disabled = true;
    try {
      const fresh = items.filter(p => p.dataUrl);
      for (const [i, p] of fresh.entries()) {
        msg.textContent = `Uploading photo ${i + 1} of ${fresh.length}...`;
        p.src = `img/photo-${Date.now()}-${i}.jpg`;
        await putFile(p.src, b64OfDataUrl(p.dataUrl), "Add photo");
        delete p.dataUrl;
      }
      const latest = await getFile("data/site.json"); site = JSON.parse(latest.text); siteSha = latest.sha;
      const before = site[key] || [];
      site[key] = items.map(p => ({ src: p.src, caption: p.caption || "", ...(groups ? { group: p.group || "family" } : {}) }));
      msg.textContent = "Saving...";
      await saveSite(`Update ${noun}`);
      // Delete removed files, unless the other gallery still uses them
      const inUse = new Set([...(site.photos || []), ...(site.reasons || [])].map(p => p.src));
      for (const old of before) if (!inUse.has(old.src)) { msg.textContent = "Removing old photos..."; await deleteFile(old.src, "Remove photo"); }
      msg.textContent = ""; render(); toast("Saved. The live site updates in about a minute.");
    } catch (e) { msg.textContent = saveError(e); } finally { saveBtn.disabled = false; }
  });
  return { load() { items = (site[key] || []).map(p => ({ ...p })); render(); } };
}
const galleries = [makeGallery("tab-photos", "photos"), makeGallery("tab-why", "reasons", { groups: true, noun: "Why home photos" })];

// ---------- Settings ----------
function renderSettings() {
  $("sName").value = site.name; $("sCity").value = site.home.city; $("sAirport").value = site.home.airport;
  bindAirport($("sAirport"), $("sAirportR"));
  document.querySelectorAll(".homeCity").forEach(el => { el.textContent = site.home.city; });
  $("aiKey").value = store.get("hc.aiKey");
}
$("saveSettings").addEventListener("click", async () => {
  const a = airport($("sAirport").value);
  if (!a) { $("settingsMsg").textContent = "Check the home airport code."; return; }
  const btn = $("saveSettings"); btn.disabled = true; $("settingsMsg").textContent = "Saving...";
  try {
    const latest = await getFile("data/site.json"); site = JSON.parse(latest.text); siteSha = latest.sha;
    site.name = $("sName").value.trim() || site.name;
    site.home = { city: $("sCity").value.trim() || a.city, airport: a.code, tz: a.tz, lat: a.lat, lon: a.lon };
    await saveSite("Update settings");
    $("settingsMsg").textContent = ""; renderSettings(); toast("Settings saved.");
  } catch (e) { $("settingsMsg").textContent = saveError(e); } finally { btn.disabled = false; }
});
$("saveKey").addEventListener("click", () => {
  store.set("hc.aiKey", $("aiKey").value.trim());
  $("keyMsg").textContent = $("aiKey").value.trim() ? "Saved in this browser." : "Key removed from this browser.";
});

// ---------- Boot ----------
$("ghRepo").value = repo; $("repoName").textContent = repo.split("/")[1] || repo;
if (token) { $("loading").hidden = false; connect().finally(() => { $("loading").hidden = true; }); } else $("connect").hidden = false;
