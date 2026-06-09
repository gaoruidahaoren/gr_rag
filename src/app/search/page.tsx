"use client";

import { useState, useCallback } from "react";
import Link from "next/link";

interface SearchResult {
  id: string;
  docId: string;
  docTitle: string;
  docPath: string;
  content: string;
  metadata: {
    client?: string;
    project?: string;
    docType?: string;
    date?: string;
  };
  score: number;
  source: string;
  highlight?: string;
}

interface SearchResponse {
  query: string;
  matchedKeywords?: string[];
  total: number;
  results: SearchResult[];
}

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return;
    setLoading(true);
    setSearched(true);
    setError("");

    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}&topK=10`);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setResponse(null);
      } else {
        setResponse(data);
      }
    } catch (err: any) {
      setError("搜索请求失败，请检查服务是否正常运行");
      setResponse(null);
    } finally {
      setLoading(false);
    }
  }, [query]);

  const results = response?.results || [];

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-2xl font-bold text-slate-900 mb-6">智能搜索</h1>

      {/* 搜索框 */}
      <div className="flex gap-3 mb-8">
        <div className="relative flex-1">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="搜索文档内容、技术方案、项目信息..."
            className="w-full px-4 py-3 pr-10 bg-white border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent shadow-sm"
          />
          <svg
            className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <button
          onClick={handleSearch}
          disabled={loading || !query.trim()}
          className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
        >
          {loading ? "搜索中..." : "搜索"}
        </button>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          {error}
        </div>
      )}

      {/* 搜索结果 */}
      {loading ? (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-slate-200 p-5 animate-pulse">
              <div className="h-4 bg-slate-200 rounded w-3/4 mb-3" />
              <div className="h-3 bg-slate-100 rounded w-full mb-2" />
              <div className="h-3 bg-slate-100 rounded w-2/3" />
            </div>
          ))}
        </div>
      ) : searched && results.length === 0 && !error ? (
        <div className="text-center py-16">
          <div className="text-5xl mb-4">🔍</div>
          <p className="text-slate-500 mb-2">未找到相关文档</p>
          <p className="text-sm text-slate-400">请尝试更换搜索关键词</p>
        </div>
      ) : (
        <>
          {/* 实体标签行 */}
          {response?.matchedKeywords && response.matchedKeywords.length > 0 && (
            <div className="mb-4 flex items-center gap-1.5 flex-wrap">
              <span className="text-xs text-slate-400 flex-shrink-0">🔍 识别实体:</span>
              {response.matchedKeywords.map((kw, i) => (
                <span
                  key={i}
                  className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200"
                >
                  {kw}
                </span>
              ))}
            </div>
          )}

          {results.length > 0 && (
            <div className="mb-4 text-sm text-slate-500">
              共找到 {results.length} 条结果
            </div>
          )}
          <div className="space-y-4">
            {results.map((result) => (
              <div
                key={result.id}
                className="bg-white rounded-xl border border-slate-200 p-5 hover:border-indigo-300 transition-colors shadow-sm"
              >
                {/* 标题行 */}
                <div className="flex items-start justify-between mb-2">
                  <h3 className="text-base font-semibold text-slate-900">
                    {result.docTitle}
                  </h3>
                  <SourceBadge source={result.source} />
                </div>

                {/* 元数据 */}
                <div className="flex flex-wrap gap-2 mb-3">
                  {result.metadata.client && (
                    <MetaTag label="客户" value={result.metadata.client} />
                  )}
                  {result.metadata.project && (
                    <MetaTag label="项目" value={result.metadata.project} />
                  )}
                  {result.metadata.docType && (
                    <MetaTag label="类型" value={result.metadata.docType} />
                  )}
                  {result.metadata.date && (
                    <MetaTag label="日期" value={result.metadata.date} />
                  )}
                  <MetaTag label="相关度" value={`${(result.score * 100).toFixed(1)}%`} />
                </div>

                {/* 高亮内容 */}
                {result.highlight && (
                  <div
                    className="text-sm text-slate-600 leading-relaxed line-clamp-4"
                    dangerouslySetInnerHTML={{
                      __html: result.highlight.replace(
                        /\*\*(.+?)\*\*/g,
                        '<mark class="bg-yellow-200 text-yellow-900 rounded px-0.5">$1</mark>'
                      ),
                    }}
                  />
                )}

                {/* 文档路径 */}
                <div className="mt-2 text-xs text-slate-400 font-mono">
                  {result.docPath}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* 底部提示 */}
      {searched && results.length > 0 && (
        <div className="mt-8 p-4 bg-indigo-50 border border-indigo-200 rounded-xl text-sm text-indigo-700">
          💡 需要更智能的回答？试试{" "}
          <Link href={`/chat?q=${encodeURIComponent(query)}`} className="font-medium underline">
            AI 智能问答
          </Link>
        </div>
      )}
    </div>
  );
}

function SourceBadge({ source }: { source: string }) {
  const styles: Record<string, string> = {
    vector: "bg-purple-100 text-purple-700 border border-purple-200",
    bm25: "bg-amber-100 text-amber-700 border border-amber-200",
    hybrid: "bg-emerald-100 text-emerald-700 border border-emerald-200",
    entity: "bg-red-100 text-red-700 border border-red-200",
  };

  const labels: Record<string, string> = {
    vector: "向量",
    bm25: "BM25",
    hybrid: "混合",
    entity: "实体",
  };

  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${styles[source] || styles.hybrid}`}>
      {labels[source] || source}
    </span>
  );
}

function MetaTag({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-slate-500 bg-slate-100 rounded-md px-2 py-0.5">
      <span className="text-slate-400">{label}:</span>
      {value}
    </span>
  );
}
