"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { WikiStats } from "@/lib/types";

export default function HomePage() {
  const [stats, setStats] = useState<WikiStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/stats")
      .then((res) => res.json())
      .then((data) => {
        setStats(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Hero */}
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold text-slate-900 mb-3">
          星辰Wiki
        </h1>
        <p className="text-lg text-slate-500 max-w-2xl mx-auto">
          企业内部项目文档智能知识库 · 支持全文检索与 AI 智能问答
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <Link
            href="/search"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors shadow-sm"
          >
            <SearchIcon />
            智能搜索
          </Link>
          <Link
            href="/chat"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-white text-slate-700 rounded-lg font-medium border border-slate-300 hover:bg-slate-50 transition-colors shadow-sm"
          >
            <ChatIcon />
            AI 问答
          </Link>
          <Link
            href="/docs"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-white text-slate-700 rounded-lg font-medium border border-slate-300 hover:bg-slate-50 transition-colors shadow-sm"
          >
            <DocIcon />
            文档浏览
          </Link>
        </div>
      </div>

      {/* 统计卡片 */}
      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-slate-200 p-5 animate-pulse">
              <div className="h-4 bg-slate-200 rounded w-16 mb-3" />
              <div className="h-8 bg-slate-200 rounded w-12" />
            </div>
          ))}
        </div>
      ) : stats ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <StatCard label="原始文档" value={stats.totalDocs} color="indigo" />
            <StatCard label="概念词条" value={stats.totalConcepts} color="emerald" />
            <StatCard label="实体词条" value={stats.totalEntities} color="amber" />
            <StatCard label="客户企业" value={stats.totalClients} color="rose" />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
            <StatCard label="项目系统" value={stats.totalProjects} color="cyan" />
            <StatCard label="文档类型" value={stats.totalDocTypes} color="violet" />
            <StatCard label="文档块" value={stats.totalChunks} color="slate" />
            <StatCard label="索引状态" value={stats.indexReady ? "就绪" : "构建中"} color={stats.indexReady ? "emerald" : "orange"} isString />
          </div>

          {/* 热门概念 */}
          <section className="mb-10">
            <h2 className="text-xl font-semibold text-slate-900 mb-4">🔥 热门概念词条</h2>
            <div className="flex flex-wrap gap-2">
              {stats.topConcepts.map((c) => (
                <span
                  key={c.name}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 rounded-full text-sm text-slate-700 hover:border-indigo-300 hover:text-indigo-700 transition-colors cursor-default"
                  title={`出现频次: ${c.frequency}`}
                >
                  {c.name}
                  <span className="text-xs text-slate-400">{c.frequency}</span>
                </span>
              ))}
            </div>
          </section>

          {/* 客户企业 */}
          <section className="mb-10">
            <h2 className="text-xl font-semibold text-slate-900 mb-4">🏢 客户企业</h2>
            <div className="flex flex-wrap gap-2">
              {stats.clients.map((c) => (
                <span
                  key={c}
                  className="px-3 py-1.5 bg-white border border-slate-200 rounded-full text-sm text-slate-600 hover:border-indigo-300 hover:text-indigo-700 transition-colors cursor-default"
                >
                  {c}
                </span>
              ))}
            </div>
          </section>

          {/* 项目系统 */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-4">📋 项目系统类型</h2>
            <div className="flex flex-wrap gap-2">
              {stats.projects.map((p) => (
                <span
                  key={p}
                  className="px-3 py-1.5 bg-white border border-slate-200 rounded-full text-sm text-slate-600 hover:border-indigo-300 hover:text-indigo-700 transition-colors cursor-default"
                >
                  {p}
                </span>
              ))}
            </div>
          </section>
        </>
      ) : (
        <div className="text-center py-12 text-slate-500">加载统计数据失败</div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
  isString = false,
}: {
  label: string;
  value: string | number;
  color: string;
  isString?: boolean;
}) {
  const colorMap: Record<string, string> = {
    indigo: "bg-indigo-50 text-indigo-700 border-indigo-200",
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    rose: "bg-rose-50 text-rose-700 border-rose-200",
    cyan: "bg-cyan-50 text-cyan-700 border-cyan-200",
    violet: "bg-violet-50 text-violet-700 border-violet-200",
    slate: "bg-slate-100 text-slate-700 border-slate-200",
    orange: "bg-orange-50 text-orange-700 border-orange-200",
  };

  return (
    <div className={`rounded-xl border p-5 ${colorMap[color] || colorMap.indigo}`}>
      <div className="text-sm opacity-70 mb-1">{label}</div>
      <div className={`text-2xl font-bold ${isString && value === "就绪" ? "text-emerald-600" : ""}`}>
        {value}
      </div>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
    </svg>
  );
}

function DocIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}
