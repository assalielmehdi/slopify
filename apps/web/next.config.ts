import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  agentRules: false,
  typescript: {
    ignoreBuildErrors: true,
  },
}

export default nextConfig
