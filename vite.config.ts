import { defineConfig } from 'vite';

export default defineConfig(async () => {
  const react = await import('@vitejs/plugin-react');
  return {
    plugins: [react.default()],
  };
});
