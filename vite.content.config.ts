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
      entry: resolve(__dirname, 'src/content/content.tsx'),
      fileName: () => 'content.js',
      formats: ['iife'],
      name: 'ZennyContentScript',
    },
    rollupOptions: {
      output: {
        codeSplitting: false,
      },
    },
  },
})
