// Runs the generated n8n Code nodes against fake inputs: npm run test:agenda
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const wf = JSON.parse(execFileSync(process.execPath, [new URL("./n8n-agenda-workflow.mjs", import.meta.url).pathname]));
const codeOf = (name) => wf.nodes.find((n) => n.name === name).parameters.jsCode;
const cfg = {
  ativa: true, timezone: "America/Sao_Paulo", calendar_id: "contato@locuz.com.br",
  busy_calendars: ["contato@locuz.com.br", "contato@psiativa.com.br"],
  window: { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" },
  horizon_days: 10, slot_step_minutes: 30, meeting_minutes: 15, min_notice_hours: 2,
};
function run(name, outputs, env = {}) {
  const $ = (n) => ({ first: () => ({ json: outputs[n] }) });
  const fn = new Function("$", "$env", "require", codeOf(name));
  return fn($, env, createRequire(import.meta.url))[0].json;
}

test("Preparar entrada fails closed without config or salt, and hashes the IP", () => {
  const hook = { body: { op: "horarios" }, headers: { "cf-connecting-ip": "1.2.3.4" } };
  assert.throws(() => run("Preparar entrada", { "Webhook público": hook, "Ler configuração": {} }, { AGENDA_IP_SALT: "s" }));
  assert.throws(() => run("Preparar entrada", { "Webhook público": hook, "Ler configuração": { cfg } }, {}));
  const e = run("Preparar entrada", { "Webhook público": hook, "Ler configuração": { cfg } }, { AGENDA_IP_SALT: "s" });
  assert.equal(e.reason, "");
  assert.match(e.ip_hash, /^[0-9a-f]{64}$/);
  const off = run("Preparar entrada", { "Webhook público": hook, "Ler configuração": { cfg: { ...cfg, ativa: false } } }, { AGENDA_IP_SALT: "s" });
  assert.equal(off.reason, "desligado");
});

test("Preparar entrada keeps only flat briefing fields, trimmed", () => {
  const hook = { body: { op: "agendar", briefing: { projeto: "x".repeat(900), nested: { a: 1 }, n: 3 } }, headers: {} };
  const e = run("Preparar entrada", { "Webhook público": hook, "Ler configuração": { cfg } }, { AGENDA_IP_SALT: "s" });
  assert.deepEqual(Object.keys(e.briefing), ["projeto", "n"]);
  assert.equal(e.briefing.projeto.length, 500);
});

test("Calcular horários fails closed when one calendar errors, and labels slots in Portuguese", () => {
  const base = { "Preparar entrada": { cfg }, "Ocupado no banco": { busy: [] } };
  const bad = run("Calcular horários", { ...base, "Ocupado no Google": { calendars: {
    "contato@locuz.com.br": { busy: [] }, "contato@psiativa.com.br": { errors: [{ reason: "notFound" }] } } } });
  assert.deepEqual(bad, { ok: false, reason: "calendar_error", detail: ["contato@psiativa.com.br"] });
  const ok = run("Calcular horários", { ...base, "Ocupado no Google": { calendars: {
    "contato@locuz.com.br": { busy: [] }, "contato@psiativa.com.br": { busy: [] } } } });
  assert.equal(ok.ok, true);
  const s = ok.dias[0].slots[0];
  assert.match(s.label, /^(segunda|terça|quarta|quinta|sexta), \d{2}\/\d{2} às \d{2}:(00|30)$/);
});

test("Montar horário accepts only a time the page could offer", () => {
  const offered = run("Calcular horários", { "Preparar entrada": { cfg }, "Ocupado no banco": { busy: [] },
    "Ocupado no Google": { calendars: { "contato@locuz.com.br": { busy: [] }, "contato@psiativa.com.br": { busy: [] } } } })
    .dias[0].slots[0].starts_at;
  const ok = run("Montar horário", { "Preparar entrada": { cfg, starts_at: offered } });
  assert.equal(ok.valido, true);
  assert.equal(Date.parse(ok.ends_at) - Date.parse(ok.starts_at), 15 * 60000);
  const offGrid = new Date(Date.parse(offered) + 10 * 60000).toISOString();
  assert.equal(run("Montar horário", { "Preparar entrada": { cfg, starts_at: offGrid } }).valido, false);
  assert.equal(run("Montar horário", { "Preparar entrada": { cfg, starts_at: "amanhã" } }).valido, false);
});
