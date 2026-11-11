#!/usr/bin/env node
// Builds the n8n workflow "Locuz — Agenda (/agendar)" (Sprint 1 F2) as JSON.
// The slot engine is pasted from src/lib/agenda/slots.mjs, so the workflow and
// the tested module never drift.
//   node scripts/n8n-agenda-workflow.mjs > n8n/locuz-agenda.workflow.json
import { readFileSync } from "node:fs";

const slotsLib = readFileSync(new URL("../src/lib/agenda/slots.mjs", import.meta.url), "utf8")
  .replace(/^export /gm, "");

const CRED = {
  locuzPg: { postgres: { id: "WSysCzkLNjcuvF56", name: "Locuz — Postgres (db_locuz)" } },
  psiativaPg: { postgres: { id: "eRNTHOZXD6Sr89wF", name: "PsiAtiva — Postgres (db_psiativa)" } },
  locuzCal: { googleCalendarOAuth2Api: { id: "rMy21Jaj01t3D170", name: "Locuz — Google Calendar" } },
};

let x = 0;
const node = (name, type, typeVersion, parameters, extra = {}) =>
  ({ id: crypto.randomUUID(), name, type, typeVersion, position: [(x += 220), 0], parameters, ...extra });
const code = (name, jsCode) => node(name, "n8n-nodes-base.code", 2, { jsCode });
const pg = (name, query, replacement, cred = CRED.locuzPg) => node(name, "n8n-nodes-base.postgres", 2.6,
  { operation: "executeQuery", query, options: replacement ? { queryReplacement: replacement } : {} },
  { credentials: cred, onError: "continueRegularOutput", alwaysOutputData: true });
const iff = (name, leftValue) => node(name, "n8n-nodes-base.if", 2.3, {
  conditions: {
    options: { version: 2, leftValue: "", caseSensitive: true, typeValidation: "strict" },
    conditions: [{ id: crypto.randomUUID(), leftValue, operator: { type: "boolean", operation: "equals" }, rightValue: true }],
    combinator: "and",
  },
  options: {},
});
const freeBusy = (name, body) => node(name, "n8n-nodes-base.httpRequest", 4.2, {
  method: "POST", url: "https://www.googleapis.com/calendar/v3/freeBusy",
  authentication: "predefinedCredentialType", nodeCredentialType: "googleCalendarOAuth2Api",
  sendBody: true, specifyBody: "json", jsonBody: body, options: { timeout: 15000 },
}, { credentials: CRED.locuzCal, onError: "continueErrorOutput" });

const LABEL = `const rotulo = (ms, tz) => { const p = Object.fromEntries(new Intl.DateTimeFormat('pt-BR', { timeZone: tz, weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).map(x => [x.type, x.value])); return p.weekday.replace('-feira', '') + ', ' + p.day + '/' + p.month + ' às ' + p.hour + ':' + p.minute; };`;

const nodes = [
  node("Webhook público", "n8n-nodes-base.webhook", 2.1, {
    httpMethod: "POST", path: "locuz-agenda", responseMode: "responseNode",
    options: { allowedOrigins: "https://locuz.com.br,https://www.locuz.com.br" },
  }, { webhookId: crypto.randomUUID() }),
  pg("Ler configuração", "SELECT jsonb_object_agg(key, value) AS cfg FROM agenda.settings"),
  code("Preparar entrada", `// Input contract: { op: 'horarios' | 'agendar' | 'link_info', starts_at?, phone?, lead_name?, token?, briefing?, ref? }
const raw = $('Webhook público').first().json;
const body = raw.body && typeof raw.body === 'object' ? raw.body : {};
const cfg = $('Ler configuração').first().json.cfg;
if (!cfg || typeof cfg.ativa !== 'boolean') throw new Error('agenda.settings indisponível: /agendar bloqueado');
const salt = String($env.AGENDA_IP_SALT || '');
if (!salt) throw new Error('AGENDA_IP_SALT ausente: /agendar bloqueado');
const headers = raw.headers || {};
const ip = String(headers['cf-connecting-ip'] || '').trim() || String(headers['x-forwarded-for'] || '').split(',')[0].trim() || null;
const ip_hash = ip ? require('crypto').createHmac('sha256', salt).update(ip).digest('hex') : null;
const op = String(body.op || '').trim().toLowerCase();
const token = /^[0-9a-f]{64}$/.test(String(body.token || '')) ? String(body.token) : '';
let reason = '';
if (cfg.ativa !== true) reason = 'desligado';
else if (!['horarios', 'agendar', 'link_info'].includes(op)) reason = 'invalido';
else if (op === 'link_info' && !token) reason = 'link_invalido';
const rawBriefing = body.briefing && typeof body.briefing === 'object' && !Array.isArray(body.briefing) ? body.briefing : {};
const briefing = Object.fromEntries(Object.entries(rawBriefing).slice(0, 12)
  .filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v))
  .map(([k, v]) => [String(k).slice(0, 40), String(v).slice(0, 500)]));
return [{ json: {
  op, reason, cfg, ip_hash, token, origem: token ? 'link' : 'publico',
  phone: String(body.phone || '').replace(/\\D/g, '').slice(0, 20),
  lead_name: String(body.lead_name || '').trim().slice(0, 120),
  starts_at: String(body.starts_at || ''), ref: String(body.ref || '').slice(0, 64),
  briefing,
} }];`),
  iff("Entrada válida?", "={{ $json.reason === '' }}"),
  iff("É horários?", "={{ $json.op === 'horarios' }}"),
  iff("É agendar?", "={{ $json.op === 'agendar' }}"),

  // --- horarios
  freeBusy("Ocupado no Google", "={{ JSON.stringify({ timeMin: new Date().toISOString(), timeMax: new Date(Date.now() + ($json.cfg.horizon_days + 1) * 86400000).toISOString(), items: $json.cfg.busy_calendars.map(id => ({ id })) }) }}"),
  pg("Ocupado no banco", "SELECT coalesce(jsonb_agg(jsonb_build_object('start', b.starts_at, 'end', b.ends_at)), '[]'::jsonb) AS busy FROM agenda.busy(now(), now() + interval '15 days') b"),
  code("Calcular horários", `${slotsLib}
// --- glue (n8n)
${LABEL}
const e = $('Preparar entrada').first().json, cfg = e.cfg;
const g = $('Ocupado no Google').first().json.calendars || {};
const falhas = cfg.busy_calendars.filter(id => !g[id] || (g[id].errors || []).length);
if (falhas.length) return [{ json: { ok: false, reason: 'calendar_error', detail: falhas } }];
const busy = [...cfg.busy_calendars.flatMap(id => g[id].busy || []), ...($('Ocupado no banco').first().json.busy || [])]
  .map(b => ({ start: Date.parse(b.start), end: Date.parse(b.end) }));
const slots = availableSlots({ now: Date.now(), settings: cfg, busy });
const dia = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: cfg.timezone }).format(new Date(ms));
const dias = new Map();
for (const ms of slots) {
  if (!dias.has(dia(ms))) dias.set(dia(ms), []);
  dias.get(dia(ms)).push({ starts_at: new Date(ms).toISOString(), label: rotulo(ms, cfg.timezone) });
}
return [{ json: { ok: true, minutes: cfg.meeting_minutes, timezone: cfg.timezone,
  dias: [...dias].map(([d, lista]) => ({ dia: d, slots: lista })) } }];`),
  code("Falha no Google", `return [{ json: { ok: false, reason: 'calendar_error' } }];`),

  // --- agendar
  code("Montar horário", `${slotsLib}
// --- glue (n8n): the time must be one the page could have offered (grid, window, holiday, notice, horizon)
${LABEL}
const e = $('Preparar entrada').first().json, cfg = e.cfg;
const t = Date.parse(e.starts_at);
const valido = Number.isFinite(t) && availableSlots({ now: Date.now(), settings: cfg, busy: [] }).includes(t);
return [{ json: { valido, starts_at: valido ? new Date(t).toISOString() : '', ends_at: valido ? new Date(t + cfg.meeting_minutes * 60000).toISOString() : '',
  label: valido ? rotulo(t, cfg.timezone) : '' } }];`),
  iff("Horário válido?", "={{ $json.valido === true }}"),
  freeBusy("Conferir no Google", "={{ JSON.stringify({ timeMin: $json.starts_at, timeMax: $json.ends_at, items: $('Preparar entrada').first().json.cfg.busy_calendars.map(id => ({ id })) }) }}"),
  iff("Livre no Google?", "={{ $('Preparar entrada').first().json.cfg.busy_calendars.every(id => { const c = ($json.calendars || {})[id]; return !!c && !(c.errors || []).length && !(c.busy || []).length; }) }}"),
  pg("Reservar",
    "SELECT agenda.book(p->>'origem', (p->>'starts_at')::timestamptz, 'site:agendar', NULLIF(p->>'phone', ''), NULLIF(p->>'name', ''), NULLIF(p->>'token', ''), NULLIF(p->>'ip', ''), p->'briefing', NULLIF(p->>'ref', '')) AS r FROM (SELECT $1::jsonb AS p) x",
    "={{ JSON.stringify({ origem: $('Preparar entrada').first().json.origem, starts_at: $('Montar horário').first().json.starts_at, phone: $('Preparar entrada').first().json.phone, name: $('Preparar entrada').first().json.lead_name, token: $('Preparar entrada').first().json.token, ip: $('Preparar entrada').first().json.ip_hash, briefing: $('Preparar entrada').first().json.briefing, ref: $('Preparar entrada').first().json.ref }) }}"),
  iff("Reservou?", "={{ !!$json.r && $json.r.ok === true }}"),
  // A separate statement: one that also calls agenda.book() can't see the row book() inserts.
  pg("Ler reunião",
    "SELECT p->'r' AS r, m.phone, m.lead_name FROM (SELECT $1::jsonb AS p) x LEFT JOIN agenda.meetings m ON m.id = (p->'r'->>'meeting_id')::bigint",
    "={{ JSON.stringify({ r: $json.r }) }}"),
  node("Criar evento", "n8n-nodes-base.httpRequest", 4.2, {
    method: "POST",
    url: "=https://www.googleapis.com/calendar/v3/calendars/{{ encodeURIComponent($('Preparar entrada').first().json.cfg.calendar_id) }}/events?conferenceDataVersion=1&sendUpdates=none",
    authentication: "predefinedCredentialType", nodeCredentialType: "googleCalendarOAuth2Api",
    sendBody: true, specifyBody: "json",
    jsonBody: "={{ JSON.stringify({ summary: 'Bate-papo locuz' + ($json.lead_name ? ' — ' + $json.lead_name : ''), description: ['Bate-papo de ' + $('Preparar entrada').first().json.cfg.meeting_minutes + ' min, pelo Google Meet.', 'WhatsApp: +' + $json.phone, $('Preparar entrada').first().json.ref ? 'Ref: ' + $('Preparar entrada').first().json.ref : '', Object.keys($('Preparar entrada').first().json.briefing).length ? 'Briefing: ' + JSON.stringify($('Preparar entrada').first().json.briefing) : ''].filter(Boolean).join('\\n'), start: { dateTime: $('Montar horário').first().json.starts_at, timeZone: $('Preparar entrada').first().json.cfg.timezone }, end: { dateTime: $('Montar horário').first().json.ends_at, timeZone: $('Preparar entrada').first().json.cfg.timezone }, conferenceData: { createRequest: { requestId: 'locuz-' + $json.r.meeting_id + '-' + Date.now(), conferenceSolutionKey: { type: 'hangoutsMeet' } } }, extendedProperties: { private: { locuz_meeting_id: String($json.r.meeting_id) } }, reminders: { useDefault: true } }) }}",
    options: { timeout: 15000 },
  }, { credentials: CRED.locuzCal, onError: "continueErrorOutput" }),
  pg("Anexar evento",
    "SELECT agenda.attach_calendar_event((p->>'mid')::bigint, p->>'eid', NULLIF(p->>'meet', '')) AS a FROM (SELECT $1::jsonb AS p) x",
    "={{ JSON.stringify({ mid: $('Reservar').first().json.r.meeting_id, eid: $json.id, meet: $json.hangoutLink || ((($json.conferenceData || {}).entryPoints || []).find(e => e.entryPointType === 'video') || {}).uri || '' }) }}"),
  code("Montar aviso", `const e = $('Preparar entrada').first().json, h = $('Montar horário').first().json;
const r = $('Ler reunião').first().json, ev = $('Criar evento').first().json;
const meet = ev.hangoutLink || (((ev.conferenceData || {}).entryPoints || []).find(p => p.entryPointType === 'video') || {}).uri || '';
const b = e.briefing || {};
const linhas = [
  e.origem === 'link' ? '📅 *[locuz] Bate-papo agendado — link privado*' : '📅 *[locuz] Bate-papo agendado — página*',
  \`👤 \${r.lead_name || 'Sem nome'} · +\${r.phone}\`,
  \`💬 https://wa.me/\${r.phone}\`,
  \`🗓️ \${h.label} (\${e.cfg.meeting_minutes} min)\`,
  meet ? \`🎥 \${meet}\` : '⚠️ Sem link do Meet: confira o evento na agenda.',
  e.ref ? \`🔗 ref \${e.ref}\` : '',
  ...Object.entries(b).slice(0, 8).map(([k, v]) => \`• \${k}: \${String(v).slice(0, 200)}\`),
  b.orcamento ? '' : '📝 Briefing: ainda não (o link para /contato está na tela de confirmação)',
].filter(Boolean);
return [{ json: { texto: linhas.join('\\n'), adminPhone: String($env.PSIATIVA_ADMIN_PHONE || ''), ch: String($env.ZAPI_INSTANCE_ID || ''), meet } }];`),
  pg("Registrar aviso (Inbox PsiAtiva)",
    "SELECT inbox.register_outbound(x.p->>'channel', x.p->>'phone', 'automation', x.p->>'body', 'text', x.p->>'ref') AS message_id FROM (SELECT $1::jsonb AS p) x",
    "={{ JSON.stringify({ channel: $json.ch, phone: $json.adminPhone, body: $json.texto, ref: $workflow.id }) }}",
    CRED.psiativaPg),
  node("Enviar aviso via Z-API", "n8n-nodes-base.httpRequest", 4.4, {
    method: "POST",
    url: "=https://api.z-api.io/instances/{{ $env.ZAPI_INSTANCE_ID }}/token/{{ $env.ZAPI_TOKEN }}/send-text",
    sendHeaders: true,
    headerParameters: { parameters: [{ name: "Client-Token", value: "={{ $env.ZAPI_CLIENT_TOKEN }}" }, { name: "Content-Type", value: "application/json" }] },
    sendBody: true,
    bodyParameters: { parameters: [{ name: "phone", value: "={{ $('Montar aviso').first().json.adminPhone }}" }, { name: "message", value: "={{ $('Montar aviso').first().json.texto }}" }] },
    options: { timeout: 15000 },
  }, { onError: "continueRegularOutput" }),
  pg("Confirmar aviso (Inbox PsiAtiva)",
    "SELECT inbox.confirm_outbound((p->>'id')::bigint, NULLIF(p->>'pmid', ''), NULLIF(p->>'error', '')) AS r FROM (SELECT $1::jsonb AS p) x",
    "={{ JSON.stringify({ id: $('Registrar aviso (Inbox PsiAtiva)').first().json.message_id, pmid: $('Enviar aviso via Z-API').first().json.messageId || $('Enviar aviso via Z-API').first().json.zaapId || $('Enviar aviso via Z-API').first().json.id || '', error: $('Enviar aviso via Z-API').first().json.error ? JSON.stringify($('Enviar aviso via Z-API').first().json.error).slice(0, 500) : (($('Enviar aviso via Z-API').first().json.messageId || $('Enviar aviso via Z-API').first().json.zaapId || $('Enviar aviso via Z-API').first().json.id) ? '' : 'Z-API não devolveu id da mensagem') }) }}",
    CRED.psiativaPg),
  code("Sucesso", `const h = $('Montar horário').first().json, r = $('Reservar').first().json.r;
return [{ json: { ok: true, meeting_id: r.meeting_id, starts_at: h.starts_at, ends_at: h.ends_at, label: h.label, meet_url: $('Montar aviso').first().json.meet || null } }];`),
  pg("Cancelar reserva",
    "SELECT agenda.cancel_meeting((p->>'mid')::bigint, 'system:gcal_failed') AS cancelled FROM (SELECT $1::jsonb AS p) x",
    "={{ JSON.stringify({ mid: $('Reservar').first().json.r.meeting_id }) }}"),
  code("Falha ao criar evento", `return [{ json: { ok: false, reason: 'calendar_error' } }];`),
  code("Recusa da reserva", `const r = $('Reservar').first().json.r;
return [{ json: { ok: false, reason: (r && r.reason) || 'invalido' } }];`),
  code("Horário ocupado", `return [{ json: { ok: false, reason: 'slot_taken' } }];`),
  code("Horário inválido", `return [{ json: { ok: false, reason: 'invalido' } }];`),

  // --- link_info
  pg("Ler link", "SELECT agenda.resolve_booking_link(p->>'token') AS r FROM (SELECT $1::jsonb AS p) x",
    "={{ JSON.stringify({ token: $json.token }) }}"),
  code("Resposta do link", `const r = $json.r || {};
if (r.ok !== true) return [{ json: { ok: false, reason: r.reason || 'link_invalido' } }];
return [{ json: { ok: true, lead_name: r.lead_name || '', phone_end: String(r.phone || '').slice(-4), expires_at: r.expires_at } }];`),

  code("Fechar recusa", `return [{ json: { ok: false, reason: $('Preparar entrada').first().json.reason || 'invalido' } }];`),
  node("Responder", "n8n-nodes-base.respondToWebhook", 1.5,
    { respondWith: "json", responseBody: "={{ JSON.stringify($json) }}", options: {} }),
];

const to = (...names) => [names.map((n) => ({ node: n, type: "main", index: 0 }))];
const branch = (yes, no) => [[{ node: yes, type: "main", index: 0 }], [{ node: no, type: "main", index: 0 }]];
const connections = {
  "Webhook público": { main: to("Ler configuração") },
  "Ler configuração": { main: to("Preparar entrada") },
  "Preparar entrada": { main: to("Entrada válida?") },
  "Entrada válida?": { main: branch("É horários?", "Fechar recusa") },
  "É horários?": { main: branch("Ocupado no Google", "É agendar?") },
  "É agendar?": { main: branch("Montar horário", "Ler link") },
  "Ocupado no Google": { main: branch("Ocupado no banco", "Falha no Google") },
  "Ocupado no banco": { main: to("Calcular horários") },
  "Calcular horários": { main: to("Responder") },
  "Falha no Google": { main: to("Responder") },
  "Montar horário": { main: to("Horário válido?") },
  "Horário válido?": { main: branch("Conferir no Google", "Horário inválido") },
  "Conferir no Google": { main: branch("Livre no Google?", "Falha no Google") },
  "Livre no Google?": { main: branch("Reservar", "Horário ocupado") },
  "Reservar": { main: to("Reservou?") },
  "Reservou?": { main: branch("Ler reunião", "Recusa da reserva") },
  "Ler reunião": { main: to("Criar evento") },
  "Criar evento": { main: branch("Anexar evento", "Cancelar reserva") },
  "Anexar evento": { main: to("Montar aviso") },
  "Montar aviso": { main: to("Registrar aviso (Inbox PsiAtiva)") },
  "Registrar aviso (Inbox PsiAtiva)": { main: to("Enviar aviso via Z-API") },
  "Enviar aviso via Z-API": { main: to("Confirmar aviso (Inbox PsiAtiva)") },
  "Confirmar aviso (Inbox PsiAtiva)": { main: to("Sucesso") },
  "Sucesso": { main: to("Responder") },
  "Cancelar reserva": { main: to("Falha ao criar evento") },
  "Falha ao criar evento": { main: to("Responder") },
  "Recusa da reserva": { main: to("Responder") },
  "Horário ocupado": { main: to("Responder") },
  "Horário inválido": { main: to("Responder") },
  "Ler link": { main: to("Resposta do link") },
  "Resposta do link": { main: to("Responder") },
  "Fechar recusa": { main: to("Responder") },
};

// Canvas layout: column = longest path from the trigger, row = order within the column.
const depth = { "Webhook público": 0 };
for (let changed = true; changed;) {
  changed = false;
  for (const [from, { main }] of Object.entries(connections)) {
    for (const branchOut of main) for (const { node: n } of branchOut) {
      if (depth[from] !== undefined && (depth[n] ?? -1) < depth[from] + 1 && depth[from] < 40) { depth[n] = depth[from] + 1; changed = true; }
    }
  }
}
const rows = {};
for (const n of nodes) {
  const col = depth[n.name] ?? 0;
  rows[col] = (rows[col] ?? -1) + 1;
  n.position = [col * 240, rows[col] * 180];
}

process.stdout.write(JSON.stringify({
  name: "Locuz — Agenda (/agendar)",
  nodes, connections,
  settings: { executionOrder: "v1", timezone: "America/Sao_Paulo", saveDataErrorExecution: "all", saveDataSuccessExecution: "all" },
}, null, 2) + "\n");
