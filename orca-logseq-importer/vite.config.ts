import { defineConfig } from 'vite'

// https://vitejs.dev/config/
export default defineConfig({
  build: {
    lib: {
      entry: 'src/main.ts',
      name: 'LogseqImporter',
      formats: ['es'],
      fileName: 'index',
    },
    // We have no external dependencies anymore
    rollupOptions: {},
  },
})
