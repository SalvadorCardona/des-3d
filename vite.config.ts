import { defineConfig } from 'vite'

// GitHub Pages sert le site sous /des-3d/ ; Capacitor sert des fichiers locaux,
// il lui faut donc des chemins relatifs.
export default defineConfig({
  base: process.env.CAP_BUILD ? './' : '/des-3d/',
  build: { target: 'esnext' },
})
