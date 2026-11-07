import preact from '@preact/preset-vite';
import { defineConfig } from 'wxt';

// Same variable the background worker reads via import.meta.env.
const api = process.env.WXT_API_BASE ?? 'http://localhost:8080';

export default defineConfig({
  srcDir: 'src',
  vite: () => ({ plugins: [preact()] }),
  manifest: {
    name: 'StackGPT',
    description: 'Community evidence for AI answers: has this fix worked for others?',
    version: '0.2.0',
    // Holds the anonymous user token for community reports.
    permissions: ['storage'],
    // Background worker calls the local API; host permission avoids CORS.
    host_permissions: [`${new URL(api).origin}/*`],
  },
});
