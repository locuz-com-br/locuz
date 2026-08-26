'use client';

import { useState, useEffect, useRef } from 'react';
import HCaptcha from '@hcaptcha/react-hcaptcha';
import PhoneInput from 'react-phone-number-input';
import 'react-phone-number-input/style.css';

const N8N_CAPTURE_WEBHOOK = import.meta.env.PUBLIC_N8N_CAPTURE_WEBHOOK || '';
const WEB3FORMS_ACCESS_KEY = import.meta.env.PUBLIC_WEB3FORMS_ACCESS_KEY || '';
const HCAPTCHA_SITE_KEY = import.meta.env.PUBLIC_HCAPTCHA_SITE_KEY || '';
const N8N_TIMEOUT_MS = 8_000;

type SubmissionStatus = 'idle' | 'sending' | 'sent' | 'error' | 'captcha_required';
type PrimarySubmissionResult = 'sent' | 'fallback' | 'invalid_payload' | 'captcha_failed' | 'error';

type CapturePayload = {
  source: 'contact_page';
  name: string;
  email: string;
  phone: string;
  company: string;
  message: string;
  consent: true;
  'h-captcha-response': string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await response.json();
    return isRecord(body) ? body : null;
  } catch {
    return null;
  }
}

async function submitToN8n(payload: CapturePayload): Promise<PrimarySubmissionResult> {
  // This guard is kept at runtime as well as build-time validation so an incorrectly
  // configured deployed bundle never tries to POST back to the current page.
  if (!N8N_CAPTURE_WEBHOOK) {
    console.error('PUBLIC_N8N_CAPTURE_WEBHOOK is not configured. Trying the email fallback.');
    return 'fallback';
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), N8N_TIMEOUT_MS);

  try {
    const response = await fetch(N8N_CAPTURE_WEBHOOK, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const data = await readJson(response);

    if (controller.signal.aborted) {
      console.error('n8n capture request timed out. Trying the email fallback.');
      return 'fallback';
    }

    // The webhook can accidentally return a 200 for an invalid submission, so its
    // response body is part of the success contract.
    if (response.status === 200 && data?.ok === true) {
      return 'sent';
    }

    if (response.status >= 500 && response.status <= 599) {
      console.error('n8n capture unavailable:', response.status, data);
      return 'fallback';
    }

    if (response.status === 400) {
      console.error('n8n rejected the capture payload:', data);
      return 'invalid_payload';
    }

    if (response.status === 403) {
      console.error('n8n rejected the hCaptcha token:', data);
      return 'captcha_failed';
    }

    // A fallback is intentionally not used for non-5xx responses: resubmitting a
    // valid rejection to Web3Forms would create duplicates or admit bot traffic.
    console.error('Unexpected n8n capture response:', response.status, data);
    return 'error';
  } catch (error) {
    // fetch rejects for network errors and for the timeout abort. Both are the
    // degraded-mode condition in the capture contract.
    console.error('n8n capture request failed:', error);
    return 'fallback';
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function submitToWeb3Forms(payload: CapturePayload): Promise<boolean> {
  if (!WEB3FORMS_ACCESS_KEY) {
    console.error('PUBLIC_WEB3FORMS_ACCESS_KEY is not configured.');
    return false;
  }

  try {
    const response = await fetch('https://api.web3forms.com/submit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        ...payload,
        access_key: WEB3FORMS_ACCESS_KEY,
        subject: 'Novo contato — site Locuz',
        fallback: true,
      }),
    });
    const data = await readJson(response);

    if (response.ok && data?.success === true) {
      return true;
    }

    console.error('Web3Forms fallback rejected the capture:', response.status, data);
    return false;
  } catch (error) {
    console.error('Web3Forms fallback request failed:', error);
    return false;
  }
}

export default function ContactForm() {
  const [status, setStatus] = useState<SubmissionStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [phoneValue, setPhoneValue] = useState<string | undefined>('');
  const [phoneCountry, setPhoneCountry] = useState<any>('BR');
  const captchaRef = useRef<HCaptcha>(null);

  useEffect(() => {
    // Escuta mudanças de idioma no html tag para trocar a bandeira do telefone
    if (typeof document !== 'undefined') {
      const updateCountry = () => {
        const isEnglish = document.documentElement.lang.startsWith('en');
        setPhoneCountry(isEnglish ? 'US' : 'BR');
      };
      
      updateCountry();

      const langObserver = new MutationObserver((mutations) => {
        if (mutations.some((m) => m.attributeName === 'lang')) {
          updateCountry();
        }
      });

      langObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
      return () => langObserver.disconnect();
    }
  }, []);

  useEffect(() => {
    // Re-apply translations if the component changes state (e.g., shows error or success)
    if (typeof window !== 'undefined' && (window as any).__locuzI18n) {
      const i18n = (window as any).__locuzI18n;
      i18n.applyTranslations(i18n.detectDefaultLang());
    }
  }, [status]);

  useEffect(() => {
    // Dynamically observe and add loading="lazy" to the hCaptcha iframe that gets injected automatically
    // This fixes the 'Unoptimized loading attribute / IFRAME below the fold' SEO warning.
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeName === 'IFRAME') {
            const iframe = node as HTMLIFrameElement;
            if (iframe.src.includes('hcaptcha.com')) {
              iframe.setAttribute('loading', 'lazy');
              // Optionally set a title for accessibility warnings as well
              if (!iframe.getAttribute('title')) {
                iframe.setAttribute('title', 'hCaptcha security verification');
              }
            }
          }
        });
      });
    });

    if (typeof window !== 'undefined') {
      observer.observe(document.body, { childList: true, subtree: true });
      // Clean up the observer on unmount
      return () => observer.disconnect();
    }
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (!captchaToken) {
      setStatus('captcha_required');
      return;
    }

    setStatus('sending');
    setErrorMessage('');

    const form = e.currentTarget;
    const formData = new FormData(form);
    const payload: CapturePayload = {
      source: 'contact_page',
      name: String(formData.get('name') || '').trim(),
      email: String(formData.get('email') || '').trim(),
      phone: phoneValue || '',
      company: String(formData.get('company') || '').trim(),
      message: String(formData.get('message') || '').trim(),
      consent: true,
      'h-captcha-response': captchaToken,
    };

    const completeSubmission = () => {
      setStatus('sent');
      form.reset();
      setPhoneValue('');
      captchaRef.current?.resetCaptcha();
      setCaptchaToken(null);
    };

    const primaryResult = await submitToN8n(payload);

    if (primaryResult === 'sent') {
      completeSubmission();
      return;
    }

    if (primaryResult === 'fallback') {
      if (await submitToWeb3Forms(payload)) {
        completeSubmission();
      } else {
        setErrorMessage('Não foi possível enviar sua mensagem. Por favor, tente novamente.');
        setStatus('error');
      }
      return;
    }

    if (primaryResult === 'invalid_payload') {
      setErrorMessage('Revise os dados informados e tente novamente.');
    } else if (primaryResult === 'captcha_failed') {
      setErrorMessage('A verificação de segurança expirou ou falhou. Resolva o captcha novamente.');
      captchaRef.current?.resetCaptcha();
      setCaptchaToken(null);
    } else {
      setErrorMessage('Não foi possível enviar sua mensagem. Por favor, tente novamente.');
    }
    setStatus('error');
  }

  return (
    <>
      <style>{`
        .locuz-phone-input {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .locuz-phone-input input {
          width: 100%;
          padding: 0.75rem 1rem;
          background: var(--input-bg, transparent);
          border: 1px solid var(--input-border, #e2e8f0);
          border-radius: 0.75rem;
          color: var(--input-color, inherit);
          font-size: 0.9375rem;
          font-family: inherit;
          outline: none;
        }
        /*
        .locuz-phone-input .PhoneInputCountry {
          padding: 0.5rem;
          background: var(--input-bg, transparent);
          border: 1px solid var(--input-border, #e2e8f0);
          border-radius: 0.5rem;
          display: flex;
          align-items: center;
        }
        */
        .locuz-phone-input .PhoneInputCountry {
          display: none;
        }
        .locuz-phone-input .PhoneInputCountrySelect {
          color: var(--input-color, inherit);
          background: var(--input-bg, transparent);
        }
      `}</style>
      <form onSubmit={handleSubmit} style={formStyles}>
      <div style={rowStyles}>
        <div style={fieldStyles}>
          <label style={labelStyles} htmlFor="name" data-i18n="contact.form_name">Nome *</label>
          <input
            id="name"
            type="text"
            name="name"
            required
            placeholder="Seu nome completo"
            data-i18n-placeholder="contact.form_name_placeholder"
            style={inputStyles}
          />
        </div>
        <div style={fieldStyles}>
          <label style={labelStyles} htmlFor="email" data-i18n="contact.form_email">E-mail *</label>
          <input
            id="email"
            type="email"
            name="email"
            required
            placeholder="seu@email.com"
            data-i18n-placeholder="contact.form_email_placeholder"
            style={inputStyles}
          />
        </div>
      </div>

      <div style={rowStyles}>
        <div style={fieldStyles}>
          <label style={labelStyles} htmlFor="phone" data-i18n="contact.form_phone">Telefone</label>
          <PhoneInput
            id="phone"
            international
            defaultCountry={phoneCountry}
            value={phoneValue}
            onChange={setPhoneValue}
            placeholder="(11) 99999-9999"
            className="locuz-phone-input"
          />
        </div>
        <div style={fieldStyles}>
          <label style={labelStyles} htmlFor="company" data-i18n="contact.form_company">Empresa</label>
          <input
            id="company"
            type="text"
            name="company"
            placeholder="Nome da empresa"
            data-i18n-placeholder="contact.form_company_placeholder"
            style={inputStyles}
          />
        </div>
      </div>

      <div style={fieldStyles}>
        <label style={labelStyles} htmlFor="message" data-i18n="contact.form_message">Mensagem *</label>
        <textarea
          id="message"
          name="message"
          required
          rows={4}
          placeholder="Conte-nos sobre seu projeto e objetivos..."
          data-i18n-placeholder="contact.form_message_placeholder"
          style={{ ...inputStyles, resize: 'vertical' as const, minHeight: '120px' }}
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-start', margin: '0.5rem 0' }}>
        <HCaptcha
          ref={captchaRef}
          sitekey={HCAPTCHA_SITE_KEY}
          onVerify={(token) => {
            setCaptchaToken(token);
            if (status === 'captcha_required') setStatus('idle');
          }}
          onExpire={() => setCaptchaToken(null)}
          onError={() => setCaptchaToken(null)}
        />
      </div>
      
      {status === 'captcha_required' && (
        <p style={errorStyles} data-i18n="contact.form_captcha_required">
          Por favor, resolva o captcha de segurança antes de enviar.
        </p>
      )}

      <button
        type="submit"
        disabled={status === 'sending'}
        style={{
          ...buttonStyles,
          opacity: status === 'sending' ? 0.7 : 1,
          cursor: status === 'sending' ? 'not-allowed' : 'pointer',
        }}
        data-i18n={status === 'sending' ? 'contact.form_sending' : 'contact.form_submit'}
      >
        {status === 'sending' ? 'Enviando...' : 'Enviar Mensagem →'}
      </button>

      {status === 'sent' && (
        <p style={successStyles} data-i18n="contact.form_success">
          ✓ Mensagem enviada com sucesso! Retornaremos em até 24h.
        </p>
      )}
      {status === 'error' && (
        <p style={errorStyles}>
          {errorMessage || 'Algo deu errado. Por favor, tente novamente.'}
        </p>
      )}
    </form>
    </>
  );
}

const formStyles: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '1.25rem',
};

const rowStyles: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
  gap: '1.25rem',
};

const fieldStyles: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.375rem',
};

const labelStyles: React.CSSProperties = {
  fontSize: '0.8125rem',
  fontWeight: 500,
  color: '#868C94',
  letterSpacing: '0.02em',
};

const inputStyles: React.CSSProperties = {
  width: '100%',
  padding: '0.75rem 1rem',
  background: 'var(--input-bg)',
  border: '1px solid var(--input-border)',
  borderRadius: '0.75rem',
  color: 'var(--input-color)',
  fontSize: '0.9375rem',
  fontFamily: 'Inter, system-ui, sans-serif',
  outline: 'none',
  transition: 'border-color 0.3s ease, box-shadow 0.3s ease',
};

const buttonStyles: React.CSSProperties = {
  padding: '0.875rem 2rem',
  background: 'var(--btn-primary-bg)',
  color: 'var(--btn-primary-color)',
  border: 'none',
  borderRadius: '9999px',
  fontSize: '0.9375rem',
  fontWeight: 600,
  fontFamily: 'Inter, system-ui, sans-serif',
  transition: 'all 0.3s ease',
  marginTop: '0.5rem',
};

const successStyles: React.CSSProperties = {
  color: '#36A2AC',
  fontSize: '0.875rem',
  fontWeight: 500,
  padding: '0.75rem 1rem',
  borderRadius: '0.75rem',
  background: 'rgba(54, 162, 172, 0.1)',
  border: '1px solid rgba(54, 162, 172, 0.2)',
};

const errorStyles: React.CSSProperties = {
  color: '#ef4444',
  fontSize: '0.875rem',
  fontWeight: 500,
  padding: '0.75rem 1rem',
  borderRadius: '0.75rem',
  background: 'rgba(239, 68, 68, 0.1)',
  border: '1px solid rgba(239, 68, 68, 0.2)',
};
