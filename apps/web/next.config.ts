import type { NextConfig } from 'next'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: resolve(dirname(fileURLToPath(import.meta.url)), '../..'),
  typescript: {
    ignoreBuildErrors: true,
  },
}

export default nextConfig
