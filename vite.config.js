import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'brand-icon.svg'],
      manifest: {
        name: 'Gasolina GT',
        short_name: 'Gasolina GT',
        description: 'Consulta y notificación de precios de combustibles en Huehuetenango.',
        theme_color: '#0d4d3b',
        background_color: '#f4f9f5',
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
})
