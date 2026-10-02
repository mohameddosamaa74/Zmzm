import { defineConfig } from 'vite'

export default defineConfig({
  base: '/',
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        checkout: 'checkout.html',
        admin: 'admin.html',
      },
    },
  },
})
