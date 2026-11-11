import { test } from "node:test";
import assert from "node:assert/strict";
import { HEADCOUNT, BUDGET, DEADLINE, STEPS, captureBody, outcome, submit, validProject } from "./form.mjs";

// Copy of rung() from the live "Normalizar e Validar" node (56UeoGwmQskgDNUF, read 2026-11-10).
function rung(band) {
  if (!band) return "undeclared";
  const t = String(band).toLowerCase();
  const nums = t.replace(/\./g, "").match(/\d+/g);
  if (!nums) return "undeclared";
  const vals = nums.map(Number).filter((n) => n > 0);
  if (!vals.length) return "undeclared";
  const aberta = /acima|mais de|superior|\+|>/.test(t);
  const ref = aberta ? Math.max(...vals) + 1 : Math.max(...vals);
  if (ref <= 10000) return "tripwire";
  if (ref <= 100000) return "core";
  return "high_ticket";
}

const base = { project: "Refazer o site", headcount: 1, budget: 3, deadline: 5, name: " Ana Souza ", phone: "(21) 98888-7777" };

test("band counts match the spec: 8 headcount, 5 budget, 6 deadline", () => {
  assert.equal(HEADCOUNT.length, 8);
  assert.equal(BUDGET.length, 5);
  assert.equal(DEADLINE.length, 6);
  assert.deepEqual(STEPS.at(-1), "contact");
});

test("every budget label lands on the esteira rung the plan expects", () => {
  assert.deepEqual(BUDGET.map((b) => rung(b.pt)), ["tripwire", "core", "core", "core", "high_ticket"]);
});

test("the rush option keeps the spec's verbatim sentence", () => {
  assert.ok(DEADLINE.some((d) => d.pt === "Estou com muita pressa e sei que para projetos em tempo recorde, terei de pagar mais"));
});

test("captureBody sends PT labels verbatim, E.164 phone, trimmed name, no empty e-mail", () => {
  const body = captureBody(base);
  assert.deepEqual(body, {
    source: "contact_page",
    name: "Ana Souza",
    phone: "5521988887777",
    project_type: "Refazer o site",
    headcount: "11 a 25",
    budget: "R$ 51.000 a R$ 100.000",
    deadline: "Prazo não é problema",
    consent: true,
  });
});

test("captureBody adds e-mail (lowercased), captcha token and ref only when present", () => {
  const body = captureBody({ ...base, email: " Ana@Ex.com ", token: "tok", ref: "abc" });
  assert.equal(body.email, "ana@ex.com");
  assert.equal(body["h-captcha-response"], "tok");
  assert.equal(body.source_detail, "ref:abc");
});

test("captureBody refuses a missing or out-of-range choice", () => {
  assert.throws(() => captureBody({ ...base, budget: undefined }), /budget/);
  assert.throws(() => captureBody({ ...base, headcount: 8 }), /headcount/);
  assert.throws(() => captureBody({ ...base, deadline: -1 }), /deadline/);
});

test("validProject wants a few words, not an essay", () => {
  assert.equal(validProject("  "), false);
  assert.equal(validProject("ab"), false);
  assert.equal(validProject("Site novo"), true);
  assert.equal(validProject("x".repeat(2001)), false);
});

test("outcome reads the body, not just the status", () => {
  assert.equal(outcome(200, { ok: true }), "sent");
  assert.equal(outcome(200, { ok: false }), "erro");
  assert.equal(outcome(200, null), "erro");
  assert.equal(outcome(503, null), "fallback");
  assert.equal(outcome(0, null), "fallback");
  assert.equal(outcome(400, { ok: false }), "invalido");
  assert.equal(outcome(403, { ok: false }), "captcha");
  assert.equal(outcome(404, null), "erro");
});

const res = (status, json) => ({ status, ok: status >= 200 && status < 300, json: async () => json });

test("submit: n8n 200 ok → sent, Web3Forms never called", async () => {
  const calls = [];
  const r = await submit({ a: 1 }, { endpoint: "n8n", web3formsKey: "k", fetchImpl: async (u) => (calls.push(u), res(200, { ok: true })) });
  assert.equal(r, "sent");
  assert.deepEqual(calls, ["n8n"]);
});

test("submit: 503 → Web3Forms with fallback:true", async () => {
  const calls = [];
  const r = await submit({ a: 1 }, {
    endpoint: "n8n", web3formsKey: "k",
    fetchImpl: async (u, o) => (calls.push([u, JSON.parse(o.body)]), u === "n8n" ? res(503, null) : res(200, { success: true })),
  });
  assert.equal(r, "sent");
  assert.equal(calls[1][0], "https://api.web3forms.com/submit");
  assert.equal(calls[1][1].fallback, true);
  assert.equal(calls[1][1].a, 1);
});

test("submit: network error → fallback; fallback failure → erro", async () => {
  const r = await submit({}, { endpoint: "n8n", web3formsKey: "k", fetchImpl: async (u) => { if (u === "n8n") throw new TypeError("net"); return res(500, null); } });
  assert.equal(r, "erro");
});

test("submit: timeout aborts n8n and falls back", async () => {
  const r = await submit({}, {
    endpoint: "n8n", web3formsKey: "k", timeoutMs: 10,
    fetchImpl: (u, o) => u === "n8n"
      ? new Promise((_, rej) => o.signal.addEventListener("abort", () => rej(new Error("aborted"))))
      : Promise.resolve(res(200, { success: true })),
  });
  assert.equal(r, "sent");
});

test("submit: 400 and 403 never fall back", async () => {
  for (const [status, want] of [[400, "invalido"], [403, "captcha"]]) {
    const calls = [];
    const r = await submit({}, { endpoint: "n8n", web3formsKey: "k", fetchImpl: async (u) => (calls.push(u), res(status, { ok: false })) });
    assert.equal(r, want);
    assert.equal(calls.length, 1);
  }
});
