<div align="center">

# 🚀 Locuz — Consulting Landing Page

**A high-performance, multilingual consulting landing page built with Astro, React & Tailwind CSS.**

[![Astro](https://img.shields.io/badge/Astro-FF5D01?style=for-the-badge&logo=astro&logoColor=white)](https://astro.build/)
[![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Three.js](https://img.shields.io/badge/Three.js-000000?style=for-the-badge&logo=threedotjs&logoColor=white)](https://threejs.org/)
[![GSAP](https://img.shields.io/badge/GSAP-88CE02?style=for-the-badge&logo=greensock&logoColor=white)](https://greensock.com/gsap/)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg?style=for-the-badge)](LICENSE)

</div>

---

## 📋 Table of Contents

- [✨ Features](#-features)
- [🛠️ Tech Stack](#️-tech-stack)
- [📁 Project Structure](#-project-structure)
- [⚡ Getting Started](#-getting-started)
- [🧩 Available Commands](#-available-commands)
- [🌐 Internationalization](#-internationalization)
- [📬 Contact Form](#-contact-form)
- [🔒 Security](#-security)
- [📄 License](#-license)

---

## ✨ Features

- ⚡ **Lightning-fast** — Static-first architecture powered by Astro for near-instant load times
- 🌍 **Multilingual** — Built-in PT / EN language toggle with no page reloads
- 🎨 **Stunning visuals** — Three.js 3D scenes + GSAP animations for a premium feel
- 📬 **Contact form** — n8n lead capture with a Web3Forms fallback + hCaptcha bot protection
- 📱 **Fully responsive** — Mobile-first design with Tailwind CSS v4
- 🔒 **Security-first** — Clear vulnerability disclosure policy (see [SECURITY.md](SECURITY.md))
- 🧩 **Component-driven** — Modular, reusable React & Astro components
- 🗂️ **MDX support** — Write rich content with Markdown + JSX via `@astrojs/mdx`

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| 🏗️ **Framework** | [Astro](https://astro.build/) v5+ |
| ⚛️ **UI Components** | [React](https://reactjs.org/) 19 |
| 🎨 **Styling** | [Tailwind CSS](https://tailwindcss.com/) v4 (Vite plugin) |
| 🌐 **3D / Animation** | [Three.js](https://threejs.org/) + [GSAP](https://greensock.com/gsap/) |
| 📝 **Content** | MDX via `@astrojs/mdx` |
| 📬 **Forms** | [Web3Forms](https://web3forms.com/) + [hCaptcha](https://www.hcaptcha.com/) |
| 📞 **Phone Input** | `react-phone-number-input` |
| 🔤 **Language** | TypeScript |

---

## 📁 Project Structure

```
locuz/astro/
├── 📂 public/          # Static assets (images, fonts, favicons)
├── 📂 src/
│   ├── 📂 components/  # Reusable UI components (React & Astro)
│   ├── 📂 constants/   # Shared constants (links, i18n strings)
│   ├── 📂 content/     # MDX/Markdown content collections
│   ├── 📂 layouts/     # Page layout wrappers (BaseLayout, etc.)
│   └── 📂 pages/       # File-based routing (Astro pages)
├── 📄 astro.config.mjs # Astro configuration
├── 📄 tailwind.config.mjs
├── 📄 tsconfig.json
├── 📄 SECURITY.md      # Security policy
└── 📄 LICENSE          # Apache 2.0 License
```

---

## ⚡ Getting Started

### Prerequisites

- **Node.js** ≥ 18.x
- **npm** ≥ 9.x (or your preferred package manager)

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/your-org/locuz.git
cd locuz/astro

# 2. Install dependencies
npm install

# 3. Set up environment variables
cp .env.example .env
#    → Fill in your Web3Forms access key and hCaptcha site key
```

---

## 🧩 Available Commands

All commands are run from the root of the project, from a terminal:

| Command | Action |
|---|---|
| `npm run dev` | 🔥 Start local dev server at `http://localhost:4321` |
| `npm run build` | 📦 Build production site to `./dist/` |
| `npm run preview` | 👀 Preview production build locally |

```bash
# Start the dev server (default port 4321)
npx astro dev --port 4321

# Build for production
npx astro build

# Preview the production build
npx astro preview
```

---

## 🌐 Internationalization

The site supports **Portuguese (PT)** and **English (EN)** via a client-side i18n engine:

- Language preference is **auto-detected** from the browser and **persisted** in `localStorage`
- Toggle is available in the navigation bar — switching is instant, **no page reload** required
- All translatable strings are centralized in `src/constants/` for easy maintenance

---

## 📬 Contact Form

The contact form sends to the n8n capture webhook first. If it times out, has a network
error, or returns a 5xx response, it sends the same lead to Web3Forms marked as a
`fallback`. A 400 or 403 is shown to the visitor and is never retried through Web3Forms.

It is powered by:

- **n8n** — primary lead capture and storage
- **[Web3Forms](https://web3forms.com/)** — email safety net when primary capture is unavailable
- **[hCaptcha](https://www.hcaptcha.com/)** — privacy-friendly bot protection
- **`react-phone-number-input`** — international phone field with automatic formatting

Configure your keys in the `.env` file:

```env
PUBLIC_N8N_CAPTURE_WEBHOOK=https://n8n.psiativa.com.br/webhook/locuz-capture
PUBLIC_WEB3FORMS_ACCESS_KEY=your_access_key_here
PUBLIC_HCAPTCHA_SITE_KEY=your_site_key_here
```

`PUBLIC_N8N_CAPTURE_WEBHOOK` is required for production builds.

---

## 🔒 Security

We take security seriously. If you discover a vulnerability, please follow our responsible disclosure process outlined in [**SECURITY.md**](SECURITY.md).

---

## 📄 License

This project is distributed under the **Apache License 2.0**.
See [**LICENSE**](LICENSE) for the full terms and conditions.

---

<div align="center">

Made with ❤️ by the **Locuz** team

</div>
