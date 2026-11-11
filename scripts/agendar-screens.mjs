#!/usr/bin/env node
// /agendar (Sprint 1 F3) screenshots at 390 and 1440 against a mocked endpoint, so every
// state can be shown without a real booking. Needs `npx astro preview` on PORT (default 4329).
//   CHROME_SHELL=$(ls ~/.cache/ms-playwright/chromium_headless_shell-1248/*/chrome-headless-shell) \
//     node scripts/agendar-screens.mjs
// Output: .screens/agendar/*.png (gitignored).
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";

const r = createRequire("/home/jaypy/GitHub-Projects/Notes/ai-synthesizer/workspace/psiativa/projects/lead-scout/package.json");
const { chromium } = r("playwright");
const BASE = `http://127.0.0.1:${process.env.PORT || 4329}`;
const OUT = new URL("../.screens/agendar/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const slots = (dia, hours) => hours.map((h) => ({ starts_at: new Date(`${dia}T${h}:00-03:00`).toISOString() }));
const DIAS = [
  { dia: "2026-11-17", slots: slots("2026-11-17", ["09:00", "09:30", "10:00", "10:30", "11:00", "14:00", "14:30", "15:00", "16:30", "17:00"]) },
  { dia: "2026-11-18", slots: slots("2026-11-18", ["09:00", "10:00", "11:30", "15:00"]) },
  { dia: "2026-11-19", slots: slots("2026-11-19", ["09:30", "13:00", "17:30"]) },
  { dia: "2026-11-23", slots: slots("2026-11-23", ["09:00", "10:00"]) },
  { dia: "2026-12-01", slots: slots("2026-12-01", ["09:00"]) },
];
const HORARIOS = { ok: true, minutes: 15, timezone: "America/Sao_Paulo", dias: DIAS };

async function shot(browser, { name, width, lang = "pt", theme = "light", horarios = HORARIOS, agendar, steps, path = "/agendar/", handoff = null }) {
  const page = await browser.newPage({ viewport: { width, height: width < 600 ? 844 : 900 }, locale: lang === "pt" ? "pt-BR" : "en-US" });
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 160)));
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
  await page.addInitScript(([l, th, h]) => {
    localStorage.setItem("locuz-lang", l);
    if (th === "dark") localStorage.setItem("locuz-theme", "dark");
    if (h) sessionStorage.setItem("locuz-handoff", JSON.stringify(h));
  }, [lang, theme, handoff]);
  const sent = [];
  await page.route("**/webhook/locuz-agenda", async (route) => {
    const body = JSON.parse(route.request().postData() || "{}");
    sent.push(body);
    const answer = body.op === "horarios" ? horarios : agendar;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(answer) });
  });
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  await page.waitForSelector('#ag[data-step]:not([data-step="loading"])');
  for (const step of steps || []) await step(page);
  await page.evaluate(() => window.scrollTo(0, 0)); // the fixed navbar would cover the card mid-page
  await page.waitForTimeout(300);
  const waText = await page.$eval("#ag-wa", (a) => (a.hidden ? null : new URL(a.href).searchParams.get("text"))).catch(() => null);
  if (waText) console.log(JSON.stringify({ name, wa: waText }));
  await page.screenshot({ path: `${OUT}${name}.png`, fullPage: true });
  console.log(JSON.stringify({ name, step: await page.getAttribute("#ag", "data-step"), sent: sent.map((s) => s.op === "agendar" ? s : s.op), errors }));
  await page.close();
}

const pickDay = (dia) => (p) => p.click(`.ag-day[aria-label*="${dia}"], .ag-day >> text="${Number(dia.slice(-2))}"`);
const pickSlot = (p) => p.click(".ag-slot >> nth=2");
const fill = (name, phone, email) => async (p) => {
  await p.fill("#ag-name", name);
  await p.fill("#ag-phone", phone);
  await p.fill("#ag-email", email);
};
const submit = (p) => p.click("#ag-submit");
const done = { ok: true, meeting_id: 9, starts_at: DIAS[0].slots[2].starts_at, ends_at: "", label: "", meet_url: "https://meet.google.com/abc-defg-hij" };

const browser = await chromium.launch({ executablePath: process.env.CHROME_SHELL });
for (const width of [390, 1440]) {
  await shot(browser, { name: `${width}-1-calendar-pt`, width, steps: [pickDay("2026-11-17")] });
  await shot(browser, { name: `${width}-2-form-errors-pt`, width, steps: [pickDay("2026-11-17"), pickSlot, fill("A", "9999", "ana@"), submit] });
  await shot(browser, { name: `${width}-3-done-pt`, width, agendar: done,
    steps: [pickDay("2026-11-17"), pickSlot, fill("Ana Souza", "(21) 96519-2607", "Ana@Empresa.com"), submit] });
  await shot(browser, { name: `${width}-4-calendar-en-dark`, width, lang: "en", theme: "dark", steps: [pickDay("2026-11-17")] });
  await shot(browser, { name: `${width}-5-stop-vazio-pt`, width, horarios: { ok: true, dias: [] } });
  await shot(browser, { name: `${width}-6-slot-taken-pt`, width, agendar: { ok: false, reason: "slot_taken" },
    steps: [pickDay("2026-11-17"), pickSlot, fill("Ana Souza", "21965192607", ""), submit] });
  // F5 + screen edits
  await shot(browser, { name: `${width}-7-form-pt`, width, steps: [pickDay("2026-11-17"), pickSlot] });
  const soon = { ...done, starts_at: new Date(Date.now() + 5 * 60_000).toISOString() };
  await shot(browser, { name: `${width}-8-done-join-pt`, width, agendar: soon,
    steps: [pickDay("2026-11-17"), pickSlot, fill("Ana Souza", "(21) 96519-2607", ""), submit] });
  await shot(browser, { name: `${width}-9-from-contato-pt`, width, path: "/agendar/?ref=k3f9q2xa", agendar: done,
    handoff: { ref: "k3f9q2xa", name: "Ana Souza", phone: "(21) 96519-2607", email: "ana@empresa.com", briefing: { orcamento: "R$ 51.000 a R$ 100.000", prazo: "1 mês" } },
    steps: [pickDay("2026-11-17"), pickSlot, submit] });
}
await browser.close();
