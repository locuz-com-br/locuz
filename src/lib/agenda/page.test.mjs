// npm run test:agenda
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizePhone, validName, validEmail, bookingBody, refusalKey, STOP_STATES,
  hourLabel, dayLabel, monthLabel, slotLabel, monthCells, fill, waHref,
} from "./page.mjs";

test("normalizePhone accepts Brazilian numbers with DDD, with or without +55", () => {
  assert.equal(normalizePhone("(21) 96519-2607"), "5521965192607");
  assert.equal(normalizePhone("+55 21 96519-2607"), "5521965192607");
  assert.equal(normalizePhone("21 3333-4444"), "552133334444");
  for (const bad of ["", "96519-2607", "(01) 96519-2607", "21 86519-26070", "+1 415 555 0100"]) {
    assert.equal(normalizePhone(bad), null, bad);
  }
});

test("name and optional e-mail", () => {
  assert.equal(validName(" A "), false);
  assert.equal(validName("Ana"), true);
  assert.equal(validEmail(""), true);
  assert.equal(validEmail("ana@empresa.com.br"), true);
  for (const bad of ["ana", "ana@", "ana@empresa", "a na@x.com", "ana@x..com"]) assert.equal(validEmail(bad), false, bad);
});

test("bookingBody: e-mail rides in the briefing, lowercased; no briefing without it", () => {
  const b = bookingBody({ startsAt: "2026-11-17T13:00:00.000Z", name: " Ana ", phone: "(21) 96519-2607", email: " Ana@Empresa.com " });
  assert.deepEqual(b, { op: "agendar", starts_at: "2026-11-17T13:00:00.000Z", lead_name: "Ana", phone: "5521965192607",
    briefing: { email: "ana@empresa.com" } });
  assert.equal("briefing" in bookingBody({ startsAt: "x", name: "Ana", phone: "21965192607", email: "" }), false);
});

test("refusalKey maps every known refusal and falls back to indisponivel", () => {
  for (const r of ["slot_taken", "ja_agendado", "ja_agendado_ip", "limite", "desligado", "invalido", "calendar_error"]) {
    assert.equal(refusalKey({ ok: false, reason: r }), r);
  }
  assert.equal(refusalKey({ reason: "ip_ausente" }), "invalido");
  assert.equal(refusalKey({ reason: "something_new" }), "indisponivel");
  assert.equal(refusalKey(null), "indisponivel");
  assert.ok(STOP_STATES.has("calendar_error") && !STOP_STATES.has("slot_taken") && !STOP_STATES.has("invalido"));
});

test("labels are Brasília time in both languages", () => {
  assert.equal(hourLabel("2026-11-17T13:00:00.000Z", "pt"), "10h");
  assert.equal(hourLabel("2026-11-17T13:30:00.000Z", "pt"), "10h30");
  assert.equal(hourLabel("2026-11-17T13:30:00.000Z", "en"), "10:30");
  assert.equal(dayLabel("2026-11-17", "pt"), "terça, 17/11");
  assert.equal(dayLabel("2026-11-17", "en"), "Tuesday, 11/17");
  assert.equal(monthLabel("2026-11", "pt"), "novembro 2026");
  assert.equal(monthLabel("2026-11", "en"), "November 2026");
  assert.equal(slotLabel("2026-11-17T13:00:00.000Z", "pt"), "terça, 17/11 às 10h");
  assert.equal(slotLabel("2026-11-17T23:30:00.000Z", "en"), "Tuesday, 11/17 at 20:30");
});

test("monthCells: Sunday-first blanks and open days", () => {
  const cells = monthCells("2026-11", new Set(["2026-11-17"]));
  assert.equal(cells[0].dia, "2026-11-01"); // 1 Nov 2026 is a Sunday
  assert.equal(cells.length, 30);
  assert.deepEqual(cells.filter(c => c?.open).map(c => c.dia), ["2026-11-17"]);
  const dec = monthCells("2026-12", new Set());
  assert.equal(dec.slice(0, 2).every(c => c === null), true); // 1 Dec 2026 is a Tuesday
});

test("fill and waHref", () => {
  assert.equal(fill("Até {quando}, {nome}!", { nome: "Ana", quando: "terça" }), "Até terça, Ana!");
  const href = waHref("https://wa.me/5521965192607", "vazio");
  assert.match(new URL(href).searchParams.get("text"), /não achei horário livre/);
  assert.equal(waHref("not a url", "vazio"), "not a url");
  // The confirmation screen must not pre-fill a failure message.
  assert.equal(new URL(waHref("https://wa.me/1", "done")).searchParams.get("text"), "Olá! Acabei de agendar um bate-papo pelo site.");
});

// ── F5 ──
import { newRef, validRef, saveHandoff, readHandoff, meetAction } from "./page.mjs";

const memStorage = () => { const m = new Map(); return { setItem: (k, v) => m.set(k, v), getItem: (k) => m.get(k) ?? null }; };

test("newRef is 8 chars from a lookalike-free alphabet and passes validRef", () => {
  const ref = newRef();
  assert.match(ref, /^[a-hjkmnp-z2-9]{8}$/);
  assert.ok(validRef(ref));
  assert.equal(validRef("../x"), false);
  assert.equal(validRef(""), false);
});

test("readHandoff returns the saved data only for its own ref", () => {
  const s = memStorage();
  saveHandoff(s, { ref: "abc12345", name: "Ana" });
  assert.equal(readHandoff(s, "abc12345").name, "Ana");
  assert.equal(readHandoff(s, "zzz99999"), null);
  assert.equal(readHandoff(s, "bad ref"), null);
  assert.equal(readHandoff({ getItem: () => { throw new Error("blocked"); } }, "abc12345"), null);
  saveHandoff({ setItem: () => { throw new Error("blocked"); } }, { ref: "x" }); // must not throw
});

test("meetAction: copy until 10 min before, join until the end, copy after", () => {
  const start = "2026-11-17T13:00:00.000Z";
  const at = (iso) => Date.parse(iso);
  assert.equal(meetAction(start, 15, at("2026-11-17T12:49:59Z")), "copy");
  assert.equal(meetAction(start, 15, at("2026-11-17T12:50:00Z")), "join");
  assert.equal(meetAction(start, 15, at("2026-11-17T13:14:59Z")), "join");
  assert.equal(meetAction(start, 15, at("2026-11-17T13:15:00Z")), "copy");
  assert.equal(meetAction("nope", 15), "copy");
});

test("bookingBody merges a /contato briefing with the e-mail", () => {
  const body = bookingBody({ startsAt: "x", name: "Ana", phone: "21965192607", email: "A@b.co", ref: "abc12345", briefing: { orcamento: "R$ 51.000 a R$ 100.000" } });
  assert.deepEqual(body.briefing, { orcamento: "R$ 51.000 a R$ 100.000", email: "a@b.co" });
  assert.equal(body.ref, "abc12345");
  assert.equal(bookingBody({ startsAt: "x", name: "Ana", phone: "21965192607" }).briefing, undefined);
});
