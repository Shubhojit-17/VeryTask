/** @type {import('next').NextConfig} */
const nextConfig = {
  // Use Turbopack (Next.js 16 default)
  turbopack: {},
  
  // Transpile packages that need it
  transpilePackages: [
    "@wepin/login-js",
    "@wepin/widget-sdk",
  ],
};

module.exports = nextConfig;
