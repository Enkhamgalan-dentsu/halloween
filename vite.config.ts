import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// Camera access (getUserMedia) requires a secure context. basicSsl gives the dev
// server a self-signed HTTPS cert so phones on the same Wi-Fi can open
// https://<your-lan-ip>:5173 (accept the certificate warning once).
export default defineConfig({
  plugins: [basicSsl()],
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
  },
});
