// ─────────────────────────────────────────────
// Locuz — Centralized Link Constants
// ─────────────────────────────────────────────
// Import and use these instead of hard-coding hrefs in components.
// Example:  <a href={LINKS.nav.servicos}>

// ── Pages ────────────────────────────────────
export const PAGES = {
  home: "/",
} as const;

// ── Section Anchors ──────────────────────────
export const SECTIONS = {
  inicio: "#inicio",
  servicos: "#servicos",
  proposito: "#proposito",
  processo: "#processo",
  resultados: "#resultados",
  contato: "#contato",
} as const;

// ── Social Media ─────────────────────────────
export const SOCIALS = {
  whatsapp: "https://wa.me/5521965192607",
  linkedin: "https://linkedin.com/company/locuz-com-br",
  instagram: "https://instagram.com/locuz.com.br",
  facebook: "https://facebook.com/locuz.com.br",
  tiktok: "https://tiktok.com/@locuz.com.br",
  youtube: "https://youtube.com/@locuz.com.br",
  twitter: "https://twitter.com/locuz.com.br",
} as const;

// ── Contact ──────────────────────────────────
export const CONTACT = {
  email: "contato@locuz.com.br",
  emailHref: "mailto:contato@locuz.com.br",
  phone: "+55 (21) 96519-2607",
  phoneHref: "https://wa.me/5521965192607",
  meet: "https://cal.com/locuz/dep"
} as const;

// ── Legal / Misc ─────────────────────────────
export const LEGAL = {
  blog: "/blog",
  terms: "/termos",
  privacy: "/privacidade",
  cookies: "/cookies",
} as const;

// ── Aggregated export ────────────────────────
const LINKS = {
  pages: PAGES,
  sections: SECTIONS,
  socials: SOCIALS,
  contact: CONTACT,
  legal: LEGAL,
} as const;

export default LINKS;
