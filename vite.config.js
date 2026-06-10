import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// base must match the GitHub repo name for Pages deployment
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/dj-wys/',
})
