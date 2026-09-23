// Shared helpers for the public site and the admin page.
// Times are stored as local wall-clock strings ("2026-09-28T16:40") plus an IANA time zone,
// exactly as they appear on a ticket. They are converted to real instants here.

const HC = (() => {
  const dtfCache = {};
  function dtf(tz) {
    return dtfCache[tz] || (dtfCache[tz] = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit"
    }));
  }
  // Offset (ms) of a time zone from UTC at a given instant
  function tzOffset(ms, tz) {
    const p = {};
    for (const { type, value } of dtf(tz).formatToParts(new Date(ms))) p[type] = +value;
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
    return asUtc - Math.floor(ms / 1000) * 1000;
  }
  // "2026-09-28T16:40" in tz -> epoch ms
  function toUtc(local, tz) {
    if (!local) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(local);
    if (!m) return null;
    const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
    let t = guess - tzOffset(guess, tz);
    const off2 = tzOffset(t, tz);
    if (guess - off2 !== t) t = guess - off2;
    return t;
  }
  const localDate = s => (s || "").slice(0, 10);
  const localTime = s => (s || "").slice(11, 16);

  // "2026-10-06" -> "Tue 6 Oct"
  function niceDate(ymd, opts = {}) {
    if (!ymd) return "";
    const [y, mo, d] = ymd.split("-").map(Number);
    const dt = new Date(Date.UTC(y, mo - 1, d, 12));
    return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", ...(opts.year ? { year: "numeric" } : {}) }).format(dt);
  }
  function niceRange(from, to) {
    if (!to || to === from) return niceDate(from);
    const a = niceDate(from), b = niceDate(to);
    if (from.slice(0, 7) === to.slice(0, 7)) return a.replace(/ \w+$/, "") + " - " + b;
    return a + " - " + b;
  }
  function clockIn(tz, ms) {
    return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(ms);
  }
  function ymdIn(tz, ms) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
  }
  function gmtLabel(tz, ms = Date.now()) {
    const h = tzOffset(ms, tz) / 3600e3;
    return "GMT" + (h >= 0 ? "+" : "") + (Number.isInteger(h) ? h : h.toFixed(1));
  }
  function dur(ms) {
    const m = Math.max(0, Math.round(ms / 60e3)), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
    return (d ? d + "d " : "") + (d || h ? h + "h " : "") + mm + "m";
  }
  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // Derive the real instants for a trip, sorted flights, start and end.
  function prepareTrip(trip, site) {
    const homeTz = site.home.tz;
    const flights = (trip.flights || []).map(f => ({
      ...f,
      depMs: toUtc(f.dep, f.from.tz),
      arrMs: toUtc(f.arr, f.to.tz)
    })).filter(f => f.depMs && f.arrMs).sort((a, b) => a.depMs - b.depMs);
    const leaveMs = toUtc(trip.leaveHome, homeTz);
    const homeMs = toUtc(trip.arriveHome, homeTz);
    const firstDay = (trip.days || []).map(d => d.from).filter(Boolean).sort()[0];
    // Without a "leave home" time, a trip whose first flight isn't from home is already under way
    const f0dep = flights[0]?.depMs, awayAlready = flights[0] && flights[0].from.code !== site.home.airport;
    const dayStart = toUtc(firstDay, homeTz);
    // (startMs is then -Infinity: away since some unknown time)
    const startMs = leaveMs ?? (awayAlready ? -Infinity : f0dep ?? dayStart ?? homeMs);
    const endMs = homeMs ?? flights.at(-1)?.arrMs ?? startMs;
    // Where Dakotah spends the trip: the arrival airport of the last outbound flight
    // (set from the destination airport in the admin; otherwise guessed from the flights)
    const f0 = flights[0];
    const destTz = trip.destTz || (f0 ? (f0.from.code === site.home.airport ? f0.to.tz : f0.from.tz) : homeTz);
    return { ...trip, flights, leaveMs, homeMs, startMs, endMs, destTz };
  }

  // "Fri 25 - Mon 28 Sept", falling back to the first planned day when the leave time is unknown
  function tripRange(p, site) {
    const from = isFinite(p.startMs) ? ymdIn(site.home.tz, p.startMs) : ((p.days || []).map(d => d.from).sort()[0] || localDate(p.arriveHome));
    return niceRange(from, localDate(p.arriveHome) || from);
  }

  async function loadJson(path) {
    const r = await fetch(path + (path.includes("?") ? "&" : "?") + "v=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error(path + " " + r.status);
    return r.json();
  }

  return { tzOffset, toUtc, localDate, localTime, niceDate, niceRange, clockIn, ymdIn, gmtLabel, dur, esc, prepareTrip, tripRange, loadJson };
})();
