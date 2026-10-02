import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/Zmzm/',
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        checkout: 'checkout.html',
      },
    },
  },
})
