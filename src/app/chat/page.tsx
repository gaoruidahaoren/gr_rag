"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  context?: Array<{
    docTitle: string;
    metadata: Record<string, string>;
    source: string;
    score: number;
    content?: string;  // 切片完整内容
    docPath?: string;
  }>;
  matchedKeywords?: string[];  // 匹配到的实体关键字
  structSummary?: string;      // 结构化数据库查询结果
}

export default function ChatPage() {
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("q") || "";

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState(initialQuery);
  const [loading, setLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState({
    apiKey: "",
    baseURL: "",
    model: "",
    topK: 10,
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // 自动发送初始查询
  useEffect(() => {
    if (initialQuery) {
      sendMessage(initialQuery);
    }
  }, []);

  const sendMessage = useCallback(
    async (text?: string) => {
      const queryText = text || input.trim();
      if (!queryText || loading) return;

      const userMsg: Message = {
        id: Date.now().toString(),
        role: "user",
        content: queryText,
      };

      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setLoading(true);

      // 创建助手消息占位
      const assistantId = (Date.now() + 1).toString();
      const assistantMsg: Message = {
        id: assistantId,
        role: "assistant",
        content: "",
      };
      setMessages((prev) => [...prev, assistantMsg]);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: queryText,
            topK: settings.topK,
            apiKey: settings.apiKey?.trim() || undefined,
            baseURL: settings.baseURL?.trim() || undefined,
            model: settings.model?.trim() || undefined,
          }),
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error("无法读取响应流");

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                setMessages((prev) =>
                  prev.map((msg) => {
                    if (msg.id !== assistantId) return msg;

                    if (data.type === "method") {
                      return {
                        ...msg,
                        matchedKeywords: data.matchedKeywords,
                        structSummary: data.structSummary,
                      };
                    } else if (data.type === "context") {
                      return {
                        ...msg,
                        context: data.results,
                      };
                    } else if (data.type === "token") {
                      return { ...msg, content: msg.content + (data.content || "") };
                    } else if (data.type === "error") {
                      return { ...msg, content: data.content || "发生错误" };
                    }
                    return msg;
                  })
                );
              } catch {
                // 忽略解析错误
              }
            }
          }
        }
      } catch (err: any) {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantId
              ? { ...msg, content: `请求失败: ${err.message}` }
              : msg
          )
        );
      } finally {
        setLoading(false);
      }
    },
    [input, loading, settings.topK]
  );

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 h-[calc(100vh-7rem)] flex flex-col">
      {/* 头部 */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-slate-900">AI 智能问答</h1>
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          设置
        </button>
      </div>

      {/* 设置面板 */}
      {showSettings && (
        <div className="mb-4 p-4 bg-white border border-slate-200 rounded-xl shadow-sm">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">LLM 配置</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1">API Key</label>
              <input
                type="password"
                value={settings.apiKey}
                onChange={(e) => setSettings({ ...settings, apiKey: e.target.value })}
                placeholder="sk-...（留空则使用环境变量）"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Base URL（可选）</label>
              <input
                type="text"
                value={settings.baseURL}
                onChange={(e) => setSettings({ ...settings, baseURL: e.target.value })}
                placeholder="https://api.openai.com/v1"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">模型</label>
              <input
                type="text"
                value={settings.model}
                onChange={(e) => setSettings({ ...settings, model: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">召回文档数</label>
              <select
                value={settings.topK}
                onChange={(e) => setSettings({ ...settings, topK: parseInt(e.target.value) })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {[3, 5, 8, 10].map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto mb-4 space-y-4 pr-2">
        {messages.length === 0 && (
          <div className="text-center py-20">
            <div className="text-5xl mb-4">🤖</div>
            <h2 className="text-xl font-semibold text-slate-700 mb-2">星辰Wiki 智能助手</h2>
            <p className="text-slate-500 mb-6">
              我可以基于知识库文档回答你的问题
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-lg mx-auto">
              {[
                "国家电网的ERP系统架构是怎样的？",
                "物联网管理平台有哪些客户？",
                "最近的项目验收情况如何？",
                "微服务架构改造涉及哪些技术？",
              ].map((q) => (
                <button
                  key={q}
                  onClick={() => {
                    setInput(q);
                    inputRef.current?.focus();
                  }}
                  className="text-left px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:border-indigo-300 hover:text-indigo-700 transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                msg.role === "user"
                  ? "bg-indigo-600 text-white"
                  : msg.role === "system"
                  ? "bg-amber-50 border border-amber-200 text-amber-800"
                  : "bg-white border border-slate-200 text-slate-800 shadow-sm"
              }`}
            >
              {/* 实体标签行：展示从 query 中提取到的实体关键词 */}
              {msg.matchedKeywords && msg.matchedKeywords.length > 0 && (
                <EntityTags keywords={msg.matchedKeywords} />
              )}

              {/* 结构化查询结果 */}
              {msg.structSummary && (
                <StructResultCard
                  structSummary={msg.structSummary}
                  matchedKeywords={msg.matchedKeywords}
                />
              )}

              {/* 检索上下文提示 */}
              {msg.context && msg.context.length > 0 && (
                <ReferenceCards contexts={msg.context} />
              )}

              {/* 消息内容 */}
              <div className="text-sm leading-relaxed whitespace-pre-wrap">
                {msg.content || (
                  <span className="flex items-center gap-1 text-slate-400">
                    <span className="inline-block w-2 h-2 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="inline-block w-2 h-2 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="inline-block w-2 h-2 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}

        <div ref={messagesEndRef} />
      </div>

      {/* 输入框 */}
      <div className="flex gap-3">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
          placeholder="输入问题，基于知识库文档回答..."
          disabled={loading}
          className="flex-1 px-4 py-3 bg-white border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent shadow-sm disabled:opacity-50"
        />
        <button
          onClick={() => sendMessage()}
          disabled={loading || !input.trim()}
          className="px-5 py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm flex items-center gap-2"
        >
          {loading ? (
            <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          )}
          发送
        </button>
      </div>

      <p className="text-xs text-slate-400 text-center mt-3">
        回答基于知识库文档内容生成，请以实际文档为准
      </p>
    </div>
  );
}

/** 结构化数据库查询结果卡片 */
function StructResultCard({
  structSummary,
  matchedKeywords,
}: {
  structSummary: string;
  matchedKeywords?: string[];
}) {
  const [expanded, setExpanded] = useState(false);

  // 解析 structSummary 中的文档条目
  const lines = structSummary.split('\n').filter(l => l.trim());
  const sections: { keyword: string; freq: number; docs: string[] }[] = [];

  let currentSection: { keyword: string; freq: number; docs: string[] } | null = null;
  for (const line of lines) {
    const headingMatch = line.match(/^### (.+?)\(频次:\s*(\d+)\)/);
    if (headingMatch) {
      if (currentSection) sections.push(currentSection);
      currentSection = { keyword: headingMatch[1].trim(), freq: parseInt(headingMatch[2]), docs: [] };
    } else if (line.startsWith('  - ') && currentSection) {
      currentSection.docs.push(line.replace(/^\s*-\s*/, '').trim());
    }
  }
  if (currentSection) sections.push(currentSection);

  const totalDocs = sections.reduce((sum, s) => sum + s.docs.length, 0);

  return (
    <div className="mb-3 pb-3 border-b border-slate-200">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left text-xs text-slate-600 flex items-center gap-1.5 hover:bg-slate-50 rounded-lg px-2 py-1.5 transition-colors"
      >
        <span className={`flex-shrink-0 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}>
          <svg className="w-3 h-3 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </span>
        <span className="font-medium">🗄️ 结构化关联查询</span>
        {matchedKeywords && matchedKeywords.length > 0 && (
          <span className="text-[10px] text-slate-400">
            ({matchedKeywords.join('、')})
          </span>
        )}
        <span className="text-[10px] text-slate-400 font-mono flex-shrink-0 ml-auto">
          {sections.length} 个实体 · {totalDocs} 篇文档
        </span>
      </button>

      {expanded && (
        <div className="mt-1 mx-6 mb-1">
          <div className="text-[11px] leading-relaxed text-slate-600 bg-blue-50/50 border border-blue-100 rounded-lg px-3 py-2 max-h-64 overflow-y-auto">
            {sections.map((section, si) => (
              <div key={si} className={si > 0 ? 'mt-2 pt-2 border-t border-blue-100/50' : ''}>
                <div className="font-semibold text-blue-700 mb-0.5">
                  {section.keyword}
                  <span className="font-normal text-slate-400 ml-1">(频次: {section.freq})</span>
                </div>
                <ul className="space-y-0.5">
                  {section.docs.map((doc, di) => (
                    <li key={di} className="text-slate-500 pl-3">
                      · {doc}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** 参考文档卡片（可折叠展示切片内容） */
function ReferenceCards({
  contexts,
}: {
  contexts: Array<{
    docTitle: string;
    metadata: Record<string, string>;
    source: string;
    score: number;
    content?: string;
    docPath?: string;
  }>;
}) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const toggle = (index: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  return (
    <div className="mb-3 pb-3 border-b border-slate-200">
      <div className="text-xs text-slate-500 mb-1.5">
        📚 参考文档 ({contexts.length} 篇):
      </div>
      <div className="space-y-1.5">
        {contexts.map((ctx, i) => (
          <div key={i}>
            <button
              onClick={() => toggle(i)}
              className="w-full text-left text-xs text-slate-600 flex items-center gap-1.5 hover:bg-slate-50 rounded-lg px-2 py-1.5 transition-colors group"
            >
              {/* 折叠箭头 */}
              <span className={`flex-shrink-0 transition-transform duration-200 ${expanded.has(i) ? 'rotate-90' : ''}`}>
                <svg className="w-3 h-3 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </span>
              <span className="truncate flex-1 font-medium group-hover:text-indigo-700">{ctx.docTitle}</span>
              <span className="text-[10px] text-slate-400 font-mono flex-shrink-0">
                {ctx.score.toFixed(2)}
              </span>
              <SourceBadge source={ctx.source} />
            </button>

            {/* 展开的切片内容 */}
            {expanded.has(i) && ctx.content && (
              <div className="mt-1 mx-6 mb-1">
                <div className="text-[11px] leading-relaxed text-slate-600 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2 max-h-48 overflow-y-auto whitespace-pre-wrap">
                  {ctx.content.replace(/\[\[([^\]]+)\]\]/g, '$1').slice(0, 1500)}
                  {ctx.content.length > 1500 && (
                    <span className="text-slate-400 ml-1">...（内容已截断）</span>
                  )}
                </div>
                {ctx.docPath && (
                  <div className="text-[10px] text-slate-400 mt-0.5 ml-0.5 truncate">
                    来源: {ctx.docPath}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** 实体标签行：醒目展示从 query 中提取的实体/概念关键词 */
function EntityTags({ keywords }: { keywords: string[] }) {
  return (
    <div className="mb-2 flex items-center gap-1.5 flex-wrap">
      <span className="text-[10px] text-slate-400 flex-shrink-0">🔍 识别实体:</span>
      {keywords.map((kw, i) => (
        <span
          key={i}
          className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-indigo-50 text-indigo-700 border border-indigo-200"
        >
          {kw}
        </span>
      ))}
    </div>
  );
}

function SourceBadge({ source }: { source: string }) {
  const styles: Record<string, string> = {
    vector: "bg-purple-100 text-purple-700",
    bm25: "bg-amber-100 text-amber-700",
    hybrid: "bg-emerald-100 text-emerald-700",
    entity: "bg-red-100 text-red-700",
    structured: "bg-blue-100 text-blue-700",
  };

  const labels: Record<string, string> = {
    vector: "向量",
    bm25: "BM25",
    hybrid: "混合",
    entity: "实体",
    structured: "数据库",
  };

  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${styles[source] || "bg-slate-100 text-slate-600"}`}>
      {labels[source] || source}
    </span>
  );
}


