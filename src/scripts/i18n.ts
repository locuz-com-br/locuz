/**
 * Locuz i18n Engine
 * Swaps text content of elements with [data-i18n] attributes.
 * Swaps placeholder of elements with [data-i18n-placeholder] attributes.
 * Auto-detects locale from navigator.language, persists via localStorage.
 */

// @ts-nocheck
import translations from '../data/translations.json';

type Lang = 'pt' | 'en';

function getNestedValue(obj: any, path: string): string | undefined {
  return path.split('.').reduce((acc, key) => acc?.[key], obj);
}

function applyTranslations(lang: Lang) {
  // Text content
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n')!;
    const entry = getNestedValue(translations, key);
    if (entry && typeof entry === 'object' && lang in entry) {
      el.textContent = (entry as Record<string, string>)[lang];
    }
  });

  // Placeholders
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-i18n-placeholder')!;
    const entry = getNestedValue(translations, key);
    if (entry && typeof entry === 'object' && lang in entry) {
      (el as HTMLInputElement | HTMLTextAreaElement).placeholder = (entry as Record<string, string>)[lang];
    }
  });

  // Update html lang attribute
  document.documentElement.lang = lang === 'pt' ? 'pt-BR' : 'en';

  // Update toggle labels
  document.querySelectorAll('.lang-toggle-flag').forEach((el) => {
    (el as HTMLImageElement).src = lang === 'pt' ? 'https://flagcdn.com/w20/br.png' : 'https://flagcdn.com/w20/us.png';
  });
}

function detectDefaultLang(): Lang {
  const saved = localStorage.getItem('locuz-lang');
  if (saved === 'pt' || saved === 'en') return saved;

  // Detect from browser
  const browserLang = navigator.language || (navigator as any).userLanguage || '';
  return browserLang.toLowerCase().startsWith('pt') ? 'pt' : 'en';
}

function toggleLang() {
  const current = (localStorage.getItem('locuz-lang') as Lang) || detectDefaultLang();
  const next: Lang = current === 'pt' ? 'en' : 'pt';
  localStorage.setItem('locuz-lang', next);
  applyTranslations(next);
}

// Initialize
const initialLang = detectDefaultLang();
localStorage.setItem('locuz-lang', initialLang);

// Apply after DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => applyTranslations(initialLang));
} else {
  applyTranslations(initialLang);
}

// Bind toggle buttons
document.getElementById('lang-toggle')?.addEventListener('click', toggleLang);
document.getElementById('lang-toggle-mobile')?.addEventListener('click', toggleLang);

// Export for external use
(window as any).__locuzI18n = { applyTranslations, toggleLang, detectDefaultLang };
