import { useState, useEffect, useMemo, useRef } from "react";
import { storageGet, storageSet, storageSubscribe, usingSharedStorage } from "./storage.js";

/* ================================================================
   180 DEGREES PURDUE SCHEDULING WEBSITE
   ----------------------------------------------------------------
   ADMIN CUSTOMIZATION — edit everything in CONFIG below.
   `primaryGreen` recolors the entire site from this one line.

   EMAIL SENDING (optional, free):
   1. Create a free account at https://www.emailjs.com
   2. Add an email service + a template with variables:
      {{to_email}} {{to_name}} {{date}} {{time}} {{interviewer}} {{teams_link}} {{booking_id}}
   3. Paste your serviceId, templateId and publicKey into CONFIG.emailJs.
   Until keys are added, the site shows a prefilled email draft button instead.

   TEAMS LINKS: paste each interviewer's standing Teams meeting link
   below — it is shown on the confirmation page and included in emails.
   ================================================================ */

const LOGO_URL =
  "https://cdn.prod.website-files.com/63b610d81215b25001c51b2b/6473fc49131edc263274c582_180DEGREES-FULL-CONSULTING-LANDSCAPE%20(1).avif";
const LOGO_FALLBACK = "data:image/png;base64,__LIGHT_B64__";

const CONFIG = {
  siteName: "180 Degrees Purdue Scheduling Website",
  primaryGreen: "#76A935",
  primaryGreenDark: "#618E2A",
  primaryGreenTint: "#F2F8E9",
  clubEmail: "purdue@180dc.org",
  instagram: "https://www.instagram.com/purdue180dc/",
  linkedin: "https://www.linkedin.com/company/180-degrees-consulting-purdue/posts/?feedView=all",
  homeHeading: "Schedule Your 180 Degrees Purdue Retention Feedback Call",
  homeDescription:
    "Select an available time for your 180 Degrees Purdue retention feedback call. Once your booking is confirmed, an available interviewer will automatically be assigned to you.",
  footerTagline: "Retention Feedback Call Scheduling Portal",

  /* ============================================================
     180 TEAM LOGINS — 6 members. Each person has their own
     password and their own permanent Microsoft Teams link.

     >>> PASTE EACH PERSON'S TEAMS LINK in the teamsLink field <<<
     (In Teams: Calendar → New meeting → save → open it → copy the
     "Join" link. That link is permanent and can be reused for
     every call. Replace the PASTE_TEAMS_LINK_HERE text below.)
     ============================================================ */
  teamMembers: [
    { name: "Liz Liban", role: "Managing Director", email: "eliban@purdue.edu", password: "liz1234", teamsLink: "PASTE_TEAMS_LINK_HERE" },
    { name: "Rishi Kattunga", role: "Senior Director", email: "rkattung@purdue.edu", password: "rishi1234", teamsLink: "PASTE_TEAMS_LINK_HERE" },
    { name: "Liya Abil", role: "Director of Internal Operations", email: "labil@purdue.edu", password: "liya1234", teamsLink: "PASTE_TEAMS_LINK_HERE" },
    { name: "Dev Makhecha", role: "Director of Recruitment", email: "dmakhech@purdue.edu", password: "dev1234", teamsLink: "PASTE_TEAMS_LINK_HERE" },
    { name: "Anushka Wayse", role: "Director of Professional Development", email: "wayse@purdue.edu", password: "anushka1234", teamsLink: "PASTE_TEAMS_LINK_HERE" },
    { name: "Fabian Lugo", role: "Director of Client Acquisition", email: "lugof@purdue.edu", password: "fabian1234", teamsLink: "PASTE_TEAMS_LINK_HERE" },
    { name: "Harish Venkatasubramanian", role: "Director of Client Success", email: "venka178@purdue.edu", password: "harish1234", teamsLink: "PASTE_TEAMS_LINK_HERE" },
    { name: "Alex Okano", role: "Director of Marketing", email: "aokano@purdue.edu", password: "alex1234", teamsLink: "PASTE_TEAMS_LINK_HERE" },
  ],
  defaultTimes: ["10:00 AM", "11:00 AM", "1:00 PM", "2:00 PM", "3:00 PM", "4:00 PM"],
  bookingWindowDays: 21,
  emailJs: {
    serviceId: "service_ifxa7sj",
    templateId: "template_we57qxl",              // member interviewee email
    templateIdInterviewer: "template_10fsu3n",   // member interviewer email
    templateIdCandidate: "template_9dsxr6m",      // PROSPECTIVE-CONSULTANT email
    publicKey: "k_yovKbdn3CGIEVL9",
  },

  /* ============================================================
     PROSPECTIVE-CONSULTANT INTERVIEW ADMIN
     Demo credentials only — CHANGE before production.
     ============================================================ */
  interviewAdmin: { username: "180DC", password: "41234" },

  /* Defaults used when creating a new interview event */
  interviewDefaults: {
    candidatesPerCohort: 4,
    behavioralMin: 15,
    bufferMin: 5,
    caseMin: 45,
    cohortIntervalMin: 65,   // behavioral + buffer + case
    arrivalLeadMin: 10,      // "arrive 5–10 min early"
    startTime: "18:30",
    endTime: "22:00",
  },
  arrivalInstruction: "Please arrive 5–10 minutes before your scheduled start time.",
};

/* ---------------- helpers ---------------- */
const iso = (d) => d.toISOString().slice(0, 10);
const prettyDate = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
};
const shortDay = (s) => new Date(s + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" });
const shortDate = (s) => new Date(s + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });

function bookableDates() {
  const out = [], today = new Date();
  for (let i = 1; i <= CONFIG.bookingWindowDays; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    if (d.getDay() !== 0 && d.getDay() !== 6) out.push(iso(d));
  }
  return out;
}

const STORAGE_KEY = "180dc_scheduler_data";
const emptyData = {
  bookings: [], closedSlots: [], memberAvail: {}, memberLinks: {}, availSetAt: {},
  /* prospective-consultant interview system */
  interviewEvents: [],   // [{ id, name, dates:["YYYY-MM-DD"], location{building,room,address,notes}, startTime, endTime, behavioralMin, bufferMin, caseMin, candidatesPerCohort, cohortIntervalMin, cohortMeta:{}, arrivalInstruction }]
  candidates: [],        // [{ id, eventId, date, cohortId, name, email, purdueId, phone, status, createdAt, cancelled }]
  interviewTimers: {},   // { "<eventId>|<date>|<cohortId>": startMs }
};

/* Effective Teams link for a member: link saved in the Team Area wins,
   otherwise the one pasted in CONFIG. */
const linkFor = (name, data) => {
  const saved = (data.memberLinks || {})[name];
  if (saved) return saved;
  const m = CONFIG.teamMembers.find((p) => p.name === name);
  return m && m.teamsLink && !m.teamsLink.includes("PASTE_TEAMS_LINK") ? m.teamsLink : "";
};

/* Members available to take a given slot. If nobody on the team has set
   any availability yet, everyone is considered available (so the site
   works out of the box). */
/* Each member's availability is a map of { "YYYY-MM-DD": "their times that day (EST)" }.
   Older saved data may be an array of dates — normalize it. */
const availMapFor = (name, data) => {
  const raw = (data.memberAvail || {})[name];
  if (!raw) return {};
  const norm = {};
  if (Array.isArray(raw)) { raw.forEach((d) => { norm[d] = []; }); return norm; } // legacy: list of dates
  Object.entries(raw).forEach(([d, v]) => {
    if (Array.isArray(v)) norm[d] = v;            // current: list of windows
    else if (v) norm[d] = [v];                    // legacy: single window string
    else norm[d] = [];
  });
  return norm;
};

const candidatesFor = (d, data) => {
  const anyoneSet = CONFIG.teamMembers.some((m) => Object.keys(availMapFor(m.name, data)).length > 0);
  if (!anyoneSet) return CONFIG.teamMembers.map((m) => m.name);
  return CONFIG.teamMembers.filter((m) => d in availMapFor(m.name, data)).map((m) => m.name);
};

/* ----- 30-minute slot machinery (all times EST) ----- */
const minsToLabel = (m) => {
  const h24 = Math.floor(m / 60), mm = m % 60;
  const ap = h24 >= 12 ? "PM" : "AM";
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${String(mm).padStart(2, "0")} ${ap}`;
};
/* dropdown choices for interviewers: 8:00 AM → 10:00 PM in 30-min steps */
const TIME_CHOICES = Array.from({ length: (22 - 8) * 2 + 1 }, (_, i) => 8 * 60 + i * 30);

/* A stored window is "start|end" (minutes). Legacy free text like "10:00 AM - 12:30 PM" is parsed too. */
const parseWindow = (raw) => {
  if (!raw) return null;
  const str = String(raw).trim();
  if (/^\d+\|\d+$/.test(str)) {
    const [a, b] = str.split("|").map(Number);
    return b > a ? [a, b] : null;
  }
  const times = [...str.matchAll(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/gi)].map((m) => {
    let h = parseInt(m[1], 10) % 12;
    if (/pm/i.test(m[3])) h += 12;
    return h * 60 + (m[2] ? parseInt(m[2], 10) : 0);
  });
  return times.length >= 2 && times[1] > times[0] ? [times[0], times[1]] : null;
};

/* 30-min start times inside a window: 10:00–12:30 → 10:00, 10:30, 11:00, 11:30, 12:00 */
const slotsInWindow = (win) => {
  const p = parseWindow(win);
  if (!p) return [];
  const out = [];
  for (let t = p[0]; t + 30 <= p[1]; t += 30) out.push(minsToLabel(t));
  return out;
};

/* All bookable slots on a day → { "10:00 AM": [memberNames offering it] }.
   If nobody on the team has set any availability yet, fall back to the default
   hourly times with the whole team, so the site works out of the box. */
const slotMapFor = (d, data) => {
  const anyoneSet = CONFIG.teamMembers.some((m) => Object.keys(availMapFor(m.name, data)).length > 0);
  const map = {};
  if (!anyoneSet) {
    CONFIG.defaultTimes.forEach((t) => { map[t] = CONFIG.teamMembers.map((m) => m.name); });
    return map;
  }
  CONFIG.teamMembers.forEach((m) => {
    const wins = availMapFor(m.name, data)[d];
    if (wins === undefined) return;
    wins.forEach((win) =>
      slotsInWindow(win).forEach((t) => {
        if (!(map[t] = map[t] || []).includes(m.name)) map[t].push(m.name);
      })
    );
  });
  return map;
};

const slotSort = (a, b) => {
  const toMin = (l) => {
    const m = l.match(/(\d{1,2}):(\d{2}) (AM|PM)/);
    let h = parseInt(m[1], 10) % 12;
    if (m[3] === "PM") h += 12;
    return h * 60 + parseInt(m[2], 10);
  };
  return toMin(a) - toMin(b);
};
const emailConfigured = () => CONFIG.emailJs.serviceId && CONFIG.emailJs.templateId && CONFIG.emailJs.publicKey;

/* Send confirmation emails via EmailJS (interviewee + interviewer). */
async function sendEmails(booking) {
  if (!emailConfigured()) return { sent: false };
  const iv = CONFIG.teamMembers.find((p) => p.name === booking.interviewer) || {};
  const link = booking.teamsLink || "";
  const base = {
    date: prettyDate(booking.date), time: `${booking.time} (EST)`,
    meeting_link: link, teams_link: link, booking_id: booking.id,
  };
  const send = (template_id, params) =>
    fetch("https://api.emailjs.com/api/v1.0/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service_id: CONFIG.emailJs.serviceId,
        template_id,
        user_id: CONFIG.emailJs.publicKey,
        template_params: params,
      }),
    });
  try {
    await Promise.all([
      /* interviewee: who's interviewing them + when + link */
      send(CONFIG.emailJs.templateId, {
        ...base, to_email: booking.email, to_name: booking.name,
        interviewer: booking.interviewer,
      }),
      /* interviewer: who they're interviewing + when + link */
      iv.email
        ? send(CONFIG.emailJs.templateIdInterviewer || CONFIG.emailJs.templateId, {
            ...base, to_email: iv.email, to_name: booking.interviewer,
            interviewer: booking.interviewer,
            interviewee_name: booking.name, interviewee_email: booking.email,
          })
        : Promise.resolve(),
    ]);
    return { sent: true };
  } catch (e) {
    console.error("Email send failed", e);
    return { sent: false };
  }
}

/* confirmation email for a prospective consultant */
async function sendCandidateEmail(cand, ev, cohort, date) {
  if (!emailConfigured() || !CONFIG.emailJs.templateIdCandidate) return { sent: false };
  const loc = ev.location || {};
  const locStr = [loc.building, loc.room && `Room ${loc.room}`, loc.address].filter(Boolean).join(", ");
  const endTime = addMin(cohort.start, cohortDuration(ev));
  const params = {
    to_email: cand.email,
    to_name: cand.name,
    first_name: (cand.name || "").split(" ")[0],
    date: prettyDate(date || cand.date),
    arrival_time: cohort.start,
    start_time: cohort.start,
    end_time: endTime,
    location: locStr || "(location to be shared)",
    building: loc.building || "",
    room: loc.room || "",
    format: "15-min Behavioral · 5-min Transition · 45-min Case Interview",
    booking_id: cand.id,
    arrival_note: ev.arrivalInstruction || CONFIG.arrivalInstruction,
    manage_link: `${(typeof window !== "undefined" ? window.location.origin : "")}/?manage=${cand.id}`,
  };
  try {
    await fetch("https://api.emailjs.com/api/v1.0/email/send", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service_id: CONFIG.emailJs.serviceId,
        template_id: CONFIG.emailJs.templateIdCandidate,
        user_id: CONFIG.emailJs.publicKey,
        template_params: params,
      }),
    });
    return { sent: true };
  } catch (e) { console.error("Candidate email failed", e); return { sent: false }; }
}

function mailtoDraft(booking) {
  const iv = CONFIG.teamMembers.find((p) => p.name === booking.interviewer) || {};
  const link = booking.teamsLink || "";
  const subject = encodeURIComponent(`180 Degrees Purdue — Retention Feedback Call Confirmed (${booking.id})`);
  const body = encodeURIComponent(
    `Hi ${booking.name},\n\nYour 180 Degrees Purdue retention feedback call is confirmed.\n\n` +
    `Date: ${prettyDate(booking.date)}\nTime: ${booking.time}\nInterviewer: ${booking.interviewer}\n` +
    `Meeting link: ${link || "(to be shared)"}\n\nConfirmation ID: ${booking.id}\n\n— 180 Degrees Consulting Purdue`
  );
  return `mailto:${booking.email}?cc=${iv.email || ""}&subject=${subject}&body=${body}`;
}

/* ============================================================
   PROSPECTIVE-CONSULTANT INTERVIEW ENGINE
   ============================================================ */
const pad2 = (n) => String(n).padStart(2, "0");
const minToClock = (m) => {                       // 1110 -> "6:30 PM"
  let h = Math.floor(m / 60), mm = m % 60;
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 === 0 ? 12 : h % 12;
  return `${h}:${pad2(mm)} ${ap}`;
};
const clockToMin = (hhmm) => {                     // "18:30" -> 1110
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const addMin = (clockLabel, mins) => {            // ("6:30 PM", 65) -> "7:35 PM"
  const m = /(\d+):(\d+)\s*(AM|PM)/.exec(clockLabel);
  let h = (+m[1] % 12) + (m[3] === "PM" ? 12 : 0);
  return minToClock(h * 60 + (+m[2]) + mins);
};
const cohortDuration = (ev) => ev.behavioralMin + ev.bufferMin + ev.caseMin;

/* An event holds shared settings (location, format, time window) and a list of
   interview DATES. Cohorts are derived from the window + interval and are the
   SAME set of start times on every date. A cohort instance is identified by
   (eventId, date, cohortId). */
function cohortTimes(ev) {
  const start = clockToMin(ev.startTime), end = clockToMin(ev.endTime);
  const dur = cohortDuration(ev);
  const out = [];
  let i = 0;
  for (let t = start; t + dur <= end + 0.001; t += ev.cohortIntervalMin) {
    out.push({ id: `C${i}`, startMin: t, start: minToClock(t) });
    i++;
  }
  return out;
}
/* backward-compat alias */
const generateCohorts = (ev) => cohortTimes(ev).map((c) => ({ ...c, capacity: ev.candidatesPerCohort, behavioralIvs: [], caseTeam: "" }));

const eventById = (data, id) => (data.interviewEvents || []).find((e) => e.id === id);
const eventDates = (ev) => (ev.dates || []).slice().sort();

/* per-cohort overrides live on ev.cohortMeta["<date>|<cohortId>"] = { capacity?, closed?, behavioralIvs?, caseTeam? } */
const cohortMeta = (ev, date, cohortId) => (ev.cohortMeta || {})[`${date}|${cohortId}`] || {};
const cohortCapacity = (ev, date, cohortId) => {
  const m = cohortMeta(ev, date, cohortId);
  return m.capacity != null ? m.capacity : ev.candidatesPerCohort;
};
const cohortClosed = (ev, date, cohortId) => !!cohortMeta(ev, date, cohortId).closed;

const candidatesInCohort = (data, eventId, date, cohortId) =>
  (data.candidates || []).filter((c) => c.eventId === eventId && c.date === date && c.cohortId === cohortId && !c.cancelled);
const cohortRemaining = (data, ev, date, cohortId) =>
  cohortCapacity(ev, date, cohortId) - candidatesInCohort(data, ev.id, date, cohortId).length;

/* dates on an event that still have any open cohort */
const openDates = (data, ev) =>
  eventDates(ev).filter((d) => cohortTimes(ev).some((c) => !cohortClosed(ev, d, c.id) && cohortRemaining(data, ev, d, c.id) > 0));
/* open cohort times on a specific date */
const openCohortsOn = (data, ev, date) =>
  cohortTimes(ev).filter((c) => !cohortClosed(ev, date, c.id) && cohortRemaining(data, ev, date, c.id) > 0);

/* all candidates for an event across dates */
const eventCandidates = (data, ev) =>
  (data.candidates || []).filter((c) => c.eventId === ev.id && !c.cancelled);

const INTERVIEW_STATUSES = ["Not Arrived", "Checked In", "Behavioral", "Waiting", "Case Interview", "Completed", "No Show"];

/* ---------------- shared atoms ---------------- */
const Logo = ({ h = 48 }) => {
  const [broken, setBroken] = useState(false);
  return (
    <img src={broken ? LOGO_FALLBACK : LOGO_URL} alt="180 Degrees Consulting"
      style={{ height: h, width: "auto" }} onError={() => setBroken(true)} />
  );
};

const Btn = ({ children, onClick, kind = "primary", disabled, small, style }) => (
  <button type="button" onClick={onClick} disabled={disabled}
    className={`btn btn-${kind}${small ? " btn-sm" : ""}`} style={style}>
    {children}
  </button>
);

const Field = ({ label, ...props }) => (
  <label className="field">
    <span>{label}</span>
    <input {...props} />
  </label>
);

/* ================================================================ */
export default function App() {
  const [page, setPage] = useState("home");
  const [data, setData] = useState(emptyData);
  const [loaded, setLoaded] = useState(false);
  const [lastBooking, setLastBooking] = useState(null);
  const [emailStatus, setEmailStatus] = useState(null);
  const [teamUser, setTeamUser] = useState(null); // logged-in team member object
  const [ivAdmin, setIvAdmin] = useState(false);   // interview admin logged in
  const [lastCandidate, setLastCandidate] = useState(null);
  const [candEmailStatus, setCandEmailStatus] = useState(null);

  const dataRef = useRef(data);
  const lastSigRef = useRef(null);
  useEffect(() => { dataRef.current = data; }, [data]);

  useEffect(() => { document.title = CONFIG.siteName; }, []);
  const [manageId, setManageId] = useState(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const m = params.get("manage");
    if (m) { setManageId(m); setPage("manage"); }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const r = await storageGet(STORAGE_KEY);
        if (r && r.value) { const d = { ...emptyData, ...JSON.parse(r.value) }; dataRef.current = d; setData(d); }
      } catch { /* first run */ }
      setLoaded(true);
    })();
    const unsub = storageSubscribe(STORAGE_KEY, (val) => {
      const incoming = typeof val === "string" ? JSON.parse(val) : val;
      if (incoming && incoming.__sig && incoming.__sig === lastSigRef.current) return;
      dataRef.current = { ...emptyData, ...incoming };
      setData(dataRef.current);
    });
    return unsub;
  }, []);

  const save = async (nextOrFn) => {
    const base = typeof nextOrFn === "function" ? nextOrFn(dataRef.current) : nextOrFn;
    const sig = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    lastSigRef.current = sig;
    const next = { ...base, __sig: sig };
    dataRef.current = next;
    setData(next);
    try { await storageSet(STORAGE_KEY, JSON.stringify(next)); } catch (e) { console.error(e); }
    return next;
  };

  const go = (p) => { setPage(p); window.scrollTo({ top: 0, behavior: "smooth" }); };

  const closedKeys = useMemo(() => new Set(data.closedSlots), [data.closedSlots]);
  /* an interviewer can only take one call per slot */
  const bookedPairs = useMemo(
    () => new Set(data.bookings.filter((b) => !b.cancelled).map((b) => `${b.date}|${b.time}|${b.interviewer}`)),
    [data.bookings]
  );
  const freeMembersFor = (d, t) =>
    (slotMapFor(d, data)[t] || []).filter((n) => !bookedPairs.has(`${d}|${t}|${n}`));
  /* slots the interviewee can pick on a day: offered by the team and with capacity left.
     Capacity = number of interviewers offering that time; fully-booked slots are
     removed from the list entirely. */
  const openSlotsFor = (d) => Object.keys(slotMapFor(d, data)).sort(slotSort)
    .map((t) => ({ t, left: freeMembersFor(d, t).length }))
    .filter((s) => s.left > 0);
  const dateOpen = (d) => !closedKeys.has(d) && openSlotsFor(d).length > 0;

  const confirmBooking = async ({ name, email, date, time }) => {
    /* assign among interviewers offering this exact slot who aren't booked yet:
       priority = whoever set their availability for this day first; tie → fewest calls */
    const setAt = data.availSetAt || {};
    const candidates = freeMembersFor(date, time);
    const load = (n) => data.bookings.filter((b) => !b.cancelled && b.interviewer === n).length;
    const interviewer = [...candidates].sort((a, b) => {
      const ta = setAt[`${a}|${date}`] ?? Infinity;
      const tb = setAt[`${b}|${date}`] ?? Infinity;
      if (ta !== tb) return ta - tb;      /* first to set availability gets the call */
      return load(a) - load(b);            /* tie: fewest upcoming calls */
    })[0];
    const booking = {
      id: `RF-${Date.now().toString(36).toUpperCase()}`,
      name, email, date, time, interviewer,
      teamsLink: linkFor(interviewer, data),
      createdAt: new Date().toISOString(), cancelled: false,
    };
    await save((prev) => ({ ...prev, bookings: [...prev.bookings, booking] }));
    setLastBooking(booking);
    go("confirm");
    setEmailStatus("pending");
    const r = await sendEmails(booking);
    setEmailStatus(r.sent ? "sent" : "manual");
  };

  /* ---- prospective consultant booking ---- */
  const bookCandidate = async (eventId, date, cohortId, form) => {
    const ev = eventById(data, eventId);
    const cohort = cohortTimes(ev).find((c) => c.id === cohortId);
    if (!ev || !cohort) return { ok: false, msg: "That interview is no longer available." };
    if (cohortClosed(ev, date, cohortId) || cohortRemaining(data, ev, date, cohortId) <= 0)
      return { ok: false, msg: "That time just filled up — please pick another slot." };
    /* double-booking guard: same email or Purdue ID already booked in this event */
    const email = form.email.trim().toLowerCase();
    const pid = form.purdueId.trim().toLowerCase();
    const dup = (dataRef.current.candidates || []).find((c) =>
      c.eventId === eventId && !c.cancelled &&
      (c.email.trim().toLowerCase() === email || (pid && c.purdueId.trim().toLowerCase() === pid)));
    if (dup) {
      const dupCohort = cohortTimes(ev).find((c) => c.id === dup.cohortId);
      return { ok: false, dup, msg: `You already have an interview booked for this event on ${prettyDate(dup.date)} at ${dupCohort ? dupCohort.start : ""}. Use your confirmation email's manage link to change it.` };
    }
    const cand = {
      id: `IV-${Date.now().toString(36).toUpperCase()}`,
      eventId, date, cohortId,
      name: form.name.trim(), email: form.email.trim(), purdueId: form.purdueId.trim(),
      phone: (form.phone || "").trim(),
      status: "Not Arrived", createdAt: new Date().toISOString(), cancelled: false,
    };
    await save((prev) => ({ ...prev, candidates: [...(prev.candidates || []), cand] }));
    setLastCandidate({ cand, ev, cohort, date });
    go("iv-confirm");
    setCandEmailStatus("pending");
    const r = await sendCandidateEmail(cand, ev, cohort, date);
    setCandEmailStatus(r.sent ? "sent" : "manual");
    return { ok: true };
  };

  const cancelCandidate = async (candId) =>
    save((prev) => ({ ...prev, candidates: (prev.candidates || []).map((c) => c.id === candId ? { ...c, cancelled: true } : c) }));

  const rescheduleCandidate = async (candId, newDate, newCohortId) => {
    const cand = (dataRef.current.candidates || []).find((c) => c.id === candId);
    if (!cand) return { ok: false, msg: "Booking not found." };
    const ev = eventById(dataRef.current, cand.eventId);
    if (!ev) return { ok: false, msg: "Interview event not found." };
    if (cohortClosed(ev, newDate, newCohortId) || cohortRemaining(dataRef.current, ev, newDate, newCohortId) <= 0)
      return { ok: false, msg: "That time just filled up — please pick another." };
    await save((prev) => ({ ...prev, candidates: (prev.candidates || []).map((c) => c.id === candId ? { ...c, date: newDate, cohortId: newCohortId, status: "Not Arrived" } : c) }));
    return { ok: true };
  };

  return (
    <div className="site" style={{ "--green": CONFIG.primaryGreen, "--greenDark": CONFIG.primaryGreenDark, "--tint": CONFIG.primaryGreenTint }}>
      <GlobalStyles />
      <Header page={page} go={go} />
      <main className="wrap">
        {!loaded ? (
          <p className="loading">Loading…</p>
        ) : page === "book" ? (
          <Book key="book" dateOpen={dateOpen} openSlotsFor={openSlotsFor} onConfirm={confirmBooking} goHome={() => go("home")} />
        ) : page === "confirm" ? (
          <Confirmation key="confirm" booking={lastBooking} go={go} emailStatus={emailStatus} />
        ) : page === "team" && !teamUser ? (
          <TeamLogin key="tl" onSuccess={(u) => setTeamUser(u)} />
        ) : page === "team" && teamUser ? (
          <Admin key="admin" data={data} save={save} closedKeys={closedKeys}
            user={teamUser} logout={() => { setTeamUser(null); go("home"); }} />
        ) : page === "interview" ? (
          <InterviewBooking key="ivbook" data={data} onBook={bookCandidate} go={go} />
        ) : page === "iv-confirm" ? (
          <CandidateConfirmation key="ivconf" info={lastCandidate} emailStatus={candEmailStatus} go={go} />
        ) : page === "manage" ? (
          <ManageBooking key="manage" data={data} manageId={manageId} onCancel={cancelCandidate} onReschedule={rescheduleCandidate}
            go={(p) => { window.history.replaceState({}, "", window.location.pathname); go(p); }} />
        ) : page === "iv-admin" && !ivAdmin ? (
          <InterviewAdminLogin key="ival" onSuccess={() => setIvAdmin(true)} />
        ) : page === "iv-admin" && ivAdmin ? (
          <InterviewAdmin key="ivadmin" data={data} save={save} logout={() => { setIvAdmin(false); go("home"); }} />
        ) : (
          <Landing key="landing" go={go} />
        )}
      </main>
      <Footer />
    </div>
  );
}

/* ---------------- Header ---------------- */
function Header({ page, go }) {
  const memberSide = page === "book" || page === "confirm" || page === "team";
  const ivSide = page === "interview" || page === "iv-confirm" || page === "iv-admin";
  return (
    <header className="hdr">
      <div className="hdr-in">
        <button className="brand" onClick={() => go("home")} aria-label="180 Degrees Consulting — home">
          <Logo h={48} />
        </button>
        <nav>
          {page !== "home" && (
            <button className="nav-lnk back" onClick={() => go("home")}>← Back to Home</button>
          )}
          {memberSide && (
            <button className={`nav-lnk sub${page === "team" ? " on" : ""}`} onClick={() => go("team")}>180 Team Login</button>
          )}
          {ivSide && (
            <button className={`nav-lnk sub${page === "iv-admin" ? " on" : ""}`} onClick={() => go("iv-admin")}>180DC Team Login</button>
          )}
        </nav>
      </div>
    </header>
  );
}

/* ---------------- Landing (two experiences) ---------------- */
function Landing({ go }) {
  return (
    <section className="page landing">
      <p className="eyebrow rise d1">180 Degrees Purdue Scheduling</p>
      <h1 className="landing-h rise d2">One place for member conversations<br/>and consultant interviews.</h1>
      <p className="lede rise d3" style={{ maxWidth: 620 }}>
        Choose the option that fits you. Current members schedule internal calls; prospective consultants
        invited to interview book their in-person session.
      </p>
      <div className="choice-grid rise d4">
        <button className="choice-card" onClick={() => go("interview")}>
          <span className="choice-tag">Prospective Consultants</span>
          <span className="choice-title">Schedule Your Interview</span>
          <span className="choice-desc">In-person 180DC Purdue consultant interview</span>
          <span className="choice-go">Interview Scheduling →</span>
        </button>
        <button className="choice-card alt" onClick={() => go("book")}>
          <span className="choice-tag">180DC Members</span>
          <span className="choice-title">Schedule a Member Call</span>
          <span className="choice-desc">Retention · Feedback · Check-ins · Internal conversations</span>
          <span className="choice-go">Member Scheduling →</span>
        </button>
      </div>
    </section>
  );
}

/* ---------------- Booking wizard (Back / Next) ---------------- */
function Book({ dateOpen, openSlotsFor, onConfirm, goHome }) {
  const dates = useMemo(bookableDates, []);
  const [step, setStep] = useState(1);
  const [dir, setDir] = useState(1); // 1 = forward, -1 = backward
  const [date, setDate] = useState(null);
  const [time, setTime] = useState(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");

  const next = () => { setError(""); setDir(1); setStep((s) => Math.min(3, s + 1)); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const back = () => { setError(""); setDir(-1); if (step === 1) { goHome(); } else { setStep((s) => s - 1); } window.scrollTo({ top: 0, behavior: "smooth" }); };
  const slideCls = dir === 1 ? "slide-fwd" : "slide-back";

  const submit = () => {
    if (!name.trim() || !email.trim()) return setError("Please enter your name and email to confirm.");
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError("Please enter a valid email address.");
    if (!openSlotsFor(date).some((s) => s.t === time)) {
      setStep(2); setTime(null);
      return setError("That time was just booked — please pick another slot.");
    }
    onConfirm({ name: name.trim(), email: email.trim(), date, time });
  };

  return (
    <section className="page">
      <h2 className="rise d1">Book Your Retention Feedback Call</h2>
      <div className="progress rise d2">
        {["Date", "Time", "Details"].map((l, i) => (
          <div key={l} className={`p-seg${step > i ? " done" : ""}`}>
            <div className="p-bar" /><span>{i + 1}. {l}</span>
          </div>
        ))}
      </div>

      {step === 1 && (
        <div className={slideCls} key="s1">
          <h3 className="step-h">Choose a date</h3>
          <div className="date-grid">
            {dates.map((d, i) => {
              const open = dateOpen(d);
              return (
                <button key={d} disabled={!open}
                  className={`date-card stagger${date === d ? " is-selected" : ""}`}
                  style={{ animationDelay: `${Math.min(i * 25, 400)}ms` }}
                  onClick={() => { setDate(d); if (time && !openSlotsFor(d).some((s) => s.t === time)) setTime(null); }}>
                  <span>{shortDay(d)}</span><b>{shortDate(d)}</b>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className={slideCls} key="s2">
          <h3 className="step-h">Pick a time <span className="muted">· {prettyDate(date)} · all times EST</span></h3>
          <p className="muted" style={{ marginTop: -6 }}>These are the times our team is available that day.</p>
          <div className="pill-grid">
            {openSlotsFor(date).map(({ t }, i) => (
              <button key={t}
                className={`pill stagger${time === t ? " is-selected" : ""}`}
                style={{ animationDelay: `${Math.min(i * 25, 300)}ms` }}
                onClick={() => setTime(t)}>
                {t}
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 3 && (
        <div className={slideCls} key="s3">
          <div className="card form-card">
            <h3 className="step-h" style={{ marginTop: 0 }}>Your details</h3>
            <div className="summary-chip">{prettyDate(date)} · <b>{time}</b></div>
            <Field label="Full name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Boiler Maker" autoComplete="name" />
            <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@purdue.edu" autoComplete="email" />
            {error && <p className="err">{error}</p>}
          </div>
        </div>
      )}

      {error && step !== 3 && <p className="err">{error}</p>}

      <div className="wizard-nav rise d3">
        <Btn kind="outline" onClick={back}>← Back</Btn>
        {step < 3 ? (
          <Btn onClick={next} disabled={step === 1 ? !date : !time}>Next →</Btn>
        ) : (
          <Btn onClick={submit}>Confirm Booking</Btn>
        )}
      </div>
    </section>
  );
}

/* ---------------- Confirmation ---------------- */
function Confirmation({ booking, go, emailStatus }) {
  if (!booking) return <Landing go={go} />;
  const teamsLink = booking.teamsLink || "";
  return (
    <section className="page confirm">
      <div className="check"><svg width="30" height="30" viewBox="0 0 24 24" fill="none">
        <path d="M5 13l4 4L19 7" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg></div>
      <h2 className="rise d2">Your call is booked!</h2>
      <p className="muted rise d2" style={{ marginTop: -8 }}>{CONFIG.siteName}</p>
      <div className="card detail-card rise d3">
        {[["Date", prettyDate(booking.date)], ["Time", booking.time], ["Interviewer", booking.interviewer], ["Confirmation ID", booking.id]].map(([k, v]) => (
          <div key={k} className="d-row"><span>{k}</span><b>{v}</b></div>
        ))}
      </div>

      {teamsLink && (
        <a className="teams-btn rise d4" href={teamsLink} target="_blank" rel="noreferrer">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 3.5V7l-4 3.5z"/></svg>
          Join Meeting
        </a>
      )}

      <p className="fine rise d4">
        {emailStatus === "sent" ? (
          <>A confirmation email with your meeting link has been sent to <b>{booking.email}</b> and your interviewer.</>
        ) : emailStatus === "pending" ? (
          <>Sending your confirmation email…</>
        ) : (
          <>Save your meeting link above. You can also send yourself the confirmation by email:</>
        )}
      </p>
      {emailStatus === "manual" && (
        <a className="rise d4" href={mailtoDraft(booking)} style={{ display: "inline-block", marginBottom: 18 }}>
          Open email draft →
        </a>
      )}

      <p className="fine rise d5" style={{ marginTop: 6 }}>
        Questions? Contact <a href={`mailto:${CONFIG.clubEmail}`}>{CONFIG.clubEmail}</a>
      </p>
      <div className="rise d5"><Btn kind="outline" onClick={() => go("home")}>← Back to Home</Btn></div>
    </section>
  );
}

/* ---------------- 180 Team Login (6 individual accounts) ---------------- */
function TeamLogin({ onSuccess }) {
  const [who, setWho] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const tryLogin = () => {
    const member = CONFIG.teamMembers.find((m) => m.name === who);
    if (!member) return setErr("Select your name first.");
    if (pw !== member.password) return setErr("Incorrect password.");
    onSuccess(member);
  };
  return (
    <section className="page" style={{ maxWidth: 380 }}>
      <h2 className="rise d1">180 Team Login</h2>
      <p className="muted rise d2">For 180 Degrees Purdue team members only.</p>
      <div className="rise d3" style={{ marginTop: 22 }}>
        <label className="field">
          <span>Your name</span>
          <select className="dropdown" style={{ width: "100%", marginBottom: 0 }} value={who}
            onChange={(e) => { setWho(e.target.value); setErr(""); }}>
            <option value="">Select your name…</option>
            {CONFIG.teamMembers.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
          </select>
        </label>
        <Field label="Password" type="password" value={pw} placeholder="••••••••"
          onChange={(e) => { setPw(e.target.value); setErr(""); }}
          onKeyDown={(e) => e.key === "Enter" && tryLogin()} />
        {err && <p className="err">{err}</p>}
        <Btn onClick={tryLogin}>Log in</Btn>
      </div>
    </section>
  );
}

/* ---------------- My Calls (logged-in member's own calls + link editor) ---------------- */
function MyCallsPanel({ data, save, user }) {
  const myLink = linkFor(user.name, data);
  const [draft, setDraft] = useState(myLink);
  const [savedMsg, setSavedMsg] = useState(false);
  const mine = data.bookings
    .filter((b) => !b.cancelled && b.interviewer === user.name)
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

  const saveLink = async () => {
    await save({ ...data, memberLinks: { ...(data.memberLinks || {}), [user.name]: draft.trim() } });
    setSavedMsg(true);
    setTimeout(() => setSavedMsg(false), 2500);
  };

  return (
    <div className="fadein" key="mycalls">
      <div className="card link-card">
        <p className="link-title">My meeting link</p>
        <p className="muted" style={{ margin: "0 0 10px" }}>
          Paste your permanent meeting link here (Teams, Zoom, or Google Meet all work). It's automatically shared with every interviewee assigned to you.
        </p>
        <div className="link-row">
          <input className="link-input" value={draft} placeholder="https://… (Teams / Zoom / Meet link)"
            onChange={(e) => setDraft(e.target.value)} />
          <Btn small onClick={saveLink} disabled={!draft.trim() || draft.trim() === myLink}>Save</Btn>
        </div>
        {savedMsg && <p className="saved-msg">✓ Link saved — it will be used for all your calls.</p>}
        {!myLink && !savedMsg && <p className="err" style={{ margin: "8px 0 0" }}>No link set yet — interviewees won't get a meeting link until you save one.</p>}
      </div>

      <h3 className="step-h" style={{ marginTop: 26 }}>Calls assigned to you</h3>
      {mine.length === 0 ? (
        <p className="muted fadein">No upcoming calls assigned to you yet.</p>
      ) : (
        <div className="fadein">
          {mine.map((b, i) => (
            <div key={b.id} className="card call-card stagger" style={{ animationDelay: `${i * 60}ms` }}>
              <div className="call-when">
                <b>{prettyDate(b.date)}</b>
                <span className="call-time">{b.time}</span>
              </div>
              <div className="call-who">
                <b>{b.name}</b>
                <a href={`mailto:${b.email}`}>{b.email}</a>
              </div>
              {myLink && (
                <a className="teams-btn small" href={myLink} target="_blank" rel="noreferrer">Join Meeting</a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- My Availability (days + multiple From/To windows per day, EST) ---------------- */
function MyAvailabilityPanel({ data, save, user }) {
  const dates = useMemo(bookableDates, []);
  const myAvail = availMapFor(user.name, data);
  const myDays = Object.keys(myAvail).filter((d) => dates.includes(d)).sort();
  const DEFAULT_WIN = `${10 * 60}|${16 * 60}`;

  const saveAvail = (next, stampDays = []) => {
    const stamps = { ...(data.availSetAt || {}) };
    stampDays.forEach((d) => {
      const k = `${user.name}|${d}`;
      if (!(k in stamps)) stamps[k] = Date.now();   /* first-set time is what counts */
    });
    return save({ ...data, memberAvail: { ...(data.memberAvail || {}), [user.name]: next }, availSetAt: stamps });
  };

  const toggle = async (d) => {
    const next = { ...myAvail };
    if (d in next) { delete next[d]; } else { next[d] = [DEFAULT_WIN]; }
    await saveAvail(next, d in next ? [d] : []);
  };
  const setAll = async (on) => {
    if (!on) return saveAvail({});
    const next = { ...myAvail };
    const added = [];
    dates.forEach((d) => { if (!(d in next)) { next[d] = [DEFAULT_WIN]; added.push(d); } });
    await saveAvail(next, added);
  };
  const setWin = (d, i, startMin, endMin) => {
    const wins = [...(myAvail[d] || [])];
    wins[i] = `${startMin}|${endMin}`;
    return saveAvail({ ...myAvail, [d]: wins });
  };
  const addWin = (d) => saveAvail({ ...myAvail, [d]: [...(myAvail[d] || []), DEFAULT_WIN] });
  const removeWin = (d, i) => {
    const wins = (myAvail[d] || []).filter((_, j) => j !== i);
    return saveAvail({ ...myAvail, [d]: wins });
  };

  return (
    <div className="fadein" key="myavail">
      <p className="muted" style={{ marginTop: 0 }}>
        Tap the days you're free, then set your time ranges for each day (EST) — add as many
        ranges per day as you need (e.g. 10 AM–12 PM and 3–5 PM). Interviewees can only pick
        30-minute slots inside these ranges; each booking is auto-assigned to an available
        interviewer with the fewest calls.
      </p>
      <div className="avail-row" style={{ marginBottom: 16 }}>
        <Btn kind="outline" small onClick={() => setAll(true)}>Mark all free</Btn>
        <Btn kind="outline" small onClick={() => setAll(false)}>Clear all</Btn>
      </div>
      <div className="date-grid">
        {dates.map((d, i) => {
          const on = d in myAvail;
          return (
            <button key={d} onClick={() => toggle(d)}
              className={`date-card stagger${on ? " is-selected" : ""}`}
              style={{ animationDelay: `${Math.min(i * 20, 300)}ms` }}>
              <span>{shortDay(d)}</span><b>{shortDate(d)}</b>
            </button>
          );
        })}
      </div>

      {myDays.length > 0 && (
        <>
          <h3 className="step-h" style={{ marginTop: 26 }}>Your time ranges for each day <span className="muted">· EST</span></h3>
          <div className="times-table">
            {myDays.map((d) => {
              const wins = myAvail[d] || [];
              const totalSlots = wins.reduce((n, w) => n + slotsInWindow(w).length, 0);
              return (
                <div key={d} className="times-row" style={{ alignItems: "flex-start" }}>
                  <div className="times-day" style={{ paddingTop: 8 }}>
                    <b>{shortDay(d)}</b>
                    <span>{shortDate(d)}</span>
                  </div>
                  <div className="win-stack">
                    {wins.map((w, i) => {
                      const p = parseWindow(w) || [10 * 60, 16 * 60];
                      return (
                        <div key={i} className="win-line">
                          <label className="win-label">From
                            <select className="win-select" value={p[0]}
                              onChange={(e) => setWin(d, i, Number(e.target.value), Math.max(Number(e.target.value) + 30, p[1]))}>
                              {TIME_CHOICES.slice(0, -1).map((m) => <option key={m} value={m}>{minsToLabel(m)}</option>)}
                            </select>
                          </label>
                          <label className="win-label">To
                            <select className="win-select" value={p[1]}
                              onChange={(e) => setWin(d, i, p[0], Number(e.target.value))}>
                              {TIME_CHOICES.filter((m) => m > p[0]).map((m) => <option key={m} value={m}>{minsToLabel(m)}</option>)}
                            </select>
                          </label>
                          {wins.length > 1 && (
                            <button className="win-remove" title="Remove this range" onClick={() => removeWin(d, i)}>×</button>
                          )}
                        </div>
                      );
                    })}
                    <button className="win-add" onClick={() => addWin(d)}>+ Add another range</button>
                  </div>
                  <span className="times-status set" style={{ paddingTop: 10 }}>{totalSlots} slot{totalSlots === 1 ? "" : "s"}</span>
                </div>
              );
            })}
          </div>
          <p className="muted">Interviewees will only be offered 30-minute slots inside these ranges.</p>
        </>
      )}
      <p className="muted">You're available on <b style={{ color: "var(--green)" }}>{myDays.length}</b> day{myDays.length === 1 ? "" : "s"}.</p>
    </div>
  );
}

/* ---------------- Admin ---------------- */
function Admin({ data, save, closedKeys, user, logout }) {
  const [tab, setTab] = useState("mycalls");
  const dates = useMemo(bookableDates, []);
  const [manageDate, setManageDate] = useState(dates[0]);
  const active = data.bookings.filter((b) => !b.cancelled);

  const cancelBooking = (id) => save({ ...data, bookings: data.bookings.map((b) => (b.id === id ? { ...b, cancelled: true } : b)) });
  const toggleDay = (d) =>
    save({ ...data, closedSlots: closedKeys.has(d) ? data.closedSlots.filter((k) => k !== d) : [...data.closedSlots, d] });

  return (
    <section className="page">
      <div className="admin-top rise d1">
        <div><h2 style={{ margin: 0 }}>180 Team Area</h2><p className="muted" style={{ margin: "2px 0 0" }}>Logged in as <b style={{ color: "var(--green)" }}>{user.name}</b>{user.role ? ` \u00b7 ${user.role}` : ""}</p></div>
        <Btn kind="outline" small onClick={logout}>Log out</Btn>
      </div>

      {!emailConfigured() && (
        <p className="notice rise d2">
          Automatic emails are off. Add your free EmailJS keys in the CONFIG at the top of the site code to
          email confirmations and meeting links to interviewees and interviewers automatically.
        </p>
      )}

      <div className="stats">
        {[["Upcoming calls", active.length], ["Cancelled", data.bookings.length - active.length], ["Blocked days", data.closedSlots.length]].map(([k, v], i) => (
          <div key={k} className="card stat stagger" style={{ animationDelay: `${i * 80}ms` }}><span>{k}</span><b>{v}</b></div>
        ))}
      </div>

      <div className="tabs rise d3">
        <button className={`tab${tab === "mycalls" ? " on" : ""}`} onClick={() => setTab("mycalls")}>My Calls</button>
        <button className={`tab${tab === "myavail" ? " on" : ""}`} onClick={() => setTab("myavail")}>My Availability</button>
        <button className={`tab${tab === "bookings" ? " on" : ""}`} onClick={() => setTab("bookings")}>All Bookings</button>
        <button className={`tab${tab === "availability" ? " on" : ""}`} onClick={() => setTab("availability")}>Block Days</button>
      </div>

      {tab === "mycalls" ? (
        <MyCallsPanel data={data} save={save} user={user} />
      ) : tab === "myavail" ? (
        <MyAvailabilityPanel data={data} save={save} user={user} />
      ) : tab === "bookings" ? (
        active.length === 0 ? (
          <p className="muted fadein" key="empty">No upcoming calls yet — bookings will appear here.</p>
        ) : (
          <div className="tbl-wrap fadein" key="tbl">
            <table>
              <thead><tr>{["Name", "Email", "Date", "Time", "Interviewer", ""].map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {[...active].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).map((b, i) => (
                  <tr key={b.id} className="stagger" style={{ animationDelay: `${Math.min(i * 40, 400)}ms` }}>
                    <td><b>{b.name}</b></td><td>{b.email}</td><td>{prettyDate(b.date)}</td><td>{b.time}</td><td>{b.interviewer}</td>
                    <td><Btn kind="danger" small onClick={() => cancelBooking(b.id)}>Cancel</Btn></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (
        <div className="fadein" key="avail">
          <p className="muted" style={{ marginTop: 0 }}>Tap a day to block or reopen it for interviewees. Blocked days can't be booked by anyone.</p>
          <div className="date-grid">
            {dates.map((d, i) => {
              const closed = closedKeys.has(d);
              return (
                <button key={d} onClick={() => toggleDay(d)}
                  className={`date-card stagger${closed ? " blockedday" : ""}`}
                  style={{ animationDelay: `${Math.min(i * 20, 300)}ms` }}>
                  <span>{shortDay(d)}</span><b>{shortDate(d)}</b>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

/* ---------------- Footer ---------------- */
function Footer() {
  return (
    <footer className="ftr">
      <div className="ftr-in">
        <Logo h={36} />
        <div className="ftr-txt">
          <b>180 Degrees Consulting Purdue</b>
          <span>{CONFIG.footerTagline}</span>
        </div>
        <div className="ftr-links">
          <a href={`mailto:${CONFIG.clubEmail}`}>{CONFIG.clubEmail}</a>
          <a href={CONFIG.instagram} target="_blank" rel="noreferrer">Instagram</a>
          <a href={CONFIG.linkedin} target="_blank" rel="noreferrer">LinkedIn</a>
        </div>
      </div>
    </footer>
  );
}

/* ================================================================
   PROSPECTIVE-CONSULTANT COMPONENTS
   ================================================================ */

/* ---- Candidate booking wizard: 1 Details → 2 Select Interview → 3 Confirm ---- */
function InterviewBooking({ data, onBook, go }) {
  const events = (data.interviewEvents || []).filter((e) => openDates(data, e).length > 0);
  /* pick which event to book into: if multiple open events, let them choose; usually one */
  const [eventId, setEventId] = useState(events[0]?.id || null);
  const ev = eventId ? eventById(data, eventId) : events[0] || null;

  const [step, setStep] = useState(1);          // 1 Details · 2 Date · 3 Time · 4 Confirm
  const [dir, setDir] = useState(1);
  const [form, setForm] = useState({ name: "", email: "", purdueId: "", phone: "" });
  const [date, setDate] = useState(null);
  const [cohortId, setCohortId] = useState(null);
  const [error, setError] = useState("");
  const slideCls = dir === 1 ? "slide-fwd" : "slide-back";
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const dates = ev ? openDates(data, ev) : [];
  const cohort = ev && cohortId ? cohortTimes(ev).find((c) => c.id === cohortId) : null;
  const puidValid = /^\d{10}$/.test(form.purdueId.trim());
  const detailsValid = form.name.trim() && /^\S+@\S+\.\S+$/.test(form.email) && puidValid;

  const existingBooking = () => {
    const email = form.email.trim().toLowerCase();
    const pid = form.purdueId.trim().toLowerCase();
    return (data.candidates || []).find((c) => c.eventId === ev.id && !c.cancelled &&
      (c.email.trim().toLowerCase() === email || (pid && c.purdueId.trim().toLowerCase() === pid)));
  };
  const next = () => {
    setError("");
    if (step === 1) {
      const dup = existingBooking();
      if (dup) {
        const dc = cohortTimes(ev).find((c) => c.id === dup.cohortId);
        return setError(`You already have an interview booked on ${prettyDate(dup.date)} at ${dc ? dc.start : ""}. Check your confirmation email to change it.`);
      }
    }
    setDir(1); setStep((s) => Math.min(4, s + 1)); window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const back = () => { setError(""); setDir(-1); if (step === 1) { go("home"); } else { setStep((s) => s - 1); } window.scrollTo({ top: 0, behavior: "smooth" }); };

  const submit = async () => {
    if (!ev || !date || !cohortId) return setError("Please choose a date and time.");
    const r = await onBook(ev.id, date, cohortId, form);
    if (!r.ok) { setError(r.msg); setStep(r.dup ? 1 : 3); if (!r.dup) setCohortId(null); }
  };

  if (!ev || events.length === 0) {
    return (
      <section className="page">
        <h2 className="rise d1">Schedule Your 180DC Purdue Interview</h2>
        <div className="empty-state rise d2">
          <p>There are no interview times open right now.</p>
          <p className="muted">If you've been invited to interview and don't see any times, please contact <a href={`mailto:${CONFIG.clubEmail}`}>{CONFIG.clubEmail}</a>.</p>
        </div>
        <div className="rise d3"><Btn kind="outline" onClick={() => go("home")}>← Back to Home</Btn></div>
      </section>
    );
  }

  const loc = ev.location || {};
  const locStr = [loc.building, loc.room && `Room ${loc.room}`].filter(Boolean).join(" · ") || "Location TBA";

  return (
    <section className="page">
      <h2 className="rise d1">Schedule Your 180DC Purdue Interview</h2>
      <div className="progress rise d2">
        {["Details", "Date", "Time", "Confirm"].map((l, i) => (
          <div key={l} className={`p-seg${step > i ? " done" : ""}`}>
            <div className="p-bar" /><span>{i + 1}. {l}</span>
          </div>
        ))}
      </div>

      {events.length > 1 && step === 1 && (
        <div className="event-pick rise d2">
          <span className="muted">Interviewing for:</span>
          <select className="dropdown" value={eventId} onChange={(e) => { setEventId(e.target.value); setDate(null); setCohortId(null); }}>
            {events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>
      )}

      {step === 1 && (
        <div className={slideCls} key="s1">
          <div className="card form-card">
            <h3 className="step-h" style={{ marginTop: 0 }}>Your details</h3>
            <p className="muted" style={{ marginTop: -6, marginBottom: 16 }}>Just the essentials — we already have your application on file.</p>
            <Field label="Full name" value={form.name} onChange={set("name")} placeholder="Boiler Maker" autoComplete="name" />
            <Field label="Purdue email" type="email" value={form.email} onChange={set("email")} placeholder="you@purdue.edu" autoComplete="email" />
            <Field label="Purdue ID (10 digits)" value={form.purdueId}
              onChange={(e) => setForm({ ...form, purdueId: e.target.value.replace(/\D/g, "").slice(0, 10) })}
              inputMode="numeric" placeholder="0012345678" />
            {form.purdueId && !puidValid && <p className="err" style={{ marginTop: -8 }}>Purdue ID must be exactly 10 digits.</p>}
            <Field label="Phone (optional)" value={form.phone} onChange={set("phone")} placeholder="(765) 555-0123" />
            {error && <p className="err">{error}</p>}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className={slideCls} key="s2">
          <h3 className="step-h">Choose a date <span className="muted">· {locStr}</span></h3>
          <div className="date-grid">
            {dates.map((d, i) => (
              <button key={d} className={`date-card stagger${date === d ? " is-selected" : ""}`}
                style={{ animationDelay: `${Math.min(i * 25, 400)}ms` }}
                onClick={() => { setDate(d); setCohortId(null); }}>
                <span>{shortDay(d)}</span><b>{shortDate(d)}</b>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 3 && date && (
        <div className={slideCls} key="s3">
          <h3 className="step-h">Pick a time <span className="muted">· {prettyDate(date)}</span></h3>
          <p className="muted" style={{ marginTop: -6 }}>Each session is ~65 minutes: 15-min behavioral, 5-min transition, 45-min case.</p>
          <div className="time-box-grid">
            {openCohortsOn(data, ev, date).map((c, i) => {
              const left = cohortRemaining(data, ev, date, c.id);
              return (
                <button key={c.id}
                  className={`time-box stagger${cohortId === c.id ? " is-selected" : ""}`}
                  style={{ animationDelay: `${Math.min(i * 25, 300)}ms` }}
                  onClick={() => setCohortId(c.id)}>
                  <b>{c.start}</b>
                  <span>{left === 1 ? "1 spot left" : `${left} spots left`}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {step === 4 && cohort && (
        <div className={slideCls} key="s4">
          <div className="card form-card">
            <h3 className="step-h" style={{ marginTop: 0 }}>Confirm your interview</h3>
            <div className="confirm-review">
              <div className="d-row"><span>Name</span><b>{form.name}</b></div>
              <div className="d-row"><span>Date</span><b>{prettyDate(date)}</b></div>
              <div className="d-row"><span>Arrival time</span><b>{cohort.start}</b></div>
              <div className="d-row"><span>Interview start</span><b>{cohort.start}</b></div>
              <div className="d-row"><span>Location</span><b>{[loc.building, loc.room && `Room ${loc.room}`].filter(Boolean).join(", ") || "TBA"}</b></div>
              <div className="d-row"><span>Format</span><b>15-min behavioral · 5-min transition · 45-min case</b></div>
            </div>
            <p className="arrival-warn" style={{ marginTop: 14 }}>{ev.arrivalInstruction || CONFIG.arrivalInstruction}</p>
            {error && <p className="err">{error}</p>}
          </div>
        </div>
      )}

      {error && step !== 1 && step !== 4 && <p className="err">{error}</p>}

      <div className="wizard-nav rise d3">
        <Btn kind="outline" onClick={back}>← Back</Btn>
        {step === 1 ? (
          <Btn onClick={next} disabled={!detailsValid}>Next →</Btn>
        ) : step === 2 ? (
          <Btn onClick={next} disabled={!date}>Next →</Btn>
        ) : step === 3 ? (
          <Btn onClick={next} disabled={!cohortId}>Next →</Btn>
        ) : (
          <Btn onClick={submit}>Confirm Interview</Btn>
        )}
      </div>
    </section>
  );
}


/* ---- Candidate self-service: cancel or reschedule via ?manage=ID link ---- */
function ManageBooking({ data, manageId, onCancel, onReschedule, go }) {
  const cand = (data.candidates || []).find((c) => c.id === manageId);
  const [mode, setMode] = useState("view");    // view · reschedule · cancelled · done
  const [newDate, setNewDate] = useState(null);
  const [newCohort, setNewCohort] = useState(null);
  const [msg, setMsg] = useState("");

  if (!cand) {
    return (
      <section className="page narrow">
        <h2 className="rise d1">Manage your interview</h2>
        <div className="empty-state rise d2"><p>We couldn't find that booking.</p>
          <p className="muted">It may have been cancelled already. Questions? <a href={`mailto:${CONFIG.clubEmail}`}>{CONFIG.clubEmail}</a></p></div>
        <div className="rise d3"><Btn kind="outline" onClick={() => go("home")}>← Back to Home</Btn></div>
      </section>
    );
  }

  const ev = eventById(data, cand.eventId);
  const cohort = ev ? cohortTimes(ev).find((c) => c.id === cand.cohortId) : null;
  const loc = ev?.location || {};

  if (cand.cancelled || mode === "cancelled") {
    return (
      <section className="page narrow confirm">
        <div className="check gray"><svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="#fff" strokeWidth="3" strokeLinecap="round" /></svg></div>
        <h2 className="rise d2">Interview cancelled</h2>
        <p className="muted rise d2">Your interview has been cancelled and the slot reopened. If this was a mistake, you can book again.</p>
        <div className="rise d3" style={{ marginTop: 12 }}><Btn onClick={() => go("interview")}>Book a new time →</Btn></div>
      </section>
    );
  }

  const doCancel = async () => { await onCancel(cand.id); setMode("cancelled"); };
  const doReschedule = async () => {
    if (!newDate || !newCohort) return setMsg("Pick a new date and time.");
    const r = await onReschedule(cand.id, newDate, newCohort);
    if (!r.ok) return setMsg(r.msg);
    setMode("done");
  };

  if (mode === "done") {
    const nc = cohortTimes(ev).find((c) => c.id === newCohort);
    return (
      <section className="page narrow confirm">
        <div className="check"><svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg></div>
        <h2 className="rise d2">Interview rescheduled</h2>
        <p className="muted rise d2">You're now booked for <b>{prettyDate(newDate)}</b> at <b>{nc?.start}</b>.</p>
        <div className="rise d3" style={{ marginTop: 12 }}><Btn kind="outline" onClick={() => go("home")}>← Back to Home</Btn></div>
      </section>
    );
  }

  return (
    <section className="page narrow">
      <h2 className="rise d1">Manage your interview</h2>
      <div className="card detail-card rise d2" style={{ marginTop: 12 }}>
        <div className="d-row"><span>Name</span><b>{cand.name}</b></div>
        <div className="d-row"><span>Date</span><b>{prettyDate(cand.date)}</b></div>
        <div className="d-row"><span>Time</span><b>{cohort?.start}</b></div>
        <div className="d-row"><span>Location</span><b>{[loc.building, loc.room && `Room ${loc.room}`].filter(Boolean).join(", ") || "TBA"}</b></div>
        <div className="d-row"><span>Confirmation</span><b>{cand.id}</b></div>
      </div>

      {mode === "view" && (
        <div className="rise d3 manage-actions">
          <Btn onClick={() => { setMode("reschedule"); setNewDate(cand.date); }}>Reschedule</Btn>
          <Btn kind="danger" onClick={doCancel}>Cancel interview</Btn>
          <Btn kind="outline" onClick={() => go("home")}>Back to Home</Btn>
        </div>
      )}

      {mode === "reschedule" && (
        <div className="rise d3" style={{ marginTop: 18 }}>
          <h3 className="step-h">Pick a new date</h3>
          <div className="date-grid">
            {openDates(data, ev).map((d) => (
              <button key={d} className={`date-card${newDate === d ? " is-selected" : ""}`}
                onClick={() => { setNewDate(d); setNewCohort(null); }}>
                <span>{shortDay(d)}</span><b>{shortDate(d)}</b>
              </button>
            ))}
          </div>
          {newDate && (
            <>
              <h3 className="step-h" style={{ marginTop: 20 }}>Pick a new time</h3>
              <div className="time-box-grid">
                {openCohortsOn(data, ev, newDate).map((c) => {
                  const left = cohortRemaining(data, ev, newDate, c.id);
                  return (
                    <button key={c.id} className={`time-box${newCohort === c.id ? " is-selected" : ""}`} onClick={() => setNewCohort(c.id)}>
                      <b>{c.start}</b><span>{left === 1 ? "1 spot left" : `${left} spots left`}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
          {msg && <p className="err">{msg}</p>}
          <div className="manage-actions" style={{ marginTop: 18 }}>
            <Btn onClick={doReschedule} disabled={!newDate || !newCohort}>Confirm new time</Btn>
            <Btn kind="outline" onClick={() => { setMode("view"); setMsg(""); }}>Back</Btn>
          </div>
        </div>
      )}
    </section>
  );
}

function CandidateConfirmation({ info, emailStatus, go }) {
  if (!info) return <Landing go={go} />;
  const { cand, ev, cohort, date } = info;
  const loc = ev.location || {};
  const endTime = addMin(cohort.start, cohortDuration(ev));
  const evDate = date || cand.date;
  return (
    <section className="page confirm">
      <div className="check"><svg width="30" height="30" viewBox="0 0 24 24" fill="none">
        <path d="M5 13l4 4L19 7" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg></div>
      <h2 className="rise d2">You're booked, {(cand.name || "").split(" ")[0]}!</h2>
      <p className="muted rise d2" style={{ marginTop: -8 }}>Your 180 Degrees Consulting Purdue interview is scheduled.</p>

      <div className="card detail-card rise d3">
        <div className="d-row"><span>Candidate</span><b>{cand.name}</b></div>
        <div className="d-row"><span>Date</span><b>{prettyDate(evDate)}</b></div>
        <div className="d-row"><span>Arrival time</span><b>{cohort.start}</b></div>
        <div className="d-row"><span>Interview start</span><b>{cohort.start}</b></div>
        <div className="d-row"><span>Approx. end</span><b>{endTime}</b></div>
        <div className="d-row"><span>Location</span><b>{[loc.building, loc.room && `Room ${loc.room}`, loc.address].filter(Boolean).join(", ") || "TBA"}</b></div>
        <div className="d-row"><span>Confirmation #</span><b>{cand.id}</b></div>
      </div>

      <div className="format-card rise d4">
        <div className="fmt-step"><b>15 min</b><span>Behavioral Interview</span></div>
        <div className="fmt-arrow">→</div>
        <div className="fmt-step"><b>5 min</b><span>Transition</span></div>
        <div className="fmt-arrow">→</div>
        <div className="fmt-step"><b>45 min</b><span>Case Interview</span></div>
      </div>

      <p className="arrival-warn rise d4">{ev.arrivalInstruction || CONFIG.arrivalInstruction}</p>

      <p className="fine rise d5">
        {emailStatus === "sent" ? (
          <>A confirmation email has been sent to <b>{cand.email}</b>.</>
        ) : emailStatus === "pending" ? (
          <>Sending your confirmation email…</>
        ) : (
          <>Please save these details. Questions? Contact <a href={`mailto:${CONFIG.clubEmail}`}>{CONFIG.clubEmail}</a>.</>
        )}
      </p>
      <div className="rise d5"><Btn kind="outline" onClick={() => go("home")}>← Back to Home</Btn></div>
    </section>
  );
}

/* ---- Interview admin login ---- */
function InterviewAdminLogin({ onSuccess }) {
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [error, setError] = useState("");
  const submit = () => {
    if (u.trim() === CONFIG.interviewAdmin.username && p === CONFIG.interviewAdmin.password) onSuccess();
    else setError("Incorrect username or password.");
  };
  return (
    <section className="page narrow">
      <h2 className="rise d1">180DC Team Login</h2>
      <p className="muted rise d2" style={{ marginTop: -8 }}>Interview administration — team access only.</p>
      <div className="card form-card rise d2">
        <Field label="Username" value={u} onChange={(e) => setU(e.target.value)} placeholder="180DC" />
        <Field label="Password" type="password" value={p} onChange={(e) => setP(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="••••••" />
        {error && <p className="err">{error}</p>}
        <Btn onClick={submit} style={{ marginTop: 6 }}>Log in</Btn>
      </div>
      <p className="fine rise d3">Demo credentials only — change the password before launch.</p>
    </section>
  );
}

/* ================================================================
   INTERVIEW ADMIN DASHBOARD
   ================================================================ */
function InterviewAdmin({ data, save, logout }) {
  const [tab, setTab] = useState("dashboard");
  const events = data.interviewEvents || [];
  const [activeEventId, setActiveEventId] = useState(null);
  const activeEvent = events.find((e) => e.id === activeEventId) || events[0] || null;
  useEffect(() => {
    if ((!activeEventId || !events.some((e) => e.id === activeEventId)) && events[0]) setActiveEventId(events[0].id);
  }, [events, activeEventId]);

  /* which interview date within the event we're viewing */
  const [activeDate, setActiveDate] = useState(null);
  const dates = activeEvent ? eventDates(activeEvent) : [];
  useEffect(() => {
    if (activeEvent && (!activeDate || !dates.includes(activeDate))) setActiveDate(dates[0] || null);
  }, [activeEventId, activeEvent, dates.join(",")]);

  const tabs = [
    ["dashboard", "Dashboard"], ["events", "Interview Events"],
    ["candidates", "Candidates"], ["dayof", "Interview Day"],
    ["interviewers", "Interviewers"], ["settings", "Settings"],
  ];
  const dateTabs = ["dashboard", "dayof", "interviewers", "settings"].includes(tab) && dates.length > 0;

  return (
    <section className="page">
      <div className="admin-top rise d1">
        <div><h2 style={{ margin: 0 }}>Interview Administration</h2>
          <p className="muted" style={{ margin: "2px 0 0" }}>Prospective consultant interviews</p></div>
        <Btn kind="outline" small onClick={logout}>Log out</Btn>
      </div>

      {!CONFIG.emailJs.templateIdCandidate && (
        <p className="notice rise d2">Candidate confirmation emails are off. Add <b>templateIdCandidate</b> in CONFIG to enable them.</p>
      )}

      {events.length > 1 && (
        <div className="event-switch rise d2">
          <span className="muted">Event:</span>
          <select className="dropdown" value={activeEventId || ""} onChange={(e) => setActiveEventId(e.target.value)}>
            {events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>
      )}

      <div className="tabs rise d3">
        {tabs.map(([k, l]) => (
          <button key={k} className={`tab${tab === k ? " on" : ""}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {dateTabs && (
        <div className="date-tabs">
          <span className="date-tabs-label">Interview date:</span>
          {dates.map((d) => (
            <button key={d} className={`date-tab${activeDate === d ? " on" : ""}`} onClick={() => setActiveDate(d)}>
              {shortDay(d)} {shortDate(d)}
            </button>
          ))}
        </div>
      )}

      {tab === "dashboard" && <IADashboard data={data} save={save} ev={activeEvent} date={activeDate} />}
      {tab === "events" && <IAEvents data={data} save={save} activeEventId={activeEventId} setActiveEventId={setActiveEventId} />}
      {tab === "candidates" && <IACandidates data={data} save={save} ev={activeEvent} />}
      {tab === "dayof" && <IADayOf data={data} save={save} ev={activeEvent} date={activeDate} />}
      {tab === "interviewers" && <IAInterviewers data={data} save={save} ev={activeEvent} date={activeDate} />}
      {tab === "settings" && <IASettings data={data} save={save} ev={activeEvent} date={activeDate} />}
    </section>
  );
}

/* ---- Dashboard: summary + cohort capacity for the selected date ---- */
function IADashboard({ data, save, ev, date }) {
  /* live ticking clock so timers + "now" update every second */
  const [, force] = useState(0);
  useEffect(() => { const t = setInterval(() => force((n) => n + 1), 1000); return () => clearInterval(t); }, []);

  if (!ev) return <EmptyEvents />;
  if (!date) return <div className="empty-state fadein"><p>This event has no interview dates yet.</p><p className="muted">Add dates in <b>Settings</b>.</p></div>;

  const cohorts = cohortTimes(ev);
  const dur = cohortDuration(ev); // 65 min planned
  const totalCap = cohorts.reduce((n, c) => n + cohortCapacity(ev, date, c.id), 0);
  const dayCandidates = cohorts.flatMap((c) => candidatesInCohort(data, ev.id, date, c.id));
  const scheduled = dayCandidates.length;
  const doneCount = dayCandidates.filter((c) => c.status === "Completed").length;

  /* per-candidate progress: which of the 3 stages they've reached */
  const stageIndex = (status) => {
    if (status === "Completed") return 3;
    if (status === "Case Interview") return 2;
    if (status === "Waiting") return 2;         // between behavioral and case
    if (status === "Behavioral" || status === "Checked In") return 1;
    if (status === "No Show") return -1;
    return 0;                                    // Not Arrived
  };

  /* timers live in data.interviewTimers["<eventId>|<date>|<cohortId>"] = startMs */
  const timerKey = (cid) => `${ev.id}|${date}|${cid}`;
  const timers = data.interviewTimers || {};
  const startTimer = (cid) => save((prev) => ({ ...prev, interviewTimers: { ...(prev.interviewTimers || {}), [timerKey(cid)]: Date.now() } }));
  const resetTimer = (cid) => save((prev) => { const t = { ...(prev.interviewTimers || {}) }; delete t[timerKey(cid)]; return { ...prev, interviewTimers: t }; });

  const now = Date.now();
  const fmtElapsed = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

  /* ----- NIGHT STATUS: wall clock vs scheduled cohort times -----
     For each cohort with candidates, its last candidate should be DONE by
     (cohortStart + 65 min). If a cohort isn't fully complete and that time
     has passed, we're behind by (now - expectedEnd). We report the largest
     such lag across cohorts, and also flag if a cohort should have STARTED. */
  const nowD = new Date();
  const isToday = date === nowD.toISOString().slice(0, 10);
  const nowMinOfDay = nowD.getHours() * 60 + nowD.getMinutes();
  let behindMin = 0, nextCohort = null, statusNote = "";
  if (isToday) {
    cohorts.forEach((c) => {
      const list = candidatesInCohort(data, ev.id, date, c.id);
      if (list.length === 0) return;
      const allDone = list.every((x) => x.status === "Completed" || x.status === "No Show");
      const expectedEnd = c.startMin + dur;
      if (!allDone && nowMinOfDay > expectedEnd) behindMin = Math.max(behindMin, nowMinOfDay - expectedEnd);
      /* next cohort that hasn't started / completed */
      if (!allDone && !nextCohort && nowMinOfDay < c.startMin + 5) nextCohort = c;
    });
  }
  const dayHasCands = dayCandidates.length > 0;
  let nightStatus = null;
  if (isToday && dayHasCands) {
    if (doneCount === scheduled) nightStatus = { cls: "ontime", big: "All interviews complete", sub: "Great work tonight." };
    else if (behindMin >= 15) nightStatus = { cls: "behind", big: `Running ${behindMin} min behind`, sub: "A cohort is past its planned end time." };
    else if (behindMin >= 3) nightStatus = { cls: "slight", big: `Running ${behindMin} min behind`, sub: "Slightly over — keep an eye on the clock." };
    else nightStatus = { cls: "ontime", big: "On schedule", sub: nextCohort ? `Next up: ${nextCohort.start} cohort` : "Interviews in progress." };
  }

  return (
    <div className="fadein">
      {nightStatus && (
        <div className={`night-status ${nightStatus.cls}`}>
          <div className="ns-pulse" />
          <div className="ns-text"><b>{nightStatus.big}</b><span>{nightStatus.sub}</span></div>
          <div className="ns-clock">{nowD.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</div>
        </div>
      )}
      <div className="day-banner">
        <div>
          <span className="day-banner-date">{prettyDate(date)}</span>
          <span className="muted"> · {(ev.location?.building || "")}{ev.location?.room ? ` ${ev.location.room}` : ""}</span>
        </div>
        <div className="day-summary">
          <span><b>{scheduled}</b> booked</span>
          <span><b>{doneCount}</b> completed</span>
          <span><b>{totalCap - scheduled}</b> open</span>
        </div>
      </div>

      <div className="cohort-cards">
        {cohorts.map((c) => {
          const list = candidatesInCohort(data, ev.id, date, c.id);
          const cap = cohortCapacity(ev, date, c.id);
          const closed = cohortClosed(ev, date, c.id);
          const cohortDone = list.filter((x) => x.status === "Completed").length;
          const cohortPct = list.length ? Math.round((cohortDone / list.length) * 100) : 0;

          const startMs = timers[timerKey(c.id)];
          const running = !!startMs;
          const elapsedMs = running ? now - startMs : 0;
          const overtime = running && elapsedMs > dur * 60 * 1000;
          const nearEnd = running && !overtime && elapsedMs > (dur - 10) * 60 * 1000;

          return (
            <div key={c.id} className={`card cohort-card${closed ? " closed" : ""}${running ? " live" : ""}${overtime ? " overtime" : ""}`}>
              <div className="cc-head">
                <b>{c.start}</b>
                {running
                  ? <span className={`badge ${overtime ? "over-badge" : "live-badge"}`}>{overtime ? "● OVERTIME" : "● Running"}</span>
                  : <span className="muted cc-plan">{cohortDone}/{list.length || cap} done</span>}
              </div>
              <div className="cc-window">Planned {c.start} – {minToClock(c.startMin + dur)}
                {isToday && list.length > 0 && !list.every((x) => x.status === "Completed" || x.status === "No Show") && nowMinOfDay > c.startMin + dur
                  && <span className="cc-late"> · {nowMinOfDay - (c.startMin + dur)} min over</span>}
              </div>

              {/* cohort timer */}
              <div className="timer-row">
                <div className={`timer-clock${overtime ? " over" : nearEnd ? " near" : ""}`}>
                  {running ? fmtElapsed(elapsedMs) : "0:00"} <span className="timer-plan">/ {dur}:00</span>
                </div>
                {running
                  ? <button className="timer-btn reset" onClick={() => resetTimer(c.id)}>Reset</button>
                  : <button className="timer-btn start" onClick={() => startTimer(c.id)}>▶ Start</button>}
              </div>
              {overtime && <div className="over-alert">Over planned time by {fmtElapsed(elapsedMs - dur * 60 * 1000)}</div>}

              {/* cohort progress */}
              <div className="cc-bar"><i style={{ width: `${cohortPct}%` }} /></div>
              <div className="cc-count">{list.length} / {cap} candidates · {cohortDone} completed</div>

              {/* per-candidate mini progress */}
              <div className="cc-list">
                {list.length === 0 ? <span className="muted">No candidates yet</span> :
                  list.map((cd) => {
                    const si = stageIndex(cd.status);
                    return (
                      <div key={cd.id} className="cand-prog">
                        <span className="cand-name">{cd.name}</span>
                        {si === -1
                          ? <span className="cand-noshow">No show</span>
                          : <span className="stage-dots">
                              {["Behavioral", "Transition", "Case"].map((lbl, i) => (
                                <span key={lbl} className={`stg${si > i ? " fill" : ""}${si === i + 1 ? " active" : ""}`} title={lbl} />
                              ))}
                              {si === 3 && <span className="stg-done">✓</span>}
                            </span>}
                      </div>
                    );
                  })}
              </div>
            </div>
          );
        })}
      </div>
      <p className="fine" style={{ marginTop: 16 }}>Start a cohort's timer when its interviews begin — it alerts if you pass {dur} minutes. Update each candidate's status in the <b>Interview Day</b> tab; progress here reflects it live.</p>
    </div>
  );
}

/* ---- Events: create event (settings + first dates), reuse all semester ---- */
function IAEvents({ data, save, activeEventId, setActiveEventId }) {
  const d = CONFIG.interviewDefaults;
  const [f, setF] = useState({
    name: "", building: "", room: "", address: "",
    startTime: d.startTime, endTime: d.endTime,
    behavioralMin: d.behavioralMin, bufferMin: d.bufferMin, caseMin: d.caseMin,
    candidatesPerCohort: d.candidatesPerCohort, cohortIntervalMin: d.cohortIntervalMin,
  });
  const [dates, setDates] = useState([]);
  const [dateInput, setDateInput] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const events = data.interviewEvents || [];
  const addDate = () => { if (dateInput && !dates.includes(dateInput)) { setDates([...dates, dateInput].sort()); setDateInput(""); } };
  const rmDate = (d) => setDates(dates.filter((x) => x !== d));
  const [confirmDel, setConfirmDel] = useState(null);

  const preview = useMemo(() => {
    try { return cohortTimes({ ...f, behavioralMin: +f.behavioralMin, bufferMin: +f.bufferMin, caseMin: +f.caseMin, cohortIntervalMin: +f.cohortIntervalMin }); }
    catch { return []; }
  }, [f]);

  const create = async () => {
    if (!f.name.trim()) return;
    const ev = {
      id: `EV-${Date.now().toString(36).toUpperCase()}`,
      name: f.name.trim(),
      dates: [...dates].sort(),
      location: { building: f.building.trim(), room: f.room.trim(), address: f.address.trim(), notes: "" },
      startTime: f.startTime, endTime: f.endTime,
      behavioralMin: +f.behavioralMin, bufferMin: +f.bufferMin, caseMin: +f.caseMin,
      candidatesPerCohort: +f.candidatesPerCohort, cohortIntervalMin: +f.cohortIntervalMin,
      cohortMeta: {}, arrivalInstruction: CONFIG.arrivalInstruction,
    };
    await save((prev) => ({ ...prev, interviewEvents: [...(prev.interviewEvents || []), ev] }));
    setActiveEventId(ev.id);
    setF({ ...f, name: "" }); setDates([]);
  };

  const removeEvent = async (id) =>
    save((prev) => ({ ...prev, interviewEvents: (prev.interviewEvents || []).filter((e) => e.id !== id),
      candidates: (prev.candidates || []).filter((c) => c.eventId !== id) }));

  return (
    <div className="fadein">
      <div className="card form-card" style={{ maxWidth: 720 }}>
        <h3 className="step-h" style={{ marginTop: 0 }}>Create an interview event</h3>
        <p className="muted" style={{ marginTop: -6, marginBottom: 16 }}>Set the location, format, and time window once. You then add as many interview <b>dates</b> as you want to this event — no need to re-enter anything. Reuse it all semester.</p>
        <Field label="Event name" value={f.name} onChange={set("name")} placeholder="Fall 2026 Consultant Interviews" />
        <label className="field"><span>Interview dates — add one or more</span>
          <div className="date-add-row">
            <input type="date" className="date-add-input" value={dateInput} onChange={(e) => setDateInput(e.target.value)} />
            <Btn small type="button" onClick={addDate} disabled={!dateInput}>+ Add date</Btn>
          </div>
        </label>
        <div className="date-chip-row" style={{ marginBottom: 14 }}>
          {dates.length === 0 ? <span className="muted">No dates added yet — you can also add them later in Settings.</span> :
            dates.map((d) => <span key={d} className="date-chip">{prettyDate(d)}<button type="button" onClick={() => rmDate(d)} title="Remove">×</button></span>)}
        </div>
        <div className="field-row">
          <Field label="Building" value={f.building} onChange={set("building")} placeholder="Rawls Hall" />
          <Field label="Room" value={f.room} onChange={set("room")} placeholder="3082" />
        </div>
        <Field label="Address / notes (optional)" value={f.address} onChange={set("address")} placeholder="610 Purdue Mall, West Lafayette" />
        <div className="field-row-3">
          <Field label="Start time" type="time" value={f.startTime} onChange={set("startTime")} />
          <Field label="End time" type="time" value={f.endTime} onChange={set("endTime")} />
          <Field label="Candidates / cohort" type="number" min="1" value={f.candidatesPerCohort} onChange={set("candidatesPerCohort")} />
        </div>
        <div className="field-row-4">
          <Field label="Behavioral (min)" type="number" min="1" value={f.behavioralMin} onChange={set("behavioralMin")} />
          <Field label="Buffer (min)" type="number" min="0" value={f.bufferMin} onChange={set("bufferMin")} />
          <Field label="Case (min)" type="number" min="1" value={f.caseMin} onChange={set("caseMin")} />
          <Field label="Cohort interval (min)" type="number" min="1" value={f.cohortIntervalMin} onChange={set("cohortIntervalMin")} />
        </div>
        <div className="gen-preview">
          <span className="muted">Each date will have <b style={{ color: "var(--green)" }}>{preview.length}</b> cohort{preview.length === 1 ? "" : "s"} ({preview.length * (+f.candidatesPerCohort)} spots/day):</span>
          <div className="prev-pills">{preview.map((c) => <span key={c.id} className="prev-pill">{c.start}</span>)}</div>
        </div>
        <Btn onClick={create} disabled={!f.name.trim() || preview.length === 0} style={{ marginTop: 8 }}>Create Event{dates.length ? ` · ${dates.length} date${dates.length === 1 ? "" : "s"}` : ""}</Btn>
      </div>

      {events.length > 0 && (
        <div style={{ marginTop: 26 }}>
          <h3 className="step-h">Your events</h3>
          {events.map((e) => {
            const candCount = (data.candidates || []).filter((c) => c.eventId === e.id && !c.cancelled).length;
            return (
              <div key={e.id} className="card event-row">
                <div>
                  <b>{e.name}</b>
                  <span className="muted"> · {(e.dates || []).length} date{(e.dates || []).length === 1 ? "" : "s"} · {cohortTimes(e).length} cohorts/day · {(e.location?.building || "TBA")}{e.location?.room ? ` ${e.location.room}` : ""}</span>
                </div>
                {confirmDel === e.id ? (
                  <div className="confirm-inline">
                    <span className="confirm-q">Delete this event{candCount ? ` and ${candCount} booking${candCount === 1 ? "" : "s"}` : ""}?</span>
                    <Btn kind="danger" small onClick={() => { removeEvent(e.id); setConfirmDel(null); }}>Yes, delete</Btn>
                    <Btn kind="outline" small onClick={() => setConfirmDel(null)}>Keep</Btn>
                  </div>
                ) : (
                  <Btn kind="danger" small onClick={() => setConfirmDel(e.id)}>Delete</Btn>
                )}
              </div>
            );
          })}
          <p className="muted" style={{ marginTop: 6 }}>Add or remove interview dates for an event in the <b>Settings</b> tab.</p>
        </div>
      )}
    </div>
  );
}

/* ---- Candidates: all dates, table with search/sort/CSV ---- */
function IACandidates({ data, save, ev }) {
  if (!ev) return <EmptyEvents />;
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState("datetime");
  const rows = eventCandidates(data, ev);
  const cohortStart = (id) => cohortTimes(ev).find((c) => c.id === id)?.start || "";

  const filtered = rows
    .filter((c) => [c.name, c.email, c.purdueId].join(" ").toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => {
      if (sortKey === "name") return a.name.localeCompare(b.name);
      if (sortKey === "datetime") return (a.date || "").localeCompare(b.date || "") || cohortStart(a.cohortId).localeCompare(cohortStart(b.cohortId));
      return (a.createdAt || "").localeCompare(b.createdAt || "");
    });

  const cancel = async (id) =>
    save((prev) => ({ ...prev, candidates: (prev.candidates || []).map((c) => c.id === id ? { ...c, cancelled: true } : c) }));

  const exportCsv = () => {
    const head = ["Name", "Email", "Purdue ID", "Phone", "Date", "Cohort Start", "Approx End", "Location", "Status", "Confirmation"];
    const loc = ev.location || {};
    const rowsCsv = filtered.map((c) => {
      const co = cohortTimes(ev).find((k) => k.id === c.cohortId);
      return [c.name, c.email, c.purdueId, c.phone, prettyDate(c.date),
        co?.start || "", co ? addMin(co.start, cohortDuration(ev)) : "",
        [loc.building, loc.room].filter(Boolean).join(" "), c.status, c.id];
    });
    const esc = (v) => `"${String(v || "").replace(/"/g, '""')}"`;
    const csv = [head, ...rowsCsv].map((r) => r.map(esc).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = `${ev.name.replace(/\s+/g, "_")}_candidates.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fadein">
      <div className="cand-toolbar">
        <input className="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, or ID…" />
        <select className="dropdown sm" value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
          <option value="datetime">Sort: Date & time</option>
          <option value="name">Sort: Name</option>
          <option value="created">Sort: Booking order</option>
        </select>
        <Btn kind="outline" small onClick={exportCsv}>Export CSV</Btn>
      </div>
      {filtered.length === 0 ? <p className="muted">No candidates yet.</p> : (
        <div className="tbl-wrap">
          <table>
            <thead><tr>{["Name", "Email", "Purdue ID", "Date", "Time", "Status", ""].map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id}>
                  <td><b>{c.name}</b></td>
                  <td>{c.email}</td>
                  <td>{c.purdueId}</td>
                  <td>{shortDate(c.date)}</td>
                  <td>{cohortStart(c.cohortId)}</td>
                  <td><span className={`status-badge s-${c.status.replace(/\s+/g, "").toLowerCase()}`}>{c.status}</span></td>
                  <td><Btn kind="danger" small onClick={() => cancel(c.id)}>Cancel</Btn></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ---- Interview-day view for one date ---- */
function IADayOf({ data, save, ev, date }) {
  if (!ev) return <EmptyEvents />;
  if (!date) return <div className="empty-state fadein"><p>No date selected.</p></div>;
  const setStatus = async (id, status) =>
    save((prev) => ({ ...prev, candidates: (prev.candidates || []).map((c) => c.id === id ? { ...c, status } : c) }));

  const cohorts = cohortTimes(ev);
  const any = cohorts.some((c) => candidatesInCohort(data, ev.id, date, c.id).length > 0);
  return (
    <div className="fadein">
      <p className="muted" style={{ marginTop: 0 }}>Tap a status to update each candidate live during interview day — {prettyDate(date)}.</p>
      {!any && <p className="muted">No candidates booked on this date yet.</p>}
      {cohorts.map((c) => {
        const list = candidatesInCohort(data, ev.id, date, c.id);
        if (list.length === 0) return null;
        return (
          <div key={c.id} className="card dayof-cohort">
            <div className="do-head"><b>{c.start} Cohort</b><span className="muted">{list.length} candidate{list.length === 1 ? "" : "s"}</span></div>
            {list.map((cd) => (
              <div key={cd.id} className="do-row">
                <div className="do-name"><b>{cd.name}</b><span className="muted">{cd.email}</span></div>
                <div className="do-statuses">
                  {INTERVIEW_STATUSES.map((st) => (
                    <button key={st} className={`do-status${cd.status === st ? " on" : ""}`} onClick={() => setStatus(cd.id, st)}>{st}</button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/* ---- Interviewers: assign per cohort per date (stored in cohortMeta) ---- */
function IAInterviewers({ data, save, ev, date }) {
  if (!ev) return <EmptyEvents />;
  if (!date) return <div className="empty-state fadein"><p>No date selected.</p></div>;
  const setMeta = async (cohortId, patch) => {
    const key = `${date}|${cohortId}`;
    await save((prev) => {
      const events = (prev.interviewEvents || []).map((e) => e.id !== ev.id ? e : {
        ...e, cohortMeta: { ...(e.cohortMeta || {}), [key]: { ...((e.cohortMeta || {})[key] || {}), ...patch } },
      });
      return { ...prev, interviewEvents: events };
    });
  };
  const setBehavioral = (cohortId, idx, val) => {
    const cur = cohortMeta(ev, date, cohortId).behavioralIvs || [];
    const arr = [...cur]; arr[idx] = val;
    setMeta(cohortId, { behavioralIvs: arr });
  };

  return (
    <div className="fadein">
      <p className="muted" style={{ marginTop: 0 }}>Assign interviewers for {prettyDate(date)}. Candidates never see this.</p>
      {cohortTimes(ev).map((c) => {
        const cap = cohortCapacity(ev, date, c.id);
        const meta = cohortMeta(ev, date, c.id);
        return (
          <div key={c.id} className="card iv-assign">
            <div className="do-head"><b>{c.start} Cohort</b><span className="muted">capacity {cap}</span></div>
            <div className="assign-grid">
              {Array.from({ length: cap }).map((_, i) => (
                <label key={i} className="assign-field">
                  <span>Behavioral IV — Candidate {i + 1}</span>
                  <input value={(meta.behavioralIvs || [])[i] || ""} onChange={(e) => setBehavioral(c.id, i, e.target.value)} placeholder="Interviewer name" />
                </label>
              ))}
              <label className="assign-field wide">
                <span>Case interview team</span>
                <input value={meta.caseTeam || ""} onChange={(e) => setMeta(c.id, { caseTeam: e.target.value })} placeholder="e.g. Rishi + Liya" />
              </label>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---- Settings: manage dates, per-cohort capacity/close, location, arrival note ---- */
function IASettings({ data, save, ev, date }) {
  if (!ev) return <EmptyEvents />;
  const [newDate, setNewDate] = useState("");

  const patchEvent = async (patch) =>
    save((prev) => ({ ...prev, interviewEvents: (prev.interviewEvents || []).map((e) => e.id === ev.id ? { ...e, ...patch } : e) }));

  const addDate = async () => {
    if (!newDate || (ev.dates || []).includes(newDate)) return;
    await patchEvent({ dates: [...(ev.dates || []), newDate].sort() });
    setNewDate("");
  };
  const removeDate = async (d) => {
    await save((prev) => ({
      ...prev,
      interviewEvents: (prev.interviewEvents || []).map((e) => e.id === ev.id ? { ...e, dates: (e.dates || []).filter((x) => x !== d) } : e),
      candidates: (prev.candidates || []).filter((c) => !(c.eventId === ev.id && c.date === d)),
    }));
  };
  const setMeta = async (cohortId, patch) => {
    const key = `${date}|${cohortId}`;
    await save((prev) => ({ ...prev, interviewEvents: (prev.interviewEvents || []).map((e) => e.id !== ev.id ? e : {
      ...e, cohortMeta: { ...(e.cohortMeta || {}), [key]: { ...((e.cohortMeta || {})[key] || {}), ...patch } },
    }) }));
  };
  const setCapacity = (cohortId, val) => {
    const booked = candidatesInCohort(data, ev.id, date, cohortId).length;
    setMeta(cohortId, { capacity: Math.max(booked, +val || 0) });
  };

  return (
    <div className="fadein">
      <div className="card form-card" style={{ maxWidth: 640, marginBottom: 24 }}>
        <h3 className="step-h" style={{ marginTop: 0 }}>Interview dates</h3>
        <p className="muted" style={{ marginTop: -6, marginBottom: 14 }}>Add every day you'll run interviews for this event. They all share the same location, format, and time window.</p>
        <div className="date-add-row">
          <input type="date" className="date-add-input" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
          <Btn small onClick={addDate} disabled={!newDate}>+ Add date</Btn>
        </div>
        <div className="date-chip-row">
          {eventDates(ev).length === 0 ? <span className="muted">No dates yet.</span> :
            eventDates(ev).map((d) => (
              <span key={d} className="date-chip">{prettyDate(d)}<button onClick={() => {
                  const n = (data.candidates || []).filter((c) => c.eventId === ev.id && c.date === d && !c.cancelled).length;
                  if (window.confirm(`Remove ${prettyDate(d)}${n ? ` and its ${n} booking${n === 1 ? "" : "s"}` : ""}?`)) removeDate(d);
                }} title="Remove date">×</button></span>
            ))}
        </div>
      </div>

      <div className="card form-card" style={{ maxWidth: 640, marginBottom: 24 }}>
        <h3 className="step-h" style={{ marginTop: 0 }}>Location & instructions</h3>
        <div className="field-row">
          <Field label="Building" value={ev.location?.building || ""} onChange={(e) => patchEvent({ location: { ...ev.location, building: e.target.value } })} />
          <Field label="Room" value={ev.location?.room || ""} onChange={(e) => patchEvent({ location: { ...ev.location, room: e.target.value } })} />
        </div>
        <Field label="Address (optional)" value={ev.location?.address || ""} onChange={(e) => patchEvent({ location: { ...ev.location, address: e.target.value } })} />
        <label className="field"><span>Arrival instruction</span>
          <input value={ev.arrivalInstruction || ""} onChange={(e) => patchEvent({ arrivalInstruction: e.target.value })} />
        </label>
      </div>

      {date && (
        <>
          <h3 className="step-h">Per-cohort capacity · {prettyDate(date)}</h3>
          {cohortTimes(ev).map((c) => {
            const booked = candidatesInCohort(data, ev.id, date, c.id).length;
            const closed = cohortClosed(ev, date, c.id);
            return (
              <div key={c.id} className="card cohort-setting">
                <b>{c.start}</b>
                <span className="muted">{booked} booked</span>
                <label className="cap-field">Capacity
                  <input type="number" min={booked} value={cohortCapacity(ev, date, c.id)} onChange={(e) => setCapacity(c.id, e.target.value)} />
                </label>
                <Btn kind="outline" small onClick={() => setMeta(c.id, { closed: !closed })}>{closed ? "Reopen" : "Close"}</Btn>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

function EmptyEvents() {
  return <div className="empty-state fadein"><p>No interview event yet.</p><p className="muted">Go to <b>Interview Events</b> to create one — set the location and format once, then add your interview dates.</p></div>;
}


/* ---------------- styles ---------------- */
function GlobalStyles() {
  return (
    <style>{`
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap');

* , *::before, *::after { box-sizing: border-box; }
.site { min-height: 100vh; display: flex; flex-direction: column; background: #fff; color: #111;
  font-family: Inter, sans-serif; -webkit-font-smoothing: antialiased; }
.wrap { flex: 1; width: 100%; max-width: 920px; margin: 0 auto; padding: 0 20px; box-sizing: border-box; }
h1, h2, h3 { font-family: 'Space Grotesk', sans-serif; color: #111; }
a { color: var(--green); font-weight: 600; text-decoration: none; transition: color .2s; }
a:hover { text-decoration: underline; color: var(--greenDark); }
.muted { color: #777; font-weight: 400; font-size: 14.5px; }
.loading { padding: 60px; text-align: center; color: #888; }

/* ---- motion ---- */
.page { animation: pageIn .5s cubic-bezier(.22,1,.36,1) both; padding: 40px 0 80px; }
@keyframes pageIn { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }
.rise { animation: rise .6s cubic-bezier(.22,1,.36,1) both; }
@keyframes rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
.d1 { animation-delay: .05s; } .d2 { animation-delay: .12s; } .d3 { animation-delay: .2s; }
.d4 { animation-delay: .28s; } .d5 { animation-delay: .38s; }
.stagger { animation: rise .45s cubic-bezier(.22,1,.36,1) both; }
.fadein { animation: fadein .35s ease both; }
@keyframes fadein { from { opacity: 0; } to { opacity: 1; } }

/* wizard step transitions — forward slides in from the right, back from the left */
.slide-fwd { animation: slideFwd .45s cubic-bezier(.22,1,.36,1) both; }
.slide-back { animation: slideBack .45s cubic-bezier(.22,1,.36,1) both; }
@keyframes slideFwd { from { opacity: 0; transform: translateX(36px); } to { opacity: 1; transform: none; } }
@keyframes slideBack { from { opacity: 0; transform: translateX(-36px); } to { opacity: 1; transform: none; } }
.slide-fwd .stagger, .slide-back .stagger { animation: fadein .4s ease both; }

/* header */
.hdr { position: sticky; top: 0; z-index: 20; background: rgba(255,255,255,.92); backdrop-filter: blur(10px);
  border-bottom: 1px solid #E9E9E4; animation: fadein .5s ease both; }
.hdr-in { max-width: 920px; margin: 0 auto; padding: 12px 20px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.brand { background: none; border: none; cursor: pointer; padding: 0; display: flex; align-items: center;
  transition: opacity .2s, transform .2s; }
.brand:hover { opacity: .85; }
nav { margin-left: auto; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.nav-lnk { position: relative; background: none; border: none; cursor: pointer; font-family: 'Space Grotesk', sans-serif;
  font-weight: 600; font-size: 14.5px; color: #111; padding: 9px 14px; border-radius: 8px;
  transition: background .25s, color .25s; }
.nav-lnk:hover { color: var(--greenDark); background: var(--tint); }
.nav-lnk.on { color: var(--green); }
.nav-lnk.sub { color: #888; font-size: 13.5px; }
.nav-lnk.back { color: #fff; background: var(--green); }
.nav-lnk.back:hover { background: var(--greenDark); color: #fff; }

/* hero */
.hero { padding-top: 80px; max-width: 680px; }
.eyebrow { font-family: 'Space Grotesk', sans-serif; color: var(--green); font-weight: 700;
  letter-spacing: .14em; text-transform: uppercase; font-size: 12.5px; margin: 0 0 16px; }
.hero h1 { font-size: clamp(30px, 5vw, 46px); line-height: 1.12; margin: 0 0 18px; }
.lede { font-size: 17.5px; line-height: 1.65; color: #444; margin: 0 0 32px; }
.steps-line { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-top: 46px;
  font-family: 'Space Grotesk', sans-serif; font-weight: 600; font-size: 14px; color: #555; }
.steps-line i { color: var(--green); font-style: normal; }

/* buttons */
.btn { font-family: 'Space Grotesk', sans-serif; font-weight: 600; font-size: 16px; border-radius: 10px;
  padding: 14px 28px; cursor: pointer; border: 2px solid transparent;
  transition: background .25s, transform .18s cubic-bezier(.22,1,.36,1), box-shadow .25s, border-color .25s, color .25s; }
.btn:active { transform: scale(.97); }
.btn:disabled { opacity: .45; cursor: not-allowed; }
.btn-sm { padding: 8px 16px; font-size: 14px; border-radius: 8px; }
.btn-primary { background: var(--green); color: #fff; box-shadow: 0 2px 10px rgba(118,169,53,.28); }
.btn-primary:hover:not(:disabled) { background: var(--greenDark); box-shadow: 0 4px 14px rgba(118,169,53,.35); }
.btn-outline { background: #fff; color: #111; border-color: #111; }
.btn-outline:hover { background: #111; color: #fff; }
.btn-danger { background: #fff; color: #C0392B; border-color: #E4B6B0; }
.btn-danger:hover { border-color: #C0392B; background: #FDF3F2; }

/* wizard nav */
.wizard-nav { display: flex; justify-content: space-between; gap: 12px; margin-top: 10px;
  padding-top: 22px; border-top: 1.5px solid #EFEFEA; }

/* progress */
.progress { display: flex; gap: 8px; margin: 20px 0 32px; }
.p-seg { flex: 1; }
.p-bar { height: 5px; border-radius: 3px; background: #E9E9E4; overflow: hidden; position: relative; }
.p-bar::before { content: ""; position: absolute; inset: 0; background: var(--green); border-radius: 3px;
  transform: scaleX(0); transform-origin: left; transition: transform .5s cubic-bezier(.22,1,.36,1); }
.p-seg.done .p-bar::before { transform: scaleX(1); }
.p-seg span { font-size: 12.5px; font-weight: 600; color: #999; transition: color .4s; display: inline-block; margin-top: 6px; }
.p-seg.done span { color: var(--green); }

.step-h { font-size: 18px; margin: 0 0 14px; }

/* date grid */
.date-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 10px; margin-bottom: 30px; }
.date-card { display: flex; flex-direction: column; gap: 2px; align-items: center; padding: 12px 6px;
  box-sizing: border-box; width: 100%; border-radius: 12px; border: 2px solid #DEDEDA; background: #fff;
  cursor: pointer; font-family: 'Space Grotesk', sans-serif;
  transition: border-color .25s, background .25s, color .25s; }
.date-card span { font-size: 12px; font-weight: 600; color: #888; transition: color .25s; }
.date-card b { font-size: 15px; color: #111; transition: color .25s; }
.date-card:hover:not(:disabled):not(.is-selected) { border-color: var(--green); }
.date-card.is-selected { background: var(--green); border-color: var(--green); }
.date-card.blockedday { border-color: #C0392B; background: #FDF3F2; }
.date-card.blockedday span, .date-card.blockedday b { color: #C0392B; text-decoration: line-through; }
.date-card.is-selected span, .date-card.is-selected b { color: #fff; }
.date-card:disabled { background: #F5F5F2; cursor: not-allowed; }
.date-card:disabled b { color: #BBB; }

/* time pills */
.pills { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 30px; }
.pill { padding: 11px 22px; border-radius: 999px; font-family: 'Space Grotesk', sans-serif; font-weight: 600;
  font-size: 15px; border: 2px solid #DEDEDA; background: #fff; color: #111; cursor: pointer;
  transition: border-color .25s, background .25s, color .25s; }
.pill:hover:not(:disabled):not(.is-selected) { border-color: var(--green); }
.pill.is-selected { background: var(--green); border-color: var(--green); color: #fff; }
.pill.off { background: #F5F5F2; color: #BBB; text-decoration: line-through; cursor: not-allowed; }
.pill.avail { background: var(--tint); border: 2px solid var(--green); }
.pill.blocked { color: #C0392B; border-color: #C0392B; text-decoration: line-through; }

/* interview time slots — always-visible clear boxes (like member date cards) */
.time-box-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; margin-top: 14px; max-width: 640px; }
.time-box { display: flex; flex-direction: column; gap: 4px; align-items: center; justify-content: center;
  padding: 18px 12px; border-radius: 14px; border: 2px solid var(--green); background: var(--tint); cursor: pointer;
  font-family: 'Space Grotesk', sans-serif; box-shadow: 0 1px 4px rgba(17,17,17,.03);
  transition: background .25s, color .25s, box-shadow .25s, transform .2s cubic-bezier(.22,1,.36,1); }
.time-box b { font-size: 19px; color: #111; }
.time-box span { font-size: 12.5px; color: var(--greenDark); font-weight: 600; }
.time-box:hover:not(.is-selected) { background: #E9F2DA; transform: translateY(-2px); box-shadow: 0 8px 18px rgba(118,169,53,.16); }
.time-box.is-selected { background: var(--green); border-color: var(--green); box-shadow: 0 8px 20px rgba(118,169,53,.3); }
.time-box.is-selected b, .time-box.is-selected span { color: #fff; }
.pill.booked { background: #EEE; color: #999; cursor: not-allowed; }

/* per-day times table */
.times-table { border: 1.5px solid #E7E7E2; border-radius: 12px; overflow: hidden; }
.times-row { display: flex; align-items: center; gap: 12px; padding: 10px 14px; flex-wrap: wrap; }
.times-row + .times-row { border-top: 1px solid #EDEDEA; }
.times-row:nth-child(even) { background: #FAFAF8; }
.times-day { display: flex; flex-direction: column; min-width: 64px; line-height: 1.2; }
.times-day b { font-family: 'Space Grotesk', sans-serif; font-size: 14px; }
.times-day span { font-size: 12.5px; color: #777; }
.times-input { flex: 1; min-width: 200px; padding: 9px 12px; font-size: 14.5px;
  border: 1.5px solid #D8D8D3; border-radius: 8px; font-family: Inter, sans-serif; outline: none;
  transition: border-color .2s, box-shadow .2s; background: #fff; }
.times-input:focus { border-color: var(--green); box-shadow: 0 0 0 3px rgba(118,169,53,.14); }
.times-status { font-size: 12.5px; font-weight: 700; color: #AAA; min-width: 64px; text-align: right; }
.times-status.set { color: var(--green); }
.win-label { display: flex; align-items: center; gap: 7px; font-size: 12.5px; font-weight: 700; color: #666;
  font-family: 'Space Grotesk', sans-serif; }
.win-select { padding: 8px 10px; font-size: 14px; border: 1.5px solid #D8D8D3; border-radius: 8px;
  font-family: Inter, sans-serif; background: #fff; outline: none; transition: border-color .2s; }
.win-select:focus { border-color: var(--green); }
.win-stack { display: flex; flex-direction: column; gap: 8px; flex: 1; }
.win-line { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.win-remove { width: 30px; height: 30px; border-radius: 8px; border: 1.5px solid #E3B7B2; background: #fff;
  color: #C0392B; font-size: 16px; font-weight: 700; cursor: pointer; line-height: 1;
  transition: background .2s, border-color .2s; }
.win-remove:hover { background: #FDF3F2; border-color: #C0392B; }
.win-add { align-self: flex-start; padding: 7px 14px; border-radius: 999px; border: 1.5px dashed var(--green);
  background: #fff; color: var(--greenDark); font-family: 'Space Grotesk', sans-serif; font-weight: 700;
  font-size: 13px; cursor: pointer; transition: background .2s; }
.win-add:hover { background: var(--tint); }

/* team windows hint on the booking time step */
.windows-hint { background: var(--tint); border: 1px solid var(--green); border-radius: 10px;
  padding: 10px 14px; font-size: 13.5px; margin: 0 0 14px; }
.windows-hint b { font-family: 'Space Grotesk', sans-serif; font-size: 13px; }
.windows-list { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.window-chip { background: #fff; border: 1px solid var(--green); border-radius: 999px;
  padding: 3px 12px; font-weight: 600; font-size: 13px; color: var(--greenDark); }

/* quick time chips */
.quick-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chip { padding: 8px 16px; border-radius: 999px; font-family: 'Space Grotesk', sans-serif; font-weight: 600;
  font-size: 13.5px; border: 1.5px solid #DEDEDA; background: #fff; color: #333; cursor: pointer;
  transition: border-color .2s, background .2s, color .2s; }
.chip:hover { border-color: var(--green); background: var(--tint); color: var(--greenDark); }

/* cards + form */
.card { border: 1.5px solid #E7E7E2; border-radius: 14px; background: #fff; transition: box-shadow .3s, transform .3s; }
.form-card { max-width: 430px; padding: 26px; box-shadow: 0 8px 28px rgba(0,0,0,.06); }
.summary-chip { background: var(--tint); border: 1px solid var(--green); border-radius: 9px;
  padding: 10px 14px; font-size: 14.5px; margin-bottom: 20px; }
.field { display: block; margin-bottom: 18px; }
.field span { display: block; font-size: 12.5px; font-weight: 700; letter-spacing: .05em;
  text-transform: uppercase; margin-bottom: 6px; }
.field input { width: 100%; box-sizing: border-box; padding: 12px 14px; font-size: 16px;
  border: 1.5px solid #D8D8D3; border-radius: 9px; font-family: Inter, sans-serif; outline: none;
  transition: border-color .25s, box-shadow .25s; }
.field input:focus { border-color: var(--green); box-shadow: 0 0 0 3px rgba(118,169,53,.16); }
.err { color: #C0392B; font-weight: 600; font-size: 14px; margin: 0 0 14px; animation: shake .35s ease; }
@keyframes shake { 0%,100% { transform: none; } 25% { transform: translateX(-4px); } 75% { transform: translateX(4px); } }

/* confirmation */
.confirm { max-width: 520px; }
.check { width: 58px; height: 58px; border-radius: 50%; background: var(--green); display: flex;
  align-items: center; justify-content: center; margin-bottom: 20px;
  animation: pop .55s cubic-bezier(.22,1.5,.36,1) both; box-shadow: 0 6px 20px rgba(118,169,53,.35); }
@keyframes pop { from { transform: scale(0) rotate(-30deg); } to { transform: scale(1) rotate(0); } }
.detail-card { margin: 24px 0 18px; overflow: hidden; }
.d-row { display: flex; justify-content: space-between; gap: 16px; padding: 13px 18px; font-size: 15px; }
.d-row:nth-child(even) { background: #FAFAF8; }
.fine { font-size: 14.5px; color: #666; line-height: 1.6; margin: 14px 0 20px; }

.teams-btn { display: inline-flex; align-items: center; gap: 9px; background: var(--green); color: #fff !important;
  font-family: 'Space Grotesk', sans-serif; font-weight: 600; font-size: 15.5px; padding: 13px 24px;
  border-radius: 10px; text-decoration: none !important; box-shadow: 0 2px 10px rgba(118,169,53,.28);
  transition: background .25s, transform .18s, box-shadow .25s; }
.teams-btn:hover { background: var(--greenDark); box-shadow: 0 4px 14px rgba(118,169,53,.35); }
.teams-btn.small { padding: 9px 16px; font-size: 14px; }

/* my calls */
.call-card { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; padding: 16px 20px; margin-top: 12px; }
.call-card:hover { box-shadow: 0 4px 12px rgba(0,0,0,.05); }
.call-when { display: flex; flex-direction: column; min-width: 180px; }
.call-when b { font-family: 'Space Grotesk', sans-serif; font-size: 15.5px; }
.call-time { color: var(--green); font-weight: 700; font-size: 14.5px; }
.call-who { display: flex; flex-direction: column; flex: 1; min-width: 160px; }
.call-who b { font-size: 15px; }
.call-who a { font-size: 13.5px; font-weight: 500; }

/* link editor + availability */
.link-card { padding: 18px 20px; }
.link-title { font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 15.5px; margin: 0 0 4px; }
.link-row { display: flex; gap: 10px; flex-wrap: wrap; }
.link-input { flex: 1; min-width: 220px; box-sizing: border-box; padding: 11px 14px; font-size: 14.5px;
  border: 1.5px solid #D8D8D3; border-radius: 9px; font-family: Inter, sans-serif; outline: none;
  transition: border-color .25s, box-shadow .25s; }
.link-input:focus { border-color: var(--green); box-shadow: 0 0 0 3px rgba(118,169,53,.16); }
.saved-msg { color: var(--green); font-weight: 700; font-size: 14px; margin: 8px 0 0; animation: fadein .3s ease; }
.avail-row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }

/* admin */
.admin-top { display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap; }
.notice { background: var(--tint); border: 1px solid var(--green); border-radius: 10px;
  padding: 12px 16px; font-size: 14px; color: #333; line-height: 1.55; margin: 18px 0 0; }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin: 24px 0 8px; }
.stat { padding: 15px 18px; }
.stat:hover { box-shadow: 0 4px 12px rgba(0,0,0,.05); }
.stat span { font-size: 13px; color: #777; font-weight: 600; }
.stat b { display: block; font-family: 'Space Grotesk', sans-serif; font-size: 28px; color: var(--green); margin-top: 2px; }
.tabs { border-bottom: 1.5px solid #E7E7E2; margin: 16px 0 22px; }
.tab { background: none; border: none; cursor: pointer; font-family: 'Space Grotesk', sans-serif;
  font-weight: 700; font-size: 15px; padding: 10px 2px; margin-right: 24px; color: #777;
  border-bottom: 3px solid transparent; transition: color .25s, border-color .25s; }
.tab:hover { color: #111; }
.tab.on { color: var(--green); border-color: var(--green); }
.tbl-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 14.5px; }
th { text-align: left; padding: 10px 12px; border-bottom: 2px solid #111;
  font-family: 'Space Grotesk', sans-serif; font-size: 12.5px; letter-spacing: .04em; text-transform: uppercase; }
td { padding: 11px 12px; border-bottom: 1px solid #EDEDEA; transition: background .2s; }
tr:hover td { background: #FAFBF7; }
.dropdown { padding: 10px 14px; font-size: 15px; border-radius: 9px; border: 1.5px solid #D8D8D3;
  margin-bottom: 18px; font-family: Inter, sans-serif; background: #fff; transition: border-color .25s;
  min-width: 220px; }
.dropdown:focus { border-color: var(--green); outline: none; }

/* footer — light */
.ftr { background: #FAFAF8; border-top: 1px solid #E9E9E4; margin-top: auto; }
.ftr-in { max-width: 920px; margin: 0 auto; padding: 26px 20px; display: flex; flex-wrap: wrap;
  gap: 20px; align-items: center; }
.ftr-txt { display: flex; flex-direction: column; gap: 3px; }
.ftr-txt b { font-family: 'Space Grotesk', sans-serif; font-size: 15px; color: #111; }
.ftr-txt span { font-size: 13px; color: #888; }
.ftr-links { margin-left: auto; display: flex; gap: 18px; font-size: 14px; flex-wrap: wrap; }

@media (max-width: 560px) {
  .hero { padding-top: 48px; }
  .ftr-links { margin-left: 0; }
  .brand img { height: 40px !important; }
}
@media (prefers-reduced-motion: reduce) {
  *, .page, .rise, .stagger, .check, .fadein, .slide-fwd, .slide-back { animation: none !important; transition: none !important; }
}

/* ============ LANDING (two experiences) ============ */
.landing { padding-top: 30px; }
.landing-h { font-size: clamp(28px, 4.6vw, 44px); line-height: 1.12; margin: 0 0 18px; }
.choice-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 22px; margin-top: 12px; max-width: 860px; }
.choice-card { text-align: left; display: flex; flex-direction: column; gap: 8px; padding: 30px 28px;
  border-radius: 20px; border: 1.5px solid #E7E7E2; background: #fff; cursor: pointer; position: relative;
  overflow: hidden; transition: border-color .3s, box-shadow .3s, transform .3s cubic-bezier(.22,1,.36,1); }
.choice-card::after { content: ""; position: absolute; inset: 0; background: linear-gradient(135deg, var(--tint), transparent 60%);
  opacity: 0; transition: opacity .35s; pointer-events: none; }
.choice-card:hover { border-color: var(--green); box-shadow: 0 18px 44px rgba(118,169,53,.16); transform: translateY(-4px); }
.choice-card:hover::after { opacity: 1; }
.choice-tag { font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 11.5px; letter-spacing: .14em;
  text-transform: uppercase; color: var(--green); }
.choice-title { font-family: 'Space Grotesk', sans-serif; font-size: 25px; color: #111; line-height: 1.15; }
.choice-desc { font-size: 14.5px; color: #666; }
.choice-go { margin-top: 12px; font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 15px; color: var(--greenDark); }
.choice-card.alt .choice-tag { color: #111; }

/* ============ candidate booking ============ */
.field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.field-row-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; }
.field-row-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.iv-event { padding: 18px 20px; margin-bottom: 16px; }
.iv-event-head { display: flex; justify-content: space-between; margin-bottom: 12px; }
.iv-event-head b { font-family: 'Space Grotesk', sans-serif; font-size: 16px; }
.iv-loc { display: block; font-size: 13px; color: #888; margin-top: 3px; }
.cohort-grid { display: flex; flex-wrap: wrap; gap: 12px; }
.cohort-pill { display: flex; flex-direction: column; gap: 3px; align-items: flex-start; padding: 12px 20px;
  border-radius: 14px; border: 2px solid var(--line); background: #fff; cursor: pointer; min-width: 130px;
  font-family: 'Space Grotesk', sans-serif; transition: border-color .25s, background .25s, color .25s; }
.cohort-pill b { font-size: 17px; }
.cohort-pill span { font-size: 12px; color: #888; font-weight: 600; }
.cohort-pill:hover:not(.is-selected) { border-color: var(--green); }
.cohort-pill.is-selected { background: var(--green); border-color: var(--green); }
.cohort-pill.is-selected b, .cohort-pill.is-selected span { color: #fff; }

/* consultant time boxes — mirror the member date-card look */
.cohort-card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; margin-top: 14px; }
.cohort-box { display: flex; flex-direction: column; gap: 4px; align-items: center; justify-content: center;
  padding: 18px 10px; border-radius: 14px; border: 2px solid var(--line); background: #fff; cursor: pointer;
  font-family: 'Space Grotesk', sans-serif; transition: border-color .25s, background .25s, color .25s, box-shadow .25s; }
.cohort-box b { font-size: 19px; color: #111; }
.cohort-box .cohort-left { font-size: 12.5px; color: #888; font-weight: 600; }
.cohort-box:hover:not(.is-selected) { border-color: var(--green); box-shadow: 0 6px 16px rgba(118,169,53,.12); }
.cohort-box.is-selected { background: var(--green); border-color: var(--green); box-shadow: 0 6px 16px rgba(118,169,53,.28); }
.cohort-box.is-selected b, .cohort-box.is-selected .cohort-left { color: #fff; }
.pick-label { font-family: 'Space Grotesk', sans-serif; font-weight: 600; font-size: 13.5px; color: #555; margin: 4px 0 0; }
.confirm-review { display: flex; flex-direction: column; gap: 2px; }
.format-card { display: flex; align-items: center; justify-content: center; gap: 14px; flex-wrap: wrap;
  background: var(--tint); border: 1px solid var(--green); border-radius: 16px; padding: 18px 22px;
  max-width: 560px; margin: 20px auto 0; }
.fmt-step { text-align: center; }
.fmt-step b { display: block; font-family: 'Space Grotesk', sans-serif; font-size: 20px; color: var(--greenDark); }
.fmt-step span { font-size: 12.5px; color: #555; font-weight: 600; }
.fmt-arrow { color: var(--green); font-weight: 700; font-size: 18px; }
.arrival-note { text-align: center; font-weight: 600; color: #444; max-width: 480px; margin: 16px auto 0; }
.empty-state { border: 1.5px dashed #D8D8D3; border-radius: 16px; padding: 34px; text-align: center; }
.narrow { max-width: 440px; }

/* ============ interview admin ============ */
.event-switch { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
.event-switch .dropdown { margin-bottom: 0; }
.stats-5 { grid-template-columns: repeat(5, 1fr); }
.cohort-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px; margin-top: 8px; }
.cohort-card { padding: 18px 20px; }
.cohort-card.closed { opacity: .6; }
.cc-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.cc-head b { font-family: 'Space Grotesk', sans-serif; font-size: 19px; }
.badge { font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 11px; padding: 4px 11px; border-radius: 999px; }
.badge.open { background: var(--tint); color: var(--greenDark); }
.badge.full { background: #FDECEA; color: #C0392B; }
.badge.closed { background: #EEE; color: #777; }
.cc-bar { height: 7px; border-radius: 4px; background: #EDEDEA; overflow: hidden; margin-bottom: 8px; }
.cc-bar i { display: block; height: 100%; background: var(--green); border-radius: 4px; transition: width .5s cubic-bezier(.22,1,.36,1); }
.cc-count { font-size: 13px; font-weight: 700; color: #555; margin-bottom: 10px; font-family: 'Space Grotesk', sans-serif; }
.cc-list { display: flex; flex-direction: column; gap: 4px; }
.cc-name { font-size: 13.5px; color: #333; padding: 3px 0; border-top: 1px solid #F2F2EE; }
.cc-list .cc-name:first-child { border-top: none; }

.field-row-3, .field-row-4 { margin-bottom: 0; }
.gen-preview { margin: 16px 0 4px; }
.prev-pills { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.prev-pill { background: var(--tint); border: 1px solid var(--green); color: var(--greenDark); border-radius: 999px;
  padding: 5px 13px; font-family: 'Space Grotesk', sans-serif; font-weight: 600; font-size: 13px; }
.event-row { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; margin-bottom: 10px; }
.event-row b { font-family: 'Space Grotesk', sans-serif; }

.cand-toolbar { display: flex; gap: 10px; margin-bottom: 16px; flex-wrap: wrap; }
.search { flex: 1; min-width: 200px; padding: 10px 14px; border: 1.5px solid #D8D8D3; border-radius: 9px;
  font-family: Inter, sans-serif; font-size: 14.5px; outline: none; transition: border-color .2s; }
.search:focus { border-color: var(--green); }
.dropdown.sm, .dropdown.xs { min-width: auto; margin-bottom: 0; }
.dropdown.sm { padding: 9px 12px; font-size: 14px; }
.dropdown.xs { padding: 6px 9px; font-size: 13px; border-radius: 7px; }
.status-badge { font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 11px; padding: 4px 10px;
  border-radius: 999px; background: #EEE; color: #666; white-space: nowrap; }
.status-badge.s-checkedin { background: #E8F0FB; color: #2B6CB0; }
.status-badge.s-behavioral, .status-badge.s-caseinterview { background: var(--tint); color: var(--greenDark); }
.status-badge.s-completed { background: #E6F4EA; color: #1E7E34; }
.status-badge.s-noshow { background: #FDECEA; color: #C0392B; }

.dayof-cohort, .iv-assign { padding: 18px 20px; margin-bottom: 14px; }
.do-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 12px; }
.do-head b { font-family: 'Space Grotesk', sans-serif; font-size: 17px; }
.do-row { display: flex; justify-content: space-between; gap: 14px; padding: 10px 0; border-top: 1px solid #F0F0EC; flex-wrap: wrap; }
.do-name { display: flex; flex-direction: column; }
.do-name b { font-family: 'Space Grotesk', sans-serif; }
.do-name span { font-size: 12.5px; }
.do-statuses { display: flex; flex-wrap: wrap; gap: 6px; }
.do-status { font-family: 'Space Grotesk', sans-serif; font-weight: 600; font-size: 12px; padding: 5px 11px;
  border-radius: 999px; border: 1.5px solid #E0E0DB; background: #fff; color: #666; cursor: pointer; transition: all .2s; }
.do-status:hover { border-color: var(--green); }
.do-status.on { background: var(--green); border-color: var(--green); color: #fff; }
.assign-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.assign-field { display: flex; flex-direction: column; gap: 5px; }
.assign-field.wide { grid-column: 1 / -1; }
.assign-field span { font-size: 12px; font-weight: 700; color: #666; font-family: 'Space Grotesk', sans-serif; }
.assign-field input { padding: 9px 12px; border: 1.5px solid #D8D8D3; border-radius: 8px; font-family: Inter, sans-serif;
  font-size: 14px; outline: none; transition: border-color .2s; }
.assign-field input:focus { border-color: var(--green); }
.cohort-setting { display: flex; align-items: center; gap: 14px; padding: 13px 18px; margin-bottom: 10px; flex-wrap: wrap; }
.cohort-setting > b { font-family: 'Space Grotesk', sans-serif; font-size: 16px; min-width: 74px; }
.cap-field { display: flex; align-items: center; gap: 8px; font-size: 12.5px; font-weight: 700; color: #666;
  font-family: 'Space Grotesk', sans-serif; margin-left: auto; }
.cap-field input { width: 64px; padding: 7px 10px; border: 1.5px solid #D8D8D3; border-radius: 8px; font-size: 14px; }

@media (max-width: 720px) {
  .choice-grid { grid-template-columns: 1fr; }
  .stats-5 { grid-template-columns: repeat(2, 1fr); }
  .field-row, .field-row-3, .field-row-4, .assign-grid { grid-template-columns: 1fr; }
}


/* ============ multi-day admin + polish ============ */
.date-tabs { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 20px; align-items: center; }
.date-tabs-label { font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 12.5px; color: #888; margin-right: 4px; }
.date-tab { font-family: 'Space Grotesk', sans-serif; font-weight: 600; font-size: 13px; padding: 8px 15px;
  border-radius: 999px; border: 1.5px solid #E0E0DB; background: #fff; color: #666; cursor: pointer; transition: all .2s; }
.date-tab:hover { border-color: var(--green); }
.date-tab.on { background: var(--green); border-color: var(--green); color: #fff; }
.date-add-row { display: flex; gap: 10px; align-items: center; margin-bottom: 14px; }
.date-add-input { padding: 10px 13px; border: 1.5px solid #D8D8D3; border-radius: 9px; font-family: Inter, sans-serif; font-size: 14.5px; }
.date-chip-row { display: flex; flex-wrap: wrap; gap: 8px; }
.date-chip { display: inline-flex; align-items: center; gap: 8px; background: var(--tint); border: 1px solid var(--green);
  color: var(--greenDark); border-radius: 999px; padding: 6px 8px 6px 14px; font-weight: 600; font-size: 13px; font-family: 'Space Grotesk', sans-serif; }
.date-chip button { width: 20px; height: 20px; border-radius: 50%; border: none; background: rgba(0,0,0,.06); color: var(--greenDark);
  font-size: 14px; cursor: pointer; line-height: 1; }
.date-chip button:hover { background: #C0392B; color: #fff; }
.pill-sub { font-weight: 600; font-size: 12.5px; opacity: .8; }
.event-pick { display: flex; align-items: center; gap: 10px; margin-bottom: 18px; }
.event-pick .dropdown { margin-bottom: 0; }

/* ============ VISUAL POLISH — richer, less flat ============ */
.site { background:
  radial-gradient(1200px 600px at 100% -10%, rgba(118,169,53,.06), transparent 55%),
  radial-gradient(900px 500px at -10% 110%, rgba(118,169,53,.05), transparent 55%),
  #fff; }
.hdr { backdrop-filter: saturate(1.2); }
.page { position: relative; }
h1, .landing-h { letter-spacing: -0.015em; }
.landing-h { background: linear-gradient(180deg, #111 62%, #3c4a2b); -webkit-background-clip: text; background-clip: text; }
.eyebrow { position: relative; display: inline-block; }
.choice-card { box-shadow: 0 2px 10px rgba(17,17,17,.03); }
.choice-card .choice-title { transition: color .25s; }
.choice-card:hover .choice-title { color: var(--greenDark); }
.btn-primary, .btn { box-shadow: 0 4px 14px rgba(118,169,53,.28); }
.btn-primary:hover:not(:disabled) { box-shadow: 0 8px 22px rgba(118,169,53,.36); }
.card { box-shadow: 0 2px 12px rgba(17,17,17,.035); }
.stat { background: linear-gradient(180deg, #fff, #FCFDFA); }
.stat b { background: linear-gradient(180deg, var(--green), var(--greenDark)); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
.date-card, .pill { box-shadow: 0 1px 4px rgba(17,17,17,.03); }
.date-card.is-selected, .pill.is-selected { box-shadow: 0 8px 20px rgba(118,169,53,.3); }
.cohort-card { background: linear-gradient(180deg, #fff, #FCFDFA); }
.cc-bar i { background: linear-gradient(90deg, var(--green), #8Fc14e); }
.progress .p-seg.done .p-bar::before { background: linear-gradient(90deg, var(--green), #8Fc14e); }
.section-tint { background: var(--tint); }
.notice { background: linear-gradient(180deg, #FFF9E9, #FFF4D6); border: 1px solid #F0D98A; color: #7A5B00;
  border-radius: 12px; padding: 12px 16px; font-size: 13.5px; margin-bottom: 16px; font-weight: 500; }


/* ============ live interview-day dashboard ============ */
.day-banner { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px;
  padding: 14px 18px; border-radius: 14px; background: linear-gradient(180deg, #FCFDFA, #F4F8EC);
  border: 1px solid #E5EFD4; margin-bottom: 18px; }
.day-banner-date { font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 16px; }
.timing-badge { font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 12.5px; padding: 6px 14px; border-radius: 999px; }
.timing-badge.ontime { background: #E6F4EA; color: #1E7E34; }
.timing-badge.slight { background: #FFF4D6; color: #7A5B00; }
.timing-badge.behind { background: #FDECEA; color: #C0392B; }

.progress-hero { display: flex; align-items: center; gap: 28px; flex-wrap: wrap; padding: 22px 24px;
  border: 1.5px solid #E7E7E2; border-radius: 18px; background: linear-gradient(180deg, #fff, #FCFDFA);
  box-shadow: 0 2px 12px rgba(17,17,17,.035); margin-bottom: 22px; }
.ring-wrap { position: relative; width: 120px; height: 120px; flex-shrink: 0; }
.ring-svg { width: 120px; height: 120px; transform: rotate(-90deg); }
.ring-bg { fill: none; stroke: #EDEDEA; stroke-width: 11; }
.ring-fg { fill: none; stroke: var(--green); stroke-width: 11; stroke-linecap: round;
  transition: stroke-dashoffset .8s cubic-bezier(.22,1,.36,1); }
.ring-label { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.ring-label b { font-family: 'Space Grotesk', sans-serif; font-size: 30px; line-height: 1;
  background: linear-gradient(180deg, var(--green), var(--greenDark)); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
.ring-label span { font-size: 11px; color: #999; font-weight: 600; margin-top: 2px; }
.progress-facts { display: grid; grid-template-columns: repeat(2, auto); gap: 14px 34px; }
.fact b { display: block; font-family: 'Space Grotesk', sans-serif; font-size: 26px; color: #111; line-height: 1; }
.fact span { font-size: 12.5px; color: #888; font-weight: 600; }

.cohort-card.live { border-color: var(--green); box-shadow: 0 8px 22px rgba(118,169,53,.18); }
.live-badge { background: var(--green); color: #fff; animation: pulse 1.6s ease-in-out infinite; }
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .55; } }
.cc-name { display: flex; align-items: center; gap: 7px; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: #CCC; flex-shrink: 0; }
.dot.s-checkedin { background: #2B6CB0; }
.dot.s-behavioral { background: #E0A800; }
.dot.s-waiting { background: #9333EA; }
.dot.s-caseinterview { background: var(--green); }
.dot.s-completed { background: #1E7E34; }
.dot.s-noshow { background: #C0392B; }
@media (max-width: 720px) { .progress-facts { grid-template-columns: repeat(2, auto); } }


/* ============ dashboard v2: timers + 2-level progress ============ */
.day-summary { display: flex; gap: 20px; font-size: 13.5px; color: #555; }
.day-summary b { font-family: 'Space Grotesk', sans-serif; color: #111; font-size: 16px; margin-right: 3px; }
.cc-plan { font-size: 12.5px; font-weight: 600; }
.timer-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 10px 0 6px;
  padding: 8px 12px; border-radius: 10px; background: #FAFAF7; border: 1px solid #EDEDEA; }
.timer-clock { font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 18px; color: #333; font-variant-numeric: tabular-nums; }
.timer-clock.near { color: #B8860B; }
.timer-clock.over { color: #C0392B; }
.timer-plan { font-size: 12px; color: #AAA; font-weight: 600; }
.timer-btn { font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 12.5px; padding: 7px 14px;
  border-radius: 999px; border: none; cursor: pointer; transition: all .2s; }
.timer-btn.start { background: var(--green); color: #fff; }
.timer-btn.start:hover { background: var(--greenDark); }
.timer-btn.reset { background: #fff; border: 1.5px solid #D8D8D3; color: #666; }
.timer-btn.reset:hover { border-color: #C0392B; color: #C0392B; }
.cohort-card.overtime { border-color: #C0392B; box-shadow: 0 8px 22px rgba(192,57,43,.15); }
.over-badge { background: #C0392B; color: #fff; animation: pulse 1s ease-in-out infinite; }
.over-alert { font-size: 12.5px; font-weight: 700; color: #C0392B; margin-bottom: 8px; }
.cand-prog { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 5px 0; border-top: 1px solid #F2F2EE; }
.cand-prog:first-child { border-top: none; }
.cand-name { font-size: 13.5px; color: #333; }
.stage-dots { display: flex; align-items: center; gap: 5px; }
.stg { width: 22px; height: 5px; border-radius: 3px; background: #E4E4DF; transition: background .3s; }
.stg.fill { background: var(--green); }
.stg.active { background: #E0A800; animation: pulse 1.5s ease-in-out infinite; }
.stg-done { color: var(--green); font-weight: 800; font-size: 13px; margin-left: 2px; }
.cand-noshow { font-size: 12px; font-weight: 700; color: #C0392B; }
.confirm-inline { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.confirm-q { font-size: 13px; font-weight: 600; color: #C0392B; }
.manage-actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 18px; }
.check.gray { background: #999; }
.arrival-warn { color: #C0392B; font-weight: 700; font-size: 14px; text-align: center; max-width: 480px; margin-left: auto; margin-right: auto; }
.confirm-review + .arrival-warn { text-align: left; margin-left: 0; }


/* ============ night status banner ============ */
.night-status { display: flex; align-items: center; gap: 16px; padding: 18px 22px; border-radius: 16px; margin-bottom: 20px;
  border: 1.5px solid; position: relative; overflow: hidden; }
.night-status.ontime { background: linear-gradient(180deg, #F1F9EA, #E8F4DA); border-color: #A9CF7E; }
.night-status.slight { background: linear-gradient(180deg, #FFF8E8, #FFF1D4); border-color: #EBC97A; }
.night-status.behind { background: linear-gradient(180deg, #FDEEEC, #FBE0DC); border-color: #E8A79E; }
.ns-pulse { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; animation: pulse 1.6s ease-in-out infinite; }
.night-status.ontime .ns-pulse { background: #4CAF50; }
.night-status.slight .ns-pulse { background: #E0A800; }
.night-status.behind .ns-pulse { background: #C0392B; }
.ns-text { display: flex; flex-direction: column; }
.ns-text b { font-family: 'Space Grotesk', sans-serif; font-size: 20px; line-height: 1.1; }
.night-status.ontime .ns-text b { color: #1E7E34; }
.night-status.slight .ns-text b { color: #7A5B00; }
.night-status.behind .ns-text b { color: #C0392B; }
.ns-text span { font-size: 13px; color: #555; margin-top: 2px; }
.ns-clock { margin-left: auto; font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 22px; color: #333; font-variant-numeric: tabular-nums; }
.cc-window { font-size: 12px; color: #999; font-weight: 600; margin: -4px 0 8px; font-family: 'Space Grotesk', sans-serif; }
.cc-late { color: #C0392B; }

    `}</style>
  );
}
