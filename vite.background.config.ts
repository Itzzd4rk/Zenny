import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'src/background/background.ts'),
      fileName: () => 'background.js',
      formats: ['es'],
    },
    rollupOptions: {
      output: {
        codeSplitting: false,
      },
    },
  },
})
