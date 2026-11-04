import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

function aiTerminalLogger() {
  return {
    name: 'financeai-ai-terminal-logger',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url || '').split('?')[0];
        if (pathname !== '/api/ai/log' || req.method !== 'POST') {
          next();
          return;
        }

        let body = '';
        req.on('data', chunk => {
          body += chunk;
          if (body.length > 64 * 1024) req.destroy();
        });
        req.on('end', () => {
          try {
            const entry = JSON.parse(body);
            const time = new Date().toLocaleTimeString('en-GB');
            const detail = entry.detail && Object.keys(entry.detail).length > 0
              ? ` ${JSON.stringify(entry.detail)}`
              : '';
            console.log(`[AI ${time}] ${entry.event}${detail}`);
          } catch {
            console.log('[AI] received malformed log event');
          }
          res.statusCode = 204;
          res.end();
        });
      });
    }
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), aiTerminalLogger()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true
  },
  preview: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true
  },

  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('chart.js') || id.includes('react-chartjs-2')) {
            return 'vendor-charts';
          }
          if (id.includes('react-icons')) {
            return 'vendor-icons';
          }
          if (id.includes('node_modules')) {
            return 'vendor';
          }
        }
      }
    }
  }
});
