/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ['**.run.app', '**.googleusercontent.com', '**.google.com', '127.0.0.1'],
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
