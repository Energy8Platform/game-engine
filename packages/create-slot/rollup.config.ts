import { defineConfig } from 'rollup';
import typescript from '@rollup/plugin-typescript';

export default defineConfig([
  {
    input: 'src/index.ts',
    external: [/^node:/],
    output: {
      file: 'dist/cli.js',
      format: 'esm',
      banner: '#!/usr/bin/env node',
      sourcemap: true,
    },
    plugins: [typescript({ tsconfig: './tsconfig.json', declaration: false, sourceMap: true })],
  },
]);
