"use client";

import { useEffect, useState } from "react";
import { WikiStats } from "@/lib/types";

interface RawDoc {
  id: string;
  title: string;
  path: string;
  metadata: {
    client?: string;
    project?: string;
    docType?: string;
    date?: string;
  };
  wikiLinks: string[];
  chunkCount: number;
}

export default function DocsPage() {
  const [docs, setDocs] = useState<RawDoc[]>([]);
  const [stats, setStats] = useState<WikiStats | null>(null);
  const [loading, setLoading] = useState(true);

  // 筛选
  const [filterClient, setFilterClient] = useState("");
  const [filterProject, setFilterProject] = useState("");
  const [filterDocType, setFilterDocType] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/stats").then((r) => r.json()),
      fetch("/api/docs/list").then((r) => r.json()),
    ])
      .then(([statsData, docsData]) => {
        setStats(statsData);
        setDocs(docsData.docs || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const filteredDocs = docs.filter((doc) => {
    if (filterClient && doc.metadata.client !== filterClient) return false;
    if (filterProject && doc.metadata.project !== filterProject) return false;
    if (filterDocType && doc.metadata.docType !== filterDocType) return false;
    return true;
  });

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-2xl font-bold text-slate-900 mb-6">文档浏览</h1>

      {/* 筛选器 */}
      {stats && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6 shadow-sm">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1">客户企业</label>
              <select
                value={filterClient}
                onChange={(e) => setFilterClient(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">全部客户</option>
                {stats.clients.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">项目系统</label>
              <select
                value={filterProject}
                onChange={(e) => setFilterProject(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">全部项目</option>
                {stats.projects.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">文档类型</label>
              <select
                value={filterDocType}
                onChange={(e) => setFilterDocType(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">全部类型</option>
                {stats.docTypes.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {/* 文档列表 */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-slate-200 p-4 animate-pulse">
              <div className="h-4 bg-slate-200 rounded w-1/2 mb-3" />
              <div className="h-3 bg-slate-100 rounded w-3/4" />
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="mb-3 text-sm text-slate-500">
            共 {filteredDocs.length} 个文档
            {(filterClient || filterProject || filterDocType) && (
              <button
                onClick={() => {
                  setFilterClient("");
                  setFilterProject("");
                  setFilterDocType("");
                }}
                className="ml-2 text-indigo-600 hover:underline"
              >
                清除筛选
              </button>
            )}
          </div>

          <div className="space-y-2">
            {filteredDocs.map((doc) => (
              <div
                key={doc.id}
                className="bg-white rounded-xl border border-slate-200 p-4 hover:border-indigo-300 transition-colors shadow-sm"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-slate-900 truncate">
                      {doc.title}
                    </h3>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {doc.metadata.client && (
                        <span className="text-xs px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded-md">
                          🏢 {doc.metadata.client}
                        </span>
                      )}
                      {doc.metadata.project && (
                        <span className="text-xs px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-md">
                          📋 {doc.metadata.project}
                        </span>
                      )}
                      {doc.metadata.docType && (
                        <span className="text-xs px-2 py-0.5 bg-amber-50 text-amber-700 rounded-md">
                          📄 {doc.metadata.docType}
                        </span>
                      )}
                      {doc.metadata.date && (
                        <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-500 rounded-md">
                          📅 {doc.metadata.date}
                        </span>
                      )}
                      <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-400 rounded-md">
                        共 {doc.chunkCount} 块
                      </span>
                    </div>
                    {doc.wikiLinks.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {doc.wikiLinks.slice(0, 10).map((link) => (
                          <span
                            key={link}
                            className="text-xs px-1.5 py-0.5 bg-purple-50 text-purple-600 rounded"
                          >
                            [[{link}]]
                          </span>
                        ))}
                        {doc.wikiLinks.length > 10 && (
                          <span className="text-xs text-slate-400">
                            +{doc.wikiLinks.length - 10}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {filteredDocs.length === 0 && (
            <div className="text-center py-16 text-slate-500">
              <div className="text-4xl mb-3">📭</div>
              <p>没有匹配的文档</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
