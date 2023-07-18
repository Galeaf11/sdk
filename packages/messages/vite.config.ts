import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig({
  plugins: [
    dts({
      insertTypesEntry: true,
      tsconfigPath: './tsconfig-build.json',
    }),
  ],
  build: {
    lib: {
      name: 'messages',
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
      },
      formats: ['es', 'cjs'],
      fileName: (format, name) => `${name}.${format}.js`,
    },
    rollupOptions: {
      external: [
        'viem',
        'abitype',
        '@windingtree/contracts',
        '@windingtree/sdk-types',
        '@windingtree/sdk-utils',
        '@windingtree/sdk-utils/time',
      ],
    },
  },
});
