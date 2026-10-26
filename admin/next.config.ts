import path from 'node:path';
import type { NextConfig } from 'next';

const config: NextConfig = {
  // Reuses the web app's API client and admin services from ../src (one implementation).
  turbopack: { root: path.join(__dirname, '..') },
  outputFileTracingRoot: path.join(__dirname, '..'),
  output: 'standalone',
  poweredByHeader: false,
};

export default config;
