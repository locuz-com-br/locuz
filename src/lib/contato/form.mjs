// locuz /contato (Sprint 1 F4) — pure page logic, no DOM. Tested by form.test.mjs.
// The n8n workflow "Locuz — Captura de Leads" (56UeoGwmQskgDNUF) owns every rule
// (lead-capture/CONTEXT.md §4–5); this only shapes the request and reads the answer.

import { normalizePhone, validName, validEmail } from "../agenda/page.mjs";

export { normalizePhone, validName, validEmail };

// Each option sends its PT label VERBATIM (db_sales stores what it receives, and the
// workflow derives esteira_rung from the numbers in `budget`); `en` is display only.
// ⚠️ Headcount middle bands are Claude's reading of "0-10 … +1000" (8 bands, the
// Notion spec is not in the repo): fix the labels here, nothing else depends on them.
export const HEADCOUNT = [
  { pt: "0 a 10", en: "0 to 10" },
  { pt: "11 a 25", en: "11 to 25" },
  { pt: "26 a 50", en: "26 to 50" },
  { pt: "51 a 100", en: "51 to 100" },
  { pt: "101 a 250", en: "101 to 250" },
  { pt: "251 a 500", en: "251 to 500" },
  { pt: "501 a 1000", en: "501 to 1,000" },
  { pt: "Mais de 1000", en: "More than 1,000" },
];

export const BUDGET = [
  { pt: "R$ 1.000 a R$ 10.000", en: "R$ 1,000 to R$ 10,000" },
  { pt: "R$ 11.000 a R$ 20.000", en: "R$ 11,000 to R$ 20,000" },
  { pt: "R$ 21.000 a R$ 50.000", en: "R$ 21,000 to R$ 50,000" },
  { pt: "R$ 51.000 a R$ 100.000", en: "R$ 51,000 to R$ 100,000" },
  { pt: "Acima de R$ 100.000", en: "Above R$ 100,000" },
];

export const DEADLINE = [
  { pt: "3 dias", en: "3 days" },
  { pt: "1 semana", en: "1 week" },
  { pt: "1 mês", en: "1 month" },
  { pt: "Acompanhamento", en: "Ongoing support" },
  {
    pt: "Estou com muita pressa e sei que para projetos em tempo recorde, terei de pagar mais",
    en: "I'm in a real hurry and I know record-time projects cost more",
  },
  { pt: "Prazo não é problema", en: "Timing is not an issue" },
];

/** The steps in order; `contact` is last so the visitor commits before giving data. */
export const STEPS = ["project", "headcount", "budget", "deadline", "contact"];

export const validProject = (raw) => {
  const v = String(raw || "").trim();
  return v.length >= 3 && v.length <= 2000;
};

const pick = (list, i) => (Number.isInteger(i) && list[i] ? list[i].pt : null);

/** The `locuz-capture` request (source contact_page). Throws on a missing choice. */
export function captureBody({ project, headcount, budget, deadline, name, phone, email, token, ref }) {
  const body = {
    source: "contact_page",
    name: String(name || "").trim(),
    phone: normalizePhone(phone) || "",
    project_type: String(project || "").trim(),
    headcount: pick(HEADCOUNT, headcount),
    budget: pick(BUDGET, budget),
    deadline: pick(DEADLINE, deadline),
    consent: true,
  };
  for (const k of ["headcount", "budget", "deadline"]) if (!body[k]) throw new Error(`missing ${k}`);
  const mail = String(email || "").trim();
  if (mail) body.email = mail.toLowerCase();
  if (token) body["h-captcha-response"] = token;
  if (ref) body.source_detail = `ref:${String(ref).slice(0, 64)}`;
  return body;
}

/**
 * Map the webhook's answer to what the page does next (CONTEXT.md §5):
 * sent · fallback (5xx / network / timeout → Web3Forms) · invalido (400) · captcha (403) · erro.
 * The body is part of the success contract: a 200 without ok:true is not a send.
 */
export function outcome(status, body) {
  if (status === 200 && body?.ok === true) return "sent";
  if (status === 0 || (status >= 500 && status <= 599)) return "fallback";
  if (status === 400) return "invalido";
  if (status === 403) return "captcha";
  return "erro";
}

/** POST to n8n, then Web3Forms only on `fallback`. Returns sent | invalido | captcha | erro. */
export async function submit(body, { endpoint, web3formsKey, fetchImpl = fetch, timeoutMs = 8000 }) {
  let status = 0;
  let data = null;
  if (endpoint) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      status = res.status;
      data = await res.json().catch(() => null);
    } catch {
      status = 0;
    } finally {
      clearTimeout(timer);
    }
  }
  const result = outcome(status, data);
  if (result !== "fallback") return result;
  if (!web3formsKey) return "erro";
  try {
    const res = await fetchImpl("https://api.web3forms.com/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ ...body, access_key: web3formsKey, subject: "Novo projeto — locuz.com.br/contato", fallback: true }),
    });
    const ok = await res.json().catch(() => null);
    return res.ok && ok?.success === true ? "sent" : "erro";
  } catch {
    return "erro";
  }
}
