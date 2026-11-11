#!/usr/bin/env node
// /contato (Sprint 1 F4) screenshots at 390 and 1440 against a mocked capture webhook and a
// fake hCaptcha (solved on render), so every state shows without a real lead.
// Needs `npx astro preview` on PORT (default 4329).
//   CHROME_SHELL=$(ls ~/.cache/ms-playwright/chromium_headless_shell-1248/*/chrome-headless-shell) \
//     node scripts/contato-screens.mjs
// Output: .screens/contato/*.png (gitignored).
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";

const r = createRequire("/home/jaypy/GitHub-Projects/Notes/ai-synthesizer/workspace/psiativa/projects/lead-scout/package.json");
const { chromium } = r("playwright");
const BASE = `http://127.0.0.1:${process.env.PORT || 4329}`;
const OUT = new URL("../.screens/contato/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

async function shot(browser, { name, width, lang = "pt", theme = "light", capture = [200, { ok: true, lead_id: "LOCUZ-0001" }], web3 = [200, { success: true }], steps }) {
  const page = await browser.newPage({ viewport: { width, height: width < 600 ? 844 : 900 }, locale: lang === "pt" ? "pt-BR" : "en-US" });
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 160)));
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
  await page.addInitScript(([l, th]) => {
    localStorage.setItem("locuz-lang", l);
    if (th === "dark") localStorage.setItem("locuz-theme", "dark");
    window.hcaptcha = {
      render: (id, o) => {
        const box = document.getElementById(id);
        box.textContent = "[hCaptcha ✓]";
        box.style.cssText = "border:1px dashed #999;padding:1.5rem;border-radius:8px;width:300px;font:14px sans-serif";
        setTimeout(() => o.callback("fake-token"), 0);
        return "w1";
      },
      reset: () => {},
    };
  }, [lang, theme]);
  const sent = [];
  await page.route("**/webhook/locuz-capture", async (route) => {
    sent.push(["n8n", JSON.parse(route.request().postData() || "{}")]);
    await route.fulfill({ status: capture[0], contentType: "application/json", body: JSON.stringify(capture[1]) });
  });
  await page.route("https://api.web3forms.com/**", async (route) => {
    sent.push(["web3forms", JSON.parse(route.request().postData() || "{}").fallback]);
    await route.fulfill({ status: web3[0], contentType: "application/json", body: JSON.stringify(web3[1]) });
  });
  await page.goto(`${BASE}/contato/`, { waitUntil: "networkidle" });
  for (const step of steps || []) await step(page);
  await page.evaluate(() => window.scrollTo(0, 0)); // the fixed navbar would cover the card mid-page
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}${name}.png`, fullPage: true });
  console.log(JSON.stringify({ name, step: await page.getAttribute("#ct", "data-step"), sent, errors }));
  await page.close();
}

const next = (p) => p.click("#ct-next");
const project = (text) => async (p) => { await p.fill("#ct-project", text); await next(p); };
const choose = (key, i) => async (p) => { await p.click(`.ct-step[data-step="${key}"] .ct-option >> nth=${i}`); await p.waitForTimeout(350); };
const contact = (name, phone, email) => async (p) => {
  await p.fill("#ct-name", name);
  await p.fill("#ct-phone", phone);
  await p.fill("#ct-email", email);
};
const toContact = [project("Refazer o site e atrair clientes pelo Google"), choose("headcount", 1), choose("budget", 3), choose("deadline", 4)];
const ana = contact("Ana Souza", "(21) 96519-2607", "Ana@Empresa.com");

const browser = await chromium.launch({ executablePath: process.env.CHROME_SHELL });
for (const width of [390, 1440]) {
  await shot(browser, { name: `${width}-1-project-pt`, width });
  await shot(browser, { name: `${width}-2-project-error-pt`, width, steps: [next] });
  await shot(browser, { name: `${width}-3-budget-pt`, width, steps: [project("Site novo"), choose("headcount", 1)] });
  await shot(browser, { name: `${width}-4-deadline-pt`, width, steps: [project("Site novo"), choose("headcount", 1), choose("budget", 3)] });
  await shot(browser, { name: `${width}-5-contact-errors-pt`, width, steps: [...toContact, contact("A", "9999", "ana@"), next] });
  await shot(browser, { name: `${width}-6-done-pt`, width, steps: [...toContact, ana, next] });
  await shot(browser, { name: `${width}-7-headcount-en-dark`, width, lang: "en", theme: "dark", steps: [project("New website")] });
  await shot(browser, { name: `${width}-8-fallback-done-pt`, width, capture: [503, { ok: false, error: "storage_unavailable" }], steps: [...toContact, ana, next] });
  await shot(browser, { name: `${width}-9-error-pt`, width, capture: [503, null], web3: [500, { success: false }], steps: [...toContact, ana, next] });
}
await browser.close();
