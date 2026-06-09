// ============================================================
// 智能路由器
// 使用 LLM 分析用户 query，判断应该走结构化数据库查询
// 还是走向量/BM25 语义检索
//
// 策略：
//   1. 先用本地规则快速判断（无需 LLM 调用）
//   2. 不确定时用 LLM 分析 query 意图
//   3. 结构化查询：从 SQLite 查出关联文档列表
//   4. 语义检索：走现有的 entityRouter（RRF/实体召回）
// ============================================================

import OpenAI from 'openai';
import type { StructSearchResult } from './structSearchEngine';
import { extractEntityKeywords } from './entityRouter';
import { isIndexQuery } from './indexLookup';

// ============================================================
// 类型定义
// ============================================================

export type RouteDecision = 'structured' | 'semantic' | 'hybrid';

export interface SmartRouteResult {
  /** 路由决策 */
  decision: RouteDecision;
  /** 结构化查询结果（当 decision 为 structured/hybrid 时） */
  structResults?: StructSearchResult[];
  /** 匹配到的词条名 */
  matchedEntries?: string[];
  /** 决策理由 */
  reason: string;
}

// ============================================================
// 本地规则快速判断（零 LLM 调用）
// ============================================================

/**
 * 本地规则判断：
 * - 查询明显是在找"某个概念/实体相关的所有文档" → structured
 * - 查询是自然语言问题，涉及分析/总结/对比 → semantic
 * - 不确定 → 交给 LLM
 */

// 结构化查询模式：用户想知道某个概念/实体关联了哪些文档/项目/公司
const STRUCTURED_PATTERNS = [
  /有哪些.*文档/,
  /关联.*文档/,
  /涉及.*(?:哪些|什么|多少).*文档/,
  /列出.*(?:所有|全部).*文档/,
  /.*相关的.*(?:所有|全部|哪些).*文档/,
  /查.*文档列表/,
  /.*的文档有哪些/,
  /.*涉及了哪些/,
  /哪些.*项目.*用到了/,
  /哪些.*客户.*做/,
  /.*在哪些.*中/,
  /.*出现在.*哪些/,
  /统计.*数量/,
  /有多少.*文档/,
  // 新增：实体维度的结构化查询（查公司、项目、客户等）
  /有(?:哪|多少)(?:几?家|些|个)/,        // "有哪几家"、"有多少个"、"有哪些"
  /哪些.*(?:公司|项目|客户|部门|团队|系统|平台|产品|服务|应用)/, // "哪些公司"、"哪些项目"
  /(?:公司|项目|客户|部门|团队).*用(?:了|过|到)/, // "公司用了"、"项目用到了"
  /(?:多少|几个).*(?:公司|项目|客户)/,   // "多少公司"、"几个项目"
  /(?:属于|归属).*(?:哪些|哪个|什么)/,   // "属于哪些"、"归属于哪个"
  /(?:做了|在做|做过).*(?:哪些|什么)/,   // "做了哪些"
  /.*被.*(?:哪些|多少).*使用/,           // "被哪些公司使用"
  /.*在.*哪些.*(?:公司|项目|客户)/,      // "在哪些项目中"
];

// 语义查询模式：需要理解和分析
const SEMANTIC_PATTERNS = [
  /.*是(?:什么|谁|多少)/,
  /怎么(?:做|实现|配置|部署)/,
  /如何/,
  /为什么/,
  /对比|比较|区别|差异/,
  /总结|归纳|概括/,
  /分析|评估/,
  /建议|推荐/,
  /.*(?:好不好|行不行|可不可以)/,
  /.*的意思/,
  /解释/,
];

/**
 * 本地规则判断（导出供测试使用）
 * @internal for testing
 */
export function localRuleJudge(query: string, matchedEntries: string[]): SmartRouteResult | null {
  // 如果没有匹配到任何词条，走语义检索
  if (matchedEntries.length === 0) {
    // 检查是否为 index.md 元信息查询（客户列表、项目列表等）
    // 注意：此时没有实体命中，可以直接走 index.md 查询
    if (isIndexQuery(query)) {
      return {
        decision: 'structured',
        matchedEntries,
        reason: `匹配到 index.md 元信息查询模式（客户/项目/概念/实体列表等）`,
      };
    }
    return {
      decision: 'semantic',
      matchedEntries: [],
      reason: '未匹配到任何已知概念/实体，使用语义检索',
    };
  }

  // 检查结构化模式
  const isStructured = STRUCTURED_PATTERNS.some(p => p.test(query));
  if (isStructured) {
    return {
      decision: 'structured',
      matchedEntries,
      reason: `查询匹配结构化模式（文档列表/关联查询），匹配词条: [${matchedEntries.join(', ')}]`,
    };
  }

  // 检查语义模式
  const isSemantic = SEMANTIC_PATTERNS.some(p => p.test(query));
  if (isSemantic) {
    return {
      decision: 'semantic',
      matchedEntries,
      reason: `查询匹配语义分析模式（理解/解释/对比），使用语义检索`,
    };
  }

  // 只要匹配到实体关键字，优先走混合检索（结构化数据库 + 语义检索融合）
  // 这样即使 query 偏长（如 "使用了ClickHouse的公司有哪几家"），也能命中数据库
  if (matchedEntries.length >= 1) {
    return {
      decision: 'hybrid',
      matchedEntries,
      reason: `匹配到实体词条 [${matchedEntries.join(', ')}]，优先混合检索（数据库+语义）`,
    };
  }

  // 不确定，返回 null 交给 LLM（此时 matchedEntries 为空，走 semantic 即可）
  return null;
}

// ============================================================
// LLM 智能路由（当本地规则无法确定时）
// ============================================================

async function llmRouteJudge(
  query: string,
  matchedEntries: string[],
  options?: { apiKey?: string; baseURL?: string; model?: string }
): Promise<SmartRouteResult> {
  const apiKey = options?.apiKey || process.env.OPENAI_API_KEY || process.env.LLM_API_KEY || '';
  const baseURL = options?.baseURL || process.env.OPENAI_BASE_URL || process.env.LLM_BASE_URL || '';
  const model = options?.model || process.env.LLM_MODEL || 'gpt-3.5-turbo';

  // 无 API Key 时降级为本地规则
  if (!apiKey) {
    console.log('[SmartRouter] 无 LLM API Key，使用本地规则降级');
    return {
      decision: matchedEntries.length >= 1 ? 'structured' : 'semantic',
      matchedEntries,
      reason: `无 LLM，本地规则降级判断: ${matchedEntries.length >= 1 ? '结构化查询' : '语义检索'}`,
    };
  }

  const entryNamesStr = matchedEntries.length > 0
    ? `\n已知可匹配的概念/实体词条: ${matchedEntries.slice(0, 20).join(', ')}`
    : '\n未匹配到已知的概念/实体词条';

  const systemPrompt = `你是一个智能路由器，负责判断用户的知识库查询应该走"结构化数据库"还是"语义检索"。

## 两种检索方式

### 结构化数据库 (structured)
- 适合：用户想知道某个概念/实体关联了哪些文档
- 典型问题：
  - "微服务相关的文档有哪些"
  - "宝武钢铁涉及了哪些项目"
  - "列出所有用到 Kubernetes 的文档"
  - "哪些项目用到了 Redis"
- 特点：精确匹配，返回文档列表

### 语义检索 (semantic)
- 适合：用户想理解内容、分析问题、获取答案
- 典型问题：
  - "微服务架构的核心设计原则是什么"
  - "宝武钢铁的人力成本是多少"
  - "如何配置 Nacos 服务注册"
  - "总结国家电网项目的技术架构"
  - "对比 MySQL 和 Redis 的使用场景"
- 特点：语义理解，返回相关内容片段

### 混合检索 (hybrid)
- 适合：既需要精确的文档列表，又需要内容分析
- 典型问题：
  - "宝武钢铁的微服务改造项目有哪些，进展如何"
  - "哪些客户做了 ERP 系统，技术架构是怎样的"

## 输出要求
只输出一个 JSON 对象，不要有其他内容：
{"decision": "structured|semantic|hybrid", "reason": "简短理由（中文，不超过30字）"}`;

  const userPrompt = `用户查询: "${query}"${entryNamesStr}

请判断应该使用哪种检索方式，输出 JSON。`;

  try {
    const client = new OpenAI({ apiKey, baseURL: baseURL || undefined });
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0,
      max_tokens: 150,
    });

    const content = response.choices[0]?.message?.content || '';
    // 尝试解析 JSON
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        decision: parsed.decision || 'semantic',
        matchedEntries,
        reason: parsed.reason || 'LLM 判断结果',
      };
    }

    // 解析失败，降级
    console.warn('[SmartRouter] LLM 返回格式异常:', content);
    return {
      decision: 'semantic',
      matchedEntries,
      reason: 'LLM 返回格式异常，降级为语义检索',
    };
  } catch (err: any) {
    console.error('[SmartRouter] LLM 路由判断失败:', err.message);
    // 降级：有匹配词条走 structured，否则走 semantic
    return {
      decision: matchedEntries.length >= 1 ? 'structured' : 'semantic',
      matchedEntries,
      reason: `LLM 调用失败，本地降级: ${matchedEntries.length >= 1 ? '结构化查询' : '语义检索'}`,
    };
  }
}

// ============================================================
// 主路由函数
// ============================================================

/**
 * 智能路由分析
 *
 * 流程：
 *   1. 接收改写后的实体列表（由 queryRewriter 提供，优先 LLM 提取）
 *   2. 本地规则快速判断
 *   3. 不确定时 LLM 判断
 *   4. 根据决策返回路由结果
 *
 * @param query - 原始用户查询
 * @param options - LLM 配置 + 可选的预提取实体列表
 * @param options.matchedEntries - 预提取的实体列表（来自 queryRewriter），跳过 jieba 分词
 */
export async function smartRoute(
  query: string,
  options?: {
    apiKey?: string;
    baseURL?: string;
    model?: string;
    /** 预提取的实体列表（来自 LLM queryRewriter），跳过 jieba 分词 */
    matchedEntries?: string[];
  }
): Promise<SmartRouteResult> {
  // Step 1: 提取实体关键字（优先用 LLM 改写结果，否则降级为 jieba）
  const matchedEntries = options?.matchedEntries ?? extractEntityKeywords(query);
  console.log(`[SmartRouter] 实体关键字: [${matchedEntries.join(', ')}]${options?.matchedEntries ? ' (LLM改写)' : ' (jieba分词)'}`);

  // Step 2: 本地规则快速判断
  const localResult = localRuleJudge(query, matchedEntries);
  if (localResult) {
    console.log(`[SmartRouter] 本地规则判断: ${localResult.decision} (${localResult.reason})`);
    return localResult;
  }

  // Step 3: LLM 判断
  console.log(`[SmartRouter] 本地规则不确定，调用 LLM 判断...`);
  const llmResult = await llmRouteJudge(query, matchedEntries, options);
  console.log(`[SmartRouter] LLM 判断: ${llmResult.decision} (${llmResult.reason})`);
  return llmResult;
}

// ============================================================
// 结构化查询执行
// ============================================================

/**
 * 执行结构化查询：根据匹配到的词条，从 SQLite 查出关联文档列表
 */
export async function executeStructuredQuery(
  matchedEntries: string[],
  mode: 'and' | 'or' = 'or'
): Promise<StructSearchResult[]> {
  const { isStructDbReady, queryByEntry, queryByEntriesAnd, queryByEntriesOr } =
    await import('./structSearchEngine');

  if (!isStructDbReady()) {
    console.warn('[SmartRouter] 结构化数据库未就绪');
    return [];
  }

  if (matchedEntries.length === 1) {
    const result = queryByEntry(matchedEntries[0]);
    return result ? [result] : [];
  }

  if (mode === 'and') {
    return queryByEntriesAnd(matchedEntries);
  }

  return queryByEntriesOr(matchedEntries);
}

/**
 * 将结构化查询结果转换为简洁的文档摘要文本（用于 LLM prompt）
 */
export function formatStructResults(results: StructSearchResult[]): string {
  if (results.length === 0) return '';

  const lines: string[] = [];

  for (const r of results) {
    const typeLabel = r.entry.type === 'concept' ? '概念' : '实体';
    lines.push(`### ${typeLabel}「${r.entry.name}」(频次: ${r.entry.frequency})`);

    if (r.documents.length === 0) {
      lines.push('  (无关联文档)\n');
      continue;
    }

    for (const doc of r.documents) {
      const meta = [doc.client, doc.project, doc.docType].filter(Boolean).join(' | ');
      lines.push(`  - ${doc.title} (${meta})`);
    }
    lines.push(`  共 ${r.documents.length} 篇关联文档\n`);
  }

  return lines.join('\n');
}
