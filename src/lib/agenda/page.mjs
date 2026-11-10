// locuz /agendar (Sprint 1 F3) — pure page logic, no DOM. Tested by page.test.mjs.
// The n8n workflow "Locuz — Agenda (/agendar)" owns every rule; this only shapes the
// request and maps its answers to copy keys. Adapted from PsiAtiva's src/lib/agendar.ts.

const ZONE = "America/Sao_Paulo";

/** Brazilian number with DDD (10–11 digits), with or without +55 → "55" + digits, or null. */
export function normalizePhone(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.length >= 12 && d.startsWith("55")) d = d.slice(2);
  if (!/^[1-9]{2}9?\d{8}$/.test(d)) return null;
  if (d.length === 11 && d[2] !== "9") return null;
  return "55" + d;
}

export const validName = (raw) => String(raw || "").trim().length >= 2;

/** Optional: empty is fine, anything typed must look like a real address. */
export const validEmail = (raw) => {
  const v = String(raw || "").trim();
  return !v || (v.length <= 160 && /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(v));
};

/** The `agendar` request. E-mail rides in the briefing (no column for it in db_locuz). */
export function bookingBody({ startsAt, name, phone, email, ref }) {
  const body = { op: "agendar", starts_at: startsAt, lead_name: String(name || "").trim(), phone: normalizePhone(phone) || "" };
  const mail = String(email || "").trim();
  if (mail) body.briefing = { email: mail.toLowerCase() };
  if (ref) body.ref = String(ref).slice(0, 64);
  return body;
}

/** Every refusal the workflow or agenda.book() can send, each with its own text in `agendar.st.*`. */
const REFUSALS = new Set(["slot_taken", "ja_agendado", "ja_agendado_ip", "limite", "desligado", "invalido", "calendar_error"]);
/** States that end the flow with WhatsApp as the one way forward. */
export const STOP_STATES = new Set(["vazio", "ja_agendado", "ja_agendado_ip", "limite", "desligado", "calendar_error", "indisponivel"]);

/** Map an answer to an `agendar.st.*` key. `ip_ausente` is shown as `invalido`; anything unknown is `indisponivel`. */
export function refusalKey(answer) {
  const raw = String(answer?.reason ?? "");
  if (raw === "ip_ausente") return "invalido";
  return REFUSALS.has(raw) ? raw : "indisponivel";
}

function parts(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const get = (options) => new Intl.DateTimeFormat("en-US", { timeZone: ZONE, ...options }).format(date);
  return {
    date,
    hour: Number(get({ hour: "numeric", hourCycle: "h23" })),
    minute: Number(get({ minute: "numeric" })),
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get({ weekday: "short" })),
    day: get({ day: "2-digit" }),
    month: get({ month: "2-digit" }),
  };
}

/** "10h" / "10h30" (PT) or "10:00" / "10:30" (EN), Brasília time. */
export function hourLabel(iso, lang) {
  const p = parts(iso);
  if (!p) return "";
  const mm = String(p.minute).padStart(2, "0");
  return lang === "pt" ? `${p.hour}h${p.minute ? mm : ""}` : `${p.hour}:${mm}`;
}

const PT_DAYS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const EN_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "terça, 17/11" (PT) or "Tuesday, 11/17" (EN). `dia` is the endpoint's YYYY-MM-DD. */
export function dayLabel(dia, lang) {
  const p = parts(`${dia}T12:00:00-03:00`);
  if (!p) return dia;
  return lang === "pt" ? `${PT_DAYS[p.weekday]}, ${p.day}/${p.month}` : `${EN_DAYS[p.weekday]}, ${p.month}/${p.day}`;
}

/** "novembro 2026" / "November 2026". `mes` is YYYY-MM. */
export function monthLabel(mes, lang) {
  const [y, m] = String(mes).split("-").map(Number);
  if (!y || !m) return mes;
  return new Intl.DateTimeFormat(lang === "pt" ? "pt-BR" : "en-US", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(y, m - 1, 15)))
    .replace(" de ", " ");
}

/** Calendar column heads, Sunday first. */
export const weekdayInitials = (lang) =>
  lang === "pt" ? ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"] : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "terça, 17/11 às 10h" / "Tuesday, 11/17 at 10:00". */
export function slotLabel(iso, lang) {
  const p = parts(iso);
  if (!p) return "";
  const dia = p.date.toLocaleDateString("en-CA", { timeZone: ZONE });
  return `${dayLabel(dia, lang)} ${lang === "pt" ? "às" : "at"} ${hourLabel(iso, lang)}`;
}

/**
 * Month grid cells for `mes` (YYYY-MM): leading blanks for a Sunday-first week, then one
 * cell per day, `open` when the endpoint offered at least one slot that day.
 */
export function monthCells(mes, openDays) {
  const [y, m] = mes.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells = Array.from({ length: first }, () => null);
  for (let d = 1; d <= days; d++) {
    const dia = `${mes}-${String(d).padStart(2, "0")}`;
    cells.push({ dia, day: d, open: openDays.has(dia) });
  }
  return cells;
}

/** `{nome}`-style placeholders. The caller sets textContent, never innerHTML. */
export const fill = (template, vars = {}) => String(template).replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? "");

/** Pre-filled WhatsApp text for each stop state, PT always: it is what the team receives. */
const WA_TEXT = {
  done: "Olá! Acabei de agendar um bate-papo pelo site.",
  vazio: "Olá! Quis agendar um bate-papo pelo site, mas não achei horário livre. Podemos combinar por aqui?",
  ja_agendado: "Olá! Já tenho um bate-papo agendado pelo site e queria falar sobre ele.",
  ja_agendado_ip: "Olá! Já tenho um bate-papo agendado pelo site e queria falar sobre ele.",
};
const WA_FALLBACK = "Olá! Tentei agendar um bate-papo pelo site e não consegui. Podemos combinar por aqui?";

/** `base` is the site's wa.me link; only its `text` changes. */
export function waHref(base, key) {
  let url;
  try { url = new URL(base); } catch { return base; }
  url.searchParams.set("text", WA_TEXT[key] || WA_FALLBACK);
  return url.toString();
}
