import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import mdx from '@astrojs/mdx';
import tailwindcss from '@tailwindcss/vite';
import { loadEnv } from 'vite';

function assertCaptureWebhookIsConfigured(mode) {
  const env = loadEnv(mode, process.cwd(), '');

  if (!env.PUBLIC_N8N_CAPTURE_WEBHOOK?.trim()) {
    throw new Error(
      'PUBLIC_N8N_CAPTURE_WEBHOOK must be set for production builds. See projects/lead-capture/CONTEXT.md §5.',
    );
  }
}

const captureEnvGuard = {
  name: 'locuz-capture-env-guard',
  hooks: {
    'astro:config:setup': ({ command }) => {
      if (command === 'build') {
        assertCaptureWebhookIsConfigured('production');
      }
    },
  },
};

// https://astro.build/config
export default defineConfig({
  integrations: [
    react(),
    mdx(),
    captureEnvGuard,
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
