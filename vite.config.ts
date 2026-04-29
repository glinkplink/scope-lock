import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    modulePreload: {
      resolveDependencies(_filename, deps, context) {
        if (context.hostType === 'html') {
          return deps.filter(
            (dep) =>
              dep.includes('rolldown-runtime') ||
              dep.includes('react-vendor') ||
              dep.includes('router-vendor') ||
              dep.includes('icons-vendor') ||
              dep.includes('supabase-vendor') ||
              /^assets\/index-.*\.css$/.test(dep)
          );
        }

        return deps;
      },
    },
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) {
            return 'react-vendor';
          }
          if (id.includes('node_modules/react-router') || id.includes('node_modules/@remix-run/router')) {
            return 'router-vendor';
          }
          if (
            id.includes('@supabase') ||
            /src\/lib\/(supabase|auth|fetch-with-supabase-auth)\.ts/.test(id)
          ) {
            return 'supabase-vendor';
          }
          if (id.includes('node_modules/lucide-react/')) {
            return 'icons-vendor';
          }
          if (
            /src\/lib\/(agreement-generator|agreement-sections-html|change-order-document|change-order-generator|docuseal-|invoice-generator|invoice-line-items|html-escape)/.test(
              id
            )
          ) {
            return 'document-generation';
          }
        },
      },
    },
  },
  resolve: {
    alias: {
      '@scope-server': path.resolve(__dirname, 'server'),
    },
  },
  test: {
    environment: 'node',
  },
});
