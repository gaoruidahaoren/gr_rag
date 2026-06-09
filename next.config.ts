import type { NextConfig } from "next";

const nextConfig = {
  // 启用 instrumentation hook（应用启动时自动建索引）
  experimental: {
    // @ts-ignore - Next.js supports this but types are outdated
    instrumentationHook: true,
  },
  // 原生模块需要外部化，避免 Turbopack 打包
  serverExternalPackages: ['better-sqlite3', '@node-rs/jieba', '@lancedb/lancedb'],
} as NextConfig;

export default nextConfig;
