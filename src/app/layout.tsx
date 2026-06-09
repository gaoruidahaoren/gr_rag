import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Link from "next/link";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "星辰Wiki - 企业知识库智能检索",
  description: "基于 RAG 的企业内部项目文档智能知识库",
};

const navItems = [
  { label: "首页", href: "/" },
  { label: "智能搜索", href: "/search" },
  { label: "AI 问答", href: "/chat" },
  { label: "文档浏览", href: "/docs" },
];

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-slate-50">
        {/* 顶部导航 */}
        <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-14">
              <Link href="/" className="flex items-center gap-2 font-bold text-lg text-slate-900">
                <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-sm">
                  星
                </span>
                <span>星辰Wiki</span>
              </Link>
              <nav className="flex items-center gap-1">
                {navItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="px-3 py-1.5 rounded-md text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
            </div>
          </div>
        </header>

        {/* 主内容 */}
        <main className="flex-1">{children}</main>

        {/* 底部 */}
        <footer className="border-t border-slate-200 bg-white py-6">
          <div className="max-w-7xl mx-auto px-4 text-center text-sm text-slate-400">
            星辰Wiki · 企业内部项目文档智能知识库 · Powered by RAG + Hybrid Search
          </div>
        </footer>
      </body>
    </html>
  );
}
