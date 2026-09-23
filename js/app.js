(() => {
  const { esc, niceDate, niceRange, clockIn, ymdIn, gmtLabel, dur, localDate, localTime, prepareTrip, loadJson } = HC;
  const $ = id => document.getElementById(id);
  const pad = n => String(n).padStart(2, "0");
  const CELEBRATE_MS = 48 * 3600e3;

  // ?at=2026-09-28T15:00Z previews the page at another moment
  const atParam = new URLSearchParams(location.search).get("at");
  const offset = atParam && !isNaN(Date.parse(atParam)) ? Date.parse(atParam) - Date.now() : 0;
  const now = () => Date.now() + offset;

  let site = null, trips = [], rawData = "", trip = null, phaseKey = "";

  // ---------- Data ----------
  async function load() {
    const [s, t] = await Promise.all([loadJson("data/site.json"), loadJson("data/trips.json")]);
    const raw = JSON.stringify([s, t]);
    if (raw === rawData) return false;
    rawData = raw; site = s;
    trips = (t.trips || []).map(tr => prepareTrip(tr, site)).sort((a, b) => a.startMs - b.startMs);
    return true;
  }
  const featuredTrip = t => trips.find(tr => tr.endMs + CELEBRATE_MS > t) || null;
  function viewedTrip() {
    const h = location.hash.slice(1);
    if (h.startsWith("trip-")) { const found = trips.find(tr => tr.id === h.slice(5)); if (found) return found; }
    return featuredTrip(now());
  }
  function phaseOf(tr, t) {
    if (!tr) return "none";
    if (t < tr.startMs) return "before";
    if (t < tr.endMs) return "away";
    return t < tr.endMs + CELEBRATE_MS ? "home" : "past";
  }
  const nm = () => esc(site.name);
  const homeWhen = tr => `${niceDate(localDate(tr.arriveHome))} at about ${localTime(tr.arriveHome)}`;

  // ---------- Split-flap countdown ----------
  const flaps = {};
  document.querySelectorAll(".flaps").forEach(el => { flaps[el.dataset.u] = el; });
  function setFlaps(el, str) {
    while (el.children.length < str.length) { const f = document.createElement("div"); f.className = "flap"; f.innerHTML = "<span></span>"; el.appendChild(f); }
    while (el.children.length > str.length) el.lastChild.remove();
    [...str].forEach((ch, i) => {
      const f = el.children[i], s = f.firstChild;
      if (s.textContent !== ch) { s.textContent = ch; f.classList.remove("flip"); void f.offsetWidth; f.classList.add("flip"); }
    });
  }
  function setCountdown(ms) {
    const s = Math.floor(Math.max(0, ms) / 1000);
    setFlaps(flaps.d, pad(Math.floor(s / 86400)));
    setFlaps(flaps.h, pad(Math.floor(s % 86400 / 3600)));
    setFlaps(flaps.m, pad(Math.floor(s % 3600 / 60)));
    setFlaps(flaps.s, pad(s % 60));
  }

  // ---------- Hero ----------
  function renderHero(tr, phase) {
    const home = esc(site.home.city);
    document.body.classList.toggle("landed", phase === "home");
    $("countWrap").hidden = !(phase === "before" || phase === "away");
    if (phase === "none") {
      $("eyebrow").textContent = "No trips planned";
      $("headline").innerHTML = `${nm()} is <span class="hl">home</span>`;
      $("lede").innerHTML = `Safe and sound in ${home}. New trips will show up here as soon as they're booked.`;
      $("badge").textContent = "Home sweet home";
      return;
    }
    const dest = esc(tr.destination || tr.title);
    if (phase === "before") {
      $("eyebrow").textContent = `Next trip · ${tr.title}`;
      $("headline").innerHTML = `${nm()} is off to <span class="hl">${dest}</span>`;
      const leave = tr.leaveHome ? `${niceDate(localDate(tr.leaveHome))} at about ${localTime(tr.leaveHome)}` : niceDate(HC.ymdIn(site.home.tz, tr.startMs));
      $("lede").innerHTML = `Leaves home <strong>${leave}</strong>. Back in ${home} <strong>${homeWhen(tr)}</strong>.`;
      $("countLabel").textContent = "Leaving home in";
      $("badge").textContent = "Bon voyage!";
    } else if (phase === "away") {
      $("eyebrow").textContent = `${tr.title} · ${niceRange(ymdIn(site.home.tz, tr.startMs), localDate(tr.arriveHome))}`;
      $("headline").innerHTML = `${nm()} is coming <span class="hl">home!</span>`;
      $("lede").innerHTML = `Back in <strong>${home}</strong> on <strong>${homeWhen(tr)}</strong>. Get the snacks ready.`;
      $("countLabel").textContent = "Home in";
      $("badge").textContent = "See you soon!";
    } else if (phase === "home") {
      $("eyebrow").textContent = `Back from ${tr.destination || tr.title}`;
      $("headline").innerHTML = `${nm()} is <span class="hl">HOME!</span>`;
      $("lede").innerHTML = `Back in ${home} since ${homeWhen(tr)}. Hugs are now officially open. Put the kettle on!`;
      $("badge").textContent = "Welcome home!";
    } else {
      $("eyebrow").textContent = "Past trip";
      $("headline").innerHTML = `<span class="hl">${esc(tr.title)}</span>`;
      $("lede").innerHTML = `${nm()} went to ${dest} and got home on ${homeWhen(tr)}.`;
      $("badge").textContent = "Been there!";
    }
  }

  // ---------- Where is Dakotah ----------
  const homePt = () => ({ code: site.home.airport, city: site.home.city, lat: site.home.lat, lon: site.home.lon });
  function status(tr, t) {
    const fl = tr.flights, dest = esc(tr.destination || tr.title);
    const today = (tr.days || []).find(d => { const y = ymdIn(tr.destTz, t); return d.from <= y && y <= (d.to || d.from); });
    const todayLine = today ? `<small>Today: ${esc(today.label)}.</small>` : "";
    if (t < tr.startMs) {
      return { pill: "At home", cls: "ground", html: `At home in ${esc(site.home.city)}. <small>Leaves for ${dest} in ${dur(tr.startMs - t)}.</small>`, at: homePt() };
    }
    if (t >= tr.endMs) {
      return { pill: "Home", cls: "home", html: `Home in ${esc(site.home.city)}. <small>Welcome back, ${nm()}!</small>`, at: homePt(), done: true };
    }
    const air = fl.find(f => f.depMs <= t && t < f.arrMs);
    if (air) {
      return { pill: "In the air", cls: "air", air, f: (t - air.depMs) / (air.arrMs - air.depMs),
        html: `On ${esc(air.number)} from ${esc(air.from.city)} to ${esc(air.to.city)}. <small>Lands in ${dur(air.arrMs - t)}.</small>` };
    }
    const last = [...fl].reverse().find(f => f.arrMs <= t), next = fl.find(f => f.depMs > t);
    if (!last && next && next.depMs - t < 4 * 3600e3) {
      return { pill: "On the way", cls: "ground", html: `Heading to ${esc(next.from.city)} airport. <small>${esc(next.number)} departs in ${dur(next.depMs - t)}.</small>`, at: next.from };
    }
    if (last && next && next.depMs - last.arrMs < 12 * 3600e3) {
      return { pill: "Layover", cls: "ground", html: `Waiting at ${esc(last.to.city)} airport. <small>${esc(next.number)} to ${esc(next.to.city)} departs in ${dur(next.depMs - t)}.</small>`, at: last.to };
    }
    if (last && !next) {
      return { pill: "Landed", cls: "home", html: `Landed in ${esc(last.to.city)}. <small>On the way home, about ${dur(tr.endMs - t)} to go.</small>`, at: last.to };
    }
    const where = last ? last.to : fl[0]?.from;
    const nextLine = next ? `<small>Next flight: ${esc(next.number)} in ${dur(next.depMs - t)}.</small>` : "";
    return { pill: `In ${tr.destination || "town"}`, cls: "", html: `In ${esc(where?.city || tr.destination)}. ${todayLine}${nextLine}`, at: where || homePt() };
  }

  // ---------- Map (d3) ----------
  let map = null, worldP = null;
  const W = 800, H = 420;
  function world() {
    if (!worldP) worldP = fetch("https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json").then(r => r.json()).then(topo => topojson.feature(topo, topo.objects.countries)).catch(() => null);
    return worldP;
  }
  function buildMap(tr) {
    const box = $("mapBox");
    box.innerHTML = "";
    map = null;
    if (!window.d3 || !tr.flights.length) { box.hidden = true; return; }
    box.hidden = false;
    const pts = [];
    tr.flights.forEach(f => { pts.push([f.from.lon, f.from.lat], [f.to.lon, f.to.lat]); });
    pts.push([site.home.lon, site.home.lat]);
    const lons = pts.map(p => p[0]), lats = pts.map(p => p[1]);
    if (Math.max(...lons) - Math.min(...lons) < 6) { pts.push([Math.min(...lons) - 3, lats[0]], [Math.max(...lons) + 3, lats[0]]); }
    if (Math.max(...lats) - Math.min(...lats) < 4) { pts.push([lons[0], Math.min(...lats) - 2], [lons[0], Math.max(...lats) + 2]); }
    const proj = d3.geoMercator().fitExtent([[70, 50], [W - 70, H - 50]], { type: "MultiPoint", coordinates: pts });
    const path = d3.geoPath(proj);
    const svg = d3.select(box).append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("role", "img").attr("aria-label", "Route map");
    const land = svg.append("g");
    svg.append("path").datum(d3.geoGraticule10()).attr("d", path).attr("fill", "none").attr("stroke", "#ffffff10");
    world().then(fc => {
      if (!fc) return;
      land.selectAll("path").data(fc.features).join("path").attr("d", path).attr("fill", "#2c3f6e").attr("stroke", "#4d6aa3").attr("stroke-width", .8);
    });
    const routes = svg.append("g"), prog = svg.append("g");
    const colors = ["#ff6b5a", "#5cc8ff", "#c792ff", "#ffc857"];
    const legs = tr.flights.map((f, i) => {
      const line = { type: "LineString", coordinates: [[f.from.lon, f.from.lat], [f.to.lon, f.to.lat]] };
      routes.append("path").datum(line).attr("d", path).attr("fill", "none").attr("stroke", "#ffffff50").attr("stroke-width", 2).attr("stroke-dasharray", "4 6");
      const p = prog.append("path").attr("fill", "none").attr("stroke", colors[i % colors.length]).attr("stroke-width", 3.5).attr("stroke-linecap", "round");
      return { f, interp: d3.geoInterpolate(line.coordinates[0], line.coordinates[1]), p };
    });
    // Airports
    const seen = new Map();
    tr.flights.forEach(f => { seen.set(f.from.code, f.from); seen.set(f.to.code, f.to); });
    const ap = svg.append("g").attr("font-family", "JetBrains Mono, monospace").attr("font-weight", 700);
    const hx = proj([site.home.lon, site.home.lat]);
    const glow = ap.append("circle").attr("cx", hx[0]).attr("cy", hx[1]).attr("r", 20).attr("fill", "#6ff0b433");
    glow.append("animate").attr("attributeName", "r").attr("values", "12;26;12").attr("dur", "2.4s").attr("repeatCount", "indefinite");
    for (const a of seen.values()) {
      const [x, y] = proj([a.lon, a.lat]);
      const isHome = a.code === site.home.airport;
      ap.append("circle").attr("cx", x).attr("cy", y).attr("r", isHome ? 7 : 5.5).attr("fill", isHome ? "#6ff0b4" : "#ffc857");
      const right = x < W - 120;
      ap.append("text").attr("x", x + (right ? 12 : -12)).attr("y", y - 4).attr("text-anchor", right ? "start" : "end").attr("fill", "#f7f2ff").attr("font-size", 15).text(a.code);
      ap.append("text").attr("x", x + (right ? 12 : -12)).attr("y", y + 11).attr("text-anchor", right ? "start" : "end")
        .attr("fill", isHome ? "#6ff0b4" : "#a7abdb").attr("font-size", 10).attr("font-family", "DM Sans, sans-serif").attr("font-weight", isHome ? 700 : 400)
        .text(isHome ? "HOME" : a.city);
    }
    const plane = svg.append("g");
    plane.append("circle").attr("r", 17).attr("fill", "#ffffff1c");
    plane.append("path").attr("d", "M13 0 L-3 -3 L-7 -13 L-10 -13 L-7 -3 L-12 -3 L-14 -7 L-16 -7 L-15 0 L-16 7 L-14 7 L-12 3 L-7 3 L-10 13 L-7 13 L-3 3 Z").attr("fill", "#fff");
    map = { proj, path, legs, plane };
  }
  function updateMap(st, t) {
    if (!map) return;
    const { proj, path, legs, plane } = map;
    for (const L of legs) {
      const f = t >= L.f.arrMs ? 1 : t <= L.f.depMs ? 0 : (t - L.f.depMs) / (L.f.arrMs - L.f.depMs);
      L.p.attr("d", f > 0 ? path({ type: "LineString", coordinates: [L.interp(0), L.interp(f)] }) : null);
    }
    let x, y, ang = 0;
    if (st.air) {
      const L = legs.find(l => l.f === st.air);
      const a = proj(L.interp(st.f)), b = proj(L.interp(Math.min(1, st.f + .01))), c = proj(L.interp(Math.max(0, st.f - .01)));
      [x, y] = a; ang = Math.atan2(b[1] - c[1], b[0] - c[0]) * 180 / Math.PI;
    } else {
      [x, y] = proj([st.at.lon, st.at.lat]);
      const next = legs.find(l => l.f.depMs > t);
      if (next) { const a = proj(next.interp(0)), b = proj(next.interp(.02)); ang = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI; }
    }
    plane.attr("transform", `translate(${x} ${y}) rotate(${ang})`);
  }

  // ---------- Plan, flights, photos ----------
  const KINDS = { flying: "Flying", event: "Event", meetings: "Meetings", free: "Free time", other: "Plans" };
  function renderPlan(tr) {
    const days = [...(tr.days || [])].sort((a, b) => a.from.localeCompare(b.from));
    $("planSec").hidden = !days.length;
    $("planSub").textContent = `${tr.title}, day by day.`;
    $("plan").innerHTML = days.map(d => `
      <li data-from="${esc(d.from)}" data-to="${esc(d.to || d.from)}">
        <span class="when">${esc(niceRange(d.from, d.to))}</span>
        <span class="kind ${esc(d.kind || "other")}">${esc(KINDS[d.kind] || KINDS.other)}</span>
        <span class="what">${esc(d.label)}</span>
      </li>`).join("");
  }
  function markPlan(tr, t) {
    const y = ymdIn(tr.destTz, t);
    document.querySelectorAll("#plan li").forEach(li => {
      li.classList.toggle("today", li.dataset.from <= y && y <= li.dataset.to);
      li.classList.toggle("done", li.dataset.to < y);
    });
  }
  const planeIcon = `<svg width="40" height="18" viewBox="-20 -9 40 18" aria-hidden="true"><path d="M13 0 L-3 -3 L-7 -8 L-10 -8 L-7 -3 L-12 -3 L-14 -6 L-16 -6 L-15 0 L-16 6 L-14 6 L-12 3 L-7 3 L-10 8 L-7 8 L-3 3 Z" fill="#9994c0"/></svg>`;
  function renderFlights(tr) {
    $("flightSec").hidden = !tr.flights.length;
    const out = [];
    tr.flights.forEach((f, i) => {
      const prev = tr.flights[i - 1];
      if (prev && f.depMs - prev.arrMs < 24 * 3600e3 && prev.to.code === f.from.code) {
        out.push(`<div class="layover">Layover at ${esc(prev.to.city)}: <b>${dur(f.depMs - prev.arrMs)}</b> · ${localTime(prev.arr)} &rarr; ${localTime(f.dep)}</div>`);
      } else if (prev) {
        out.push(`<div class="layover">&middot; &middot; &middot;</div>`);
      }
      const op = f.operatedBy && f.operatedBy !== f.airline ? ` · operated by ${esc(f.operatedBy)}` : "";
      const fr = "https://www.flightradar24.com/data/flights/" + encodeURIComponent(f.number.replace(/\s+/g, "").toLowerCase());
      out.push(`
      <article class="pass">
        <div class="pass-top"><span class="fl">${esc(f.number)}</span><span class="air">${esc(f.airline)}${op}</span></div>
        <div class="pass-body">
          <div class="route">
            <div><div class="code">${esc(f.from.code)}</div><div class="city">${esc(f.from.city)}</div></div>
            <div class="mid">${planeIcon}${dur(f.arrMs - f.depMs)}</div>
            <div class="to"><div class="code">${esc(f.to.code)}</div><div class="city">${esc(f.to.city)}</div></div>
          </div>
          <div class="times">
            <div><div class="label">Departs</div><div class="v">${localTime(f.dep)}</div><div class="z">${niceDate(localDate(f.dep))} · ${esc(f.from.city)} time</div></div>
            <div class="r"><div class="label">Arrives</div><div class="v">${localTime(f.arr)}</div><div class="z">${niceDate(localDate(f.arr))} · ${esc(f.to.city)} time</div></div>
          </div>
          <div class="pass-foot">
            <span class="leg-status" data-leg="${i}">Scheduled</span>
            <a href="${fr}" target="_blank" rel="noopener">Track ${esc(f.number)} live &rarr;</a>
          </div>
        </div>
      </article>`);
    });
    $("flights").innerHTML = out.join("");
  }
  function markFlights(tr, t) {
    document.querySelectorAll(".leg-status").forEach(el => {
      const f = tr.flights[+el.dataset.leg];
      const s = t >= f.arrMs ? ["Landed", "landed"] : t >= f.depMs ? ["In the air", "air"] : t >= f.depMs - 45 * 60e3 ? ["Boarding", "air"] : ["Scheduled", ""];
      el.textContent = s[0]; el.className = "leg-status " + s[1];
    });
  }
  function renderShots(tr) {
    const shots = (tr.screenshots || []).filter(s => s.path);
    $("shotSec").hidden = !shots.length;
    $("shots").innerHTML = shots.map(s => `<img src="${esc(s.path)}" alt="Itinerary for ${esc(tr.title)}" loading="lazy">`).join("");
  }

  let heroTimer = null;
  function renderPhotos() {
    const ph = site.photos || [];
    $("wallSec").hidden = !ph.length;
    $("wall").innerHTML = ph.map(p => `<figure class="snap"><img src="${esc(p.src)}" alt="${esc(p.caption || site.name)}" loading="lazy"><figcaption>${esc(p.caption)}</figcaption></figure>`).join("");
    if (!ph.length) return;
    $("back1").src = ph[1 % ph.length].src; $("back2").src = ph[2 % ph.length].src;
    let i = 0;
    const show = () => { $("heroImg").src = ph[i].src; $("heroCap").textContent = ph[i].caption || ""; };
    show();
    clearInterval(heroTimer);
    if (ph.length > 1) heroTimer = setInterval(() => {
      i = (i + 1) % ph.length;
      $("heroImg").style.opacity = 0; $("heroCap").style.opacity = 0;
      setTimeout(() => { show(); $("heroImg").style.opacity = 1; $("heroCap").style.opacity = 1; }, 600);
    }, 4200);
  }

  // ---------- Trips drawer ----------
  function renderDrawer() {
    const t = now(), feat = featuredTrip(t);
    const upcoming = trips.filter(tr => tr.endMs + CELEBRATE_MS > t);
    const past = trips.filter(tr => tr.endMs + CELEBRATE_MS <= t).reverse().slice(0, 12);
    const others = upcoming.filter(tr => tr !== trip).length;
    $("tripCount").textContent = others; $("tripCount").dataset.n = others;
    const card = (tr, tag) => {
      const range = niceRange(ymdIn(site.home.tz, tr.startMs), localDate(tr.arriveHome));
      return `<a class="trip-card ${tr === trip ? "current" : ""}" href="#trip-${esc(tr.id)}">
        ${tag ? `<span class="kind ${tag[1]} tag">${tag[0]}</span>` : ""}
        <span class="t">${esc(tr.title)}</span><span class="d">${esc(tr.destination || "")} · ${esc(range)}</span></a>`;
    };
    let html = `<div class="label">Coming up</div>`;
    html += upcoming.length ? upcoming.map(tr => card(tr, tr === feat ? (phaseOf(tr, t) === "before" ? ["Next", "event"] : ["Now", "flying"]) : null)).join("") : `<p class="empty">Nothing booked yet.</p>`;
    if (past.length) html += `<div class="label">Been there</div>` + past.map(tr => card(tr)).join("");
    $("tripList").innerHTML = html;
  }
  function openDrawer(open) {
    document.body.classList.toggle("drawer-open", open);
    $("tripsBtn").setAttribute("aria-expanded", open);
    $("drawer").setAttribute("aria-hidden", !open);
    if (open) $("closeDrawer").focus();
  }
  $("tripsBtn").addEventListener("click", () => openDrawer(true));
  $("closeDrawer").addEventListener("click", () => openDrawer(false));
  $("scrim").addEventListener("click", () => openDrawer(false));
  addEventListener("keydown", e => { if (e.key === "Escape") openDrawer(false); });
  $("tripList").addEventListener("click", e => { if (e.target.closest("a")) openDrawer(false); });
  addEventListener("hashchange", () => {
    const h = location.hash.slice(1);
    if (h.startsWith("trip-") || h === "") { render(); scrollTo({ top: 0, behavior: "smooth" }); }
  });

  // ---------- Render + tick ----------
  function render() {
    trip = viewedTrip();
    const t = now(), phase = phaseOf(trip, t);
    phaseKey = (trip?.id || "") + phase;
    document.title = site.name ? `Where's ${site.name}?` : document.title;
    $("brandName").textContent = `Where's ${site.name}?`;
    $("trackLink").textContent = `Where is ${site.name} now?`;
    $("trackLink").hidden = !trip;
    renderHero(trip, phase);
    $("tracker").hidden = !trip;
    if (trip) { buildMap(trip); renderPlan(trip); renderFlights(trip); renderShots(trip); }
    else { $("planSec").hidden = $("flightSec").hidden = $("shotSec").hidden = true; }
    $("footer").innerHTML = trip && phase !== "past"
      ? `<b>See you at arrivals</b>${esc(site.home.city)} · ${homeWhen(trip)}`
      : `<b>Love from ${esc(site.home.city)}</b>`;
    renderDrawer();
    tick(true);
    if (phase === "home") burst(220);
  }
  function tick(force) {
    const t = now();
    if (!trip) return;
    const phase = phaseOf(trip, t);
    if (!force && (trip.id + phase) !== phaseKey) return render();
    if (phase === "before") setCountdown(trip.startMs - t);
    else if (phase === "away") setCountdown(trip.endMs - t);
    const st = status(trip, t);
    $("pill").className = "pill " + st.cls; $("pill").textContent = st.pill;
    $("statusText").innerHTML = st.html;
    updateMap(st, t);
    $("clkDestLabel").textContent = `Time in ${trip.destination || "destination"}`;
    $("clkDest").textContent = clockIn(trip.destTz, t); $("clkDestTz").textContent = gmtLabel(trip.destTz, t);
    $("clkHomeLabel").textContent = `Time in ${site.home.city}`;
    $("clkHome").textContent = clockIn(site.home.tz, t); $("clkHomeTz").textContent = gmtLabel(site.home.tz, t);
    const pct = Math.max(0, Math.min(1, (t - trip.startMs) / (trip.endMs - trip.startMs || 1)));
    $("tripPct").textContent = Math.floor(pct * 100) + "%";
    $("tripNote").textContent = `of ${dur(trip.endMs - trip.startMs)} away`;
    markPlan(trip, t); markFlights(trip, t);
    celebrating = phase === "home";
  }

  // ---------- Confetti ----------
  const cv = $("confetti"), ctx = cv.getContext("2d");
  const colors = ["#ff6b5a", "#ffc857", "#5cc8ff", "#6ff0b4", "#f7f2ff", "#c792ff"];
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let parts = [], running = false, CW = 0, CH = 0, celebrating = false;
  function size() { const r = devicePixelRatio || 1; CW = innerWidth; CH = innerHeight; cv.width = CW * r; cv.height = CH * r; ctx.setTransform(r, 0, 0, r, 0, 0); }
  size(); addEventListener("resize", size);
  function burst(n = 140, x, y) {
    if (reduce) return;
    for (let i = 0; i < n; i++) {
      const top = x === undefined;
      parts.push({
        x: top ? Math.random() * CW : x, y: top ? -20 - Math.random() * CH * .4 : y,
        vx: top ? (Math.random() - .5) * 2 : (Math.random() - .5) * 14, vy: top ? 2 + Math.random() * 3 : -6 - Math.random() * 9,
        w: 6 + Math.random() * 7, h: 8 + Math.random() * 10, r: Math.random() * 6, vr: (Math.random() - .5) * .3, c: colors[i % colors.length], life: 0
      });
    }
    if (!running) { running = true; requestAnimationFrame(frame); }
  }
  function frame() {
    ctx.clearRect(0, 0, CW, CH);
    parts = parts.filter(p => p.y < CH + 40 && p.life < 900);
    for (const p of parts) {
      p.life++; p.vy = Math.min(p.vy + .12, 5); p.vx *= .99; p.x += p.vx + Math.sin(p.life / 12); p.y += p.vy; p.r += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.scale(1, Math.cos(p.life / 8)); ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
    }
    if (celebrating && Math.random() < .25) burst(3);
    if (parts.length) requestAnimationFrame(frame); else running = false;
  }
  $("partyBtn").addEventListener("click", e => { const r = e.currentTarget.getBoundingClientRect(); burst(160, r.left + r.width / 2, r.top); });

  // ---------- Boot ----------
  load().then(() => {
    renderPhotos(); render();
    setInterval(() => tick(false), 1000);
    setTimeout(() => burst(90), 500);
    setInterval(() => load().then(changed => { if (changed) { renderPhotos(); render(); } }).catch(() => {}), 5 * 60e3);
  }).catch(err => {
    $("eyebrow").textContent = "Couldn't load the trips";
    $("lede").textContent = "Check your connection and refresh the page.";
    console.error(err);
  });
})();
