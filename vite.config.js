import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(({ mode }) => {
  const desktop = mode === 'desktop'
  return {
  base: desktop ? '/__gasolinagt_desktop__/' : '/',
  envDir: desktop ? false : undefined,
  envPrefix: desktop ? 'DESKTOP_BUILD_UNUSED_' : 'VITE_',
  build: { outDir: desktop ? 'dist-desktop' : 'dist' },
  plugins: [
    react(),
    desktop ? {
      name: 'gasolinagt-desktop-runtime',
      resolveId(id) { if (id === 'virtual:pwa-register') return '\0desktop-no-service-worker' },
      load(id) { if (id === '\0desktop-no-service-worker') return 'export function registerSW() {}' },
      transformIndexHtml(html) {
        return { html: html.replace(/\s*<link rel="manifest"[^>]*>/g, ''),
          tags: [{ tag: 'script', attrs: { src: '/__gasolinagt_desktop__/runtime-config.js' }, injectTo: 'head-prepend' }] }
      },
    } : VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'brand-icon.svg'],
      manifest: {
        name: 'Fuel Station Solution GT',
        short_name: 'Fuel Station Solution GT',
        description: 'Consulta y notificación de precios de combustibles en Huehuetenango.',
        theme_color: '#123047',
        background_color: '#f8fafc',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: '/brand-icon.svg',
            sizes: '192x192',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
      },
    }),
  ],
  }
})
