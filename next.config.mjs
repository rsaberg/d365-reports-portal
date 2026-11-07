/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["postgres", "exceljs", "bcryptjs"],
    // The setup route reads these files at runtime; make sure they ship with the function.
    outputFileTracingIncludes: { "/api/setup": ["./db/**", "./snapshot/**"] },
  },
};
export default nextConfig;
