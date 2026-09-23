import tailwindcss from '@tailwindcss/vite';
import ViteRestart from 'vite-plugin-restart';
import StimulusHMR from 'vite-plugin-stimulus-hmr';

export default ({command}) => ({
  base: command === 'serve' ? '' : '/dist/',
  build: {
    manifest: true,
    outDir: 'web/dist/',
    rollupOptions: {
      input: {
        app: 'assets/js/app.js'
      }
    },
  },
  server: {
    fs: {
      strict: false
    },
    host: '0.0.0.0',
    port: 3000,
    origin: 'https://craft-boilerplate.ddev.site:3000',
    strictPort: true,
    secure: false,
    allowedHosts: ['craft-boilerplate.ddev.site'],
  },
  plugins: [
    tailwindcss(),
    ViteRestart({
      reload: [
        'templates/**/*',
      ],
    }),
    StimulusHMR(),
  ],
});
