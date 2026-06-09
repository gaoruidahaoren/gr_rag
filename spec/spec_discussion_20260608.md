# llm-wiki 多套实现问题分析与重构讨论

> 生成日期：2026-06-08  
> 状态：**讨论中**（先讨论后开发）  
> 原则：每项改动需评估收益/风险/工作量，优先低成本高收益项

---

## 目录

1. [分块逻辑 ×3](#1-分块逻辑-×3)
2. [实体提取 ×2](#2-实体提取-×2)
3. [检索路径 ×3](#3-检索路径-×3)
4. [Query改写 ×2](#4-query改写-×2)
5. [上下文窗口 ×2](#5-上下文窗口-×2)
6. [索引构建 ×2](#6-索引构建-×2)
7. [总结与行动建议](#总结与行动建议)

---

## 1. 分块逻辑 ×3

### 现状

| 位置 | 文件 | 分块策略 |
|------|------|----------|
| **A** | `src/lib/parser.ts` | 运行时解析 Raw/Wiki 文档，按标题 `##` 分块 |
| **B** | `scripts/buildIndex.cjs` | 构建索引时内嵌分块逻辑，按 `##` + `---` 分割 |
| **C** | `scripts/buildIncremental.cjs` | 增量构建时的分块逻辑，与 B 高度相似但独立维护 |

### 差异分析

| 维度 | A (parser.ts) | B (buildIndex) | C (buildIncremental) |
|------|:---:|:---:|:---:|
| 运行环境 | Next.js runtime | Node.js script | Node.js script |
| 分块粒度 | 灵活，可配置 | 固定 `##` + `---` | 与 B 相同 |
| chunk 元数据 | 返回 DocChunk 对象 | 生成 chunkId + content | 与 B 相同 |
| wikiLinks 提取 | ✅ | ✅ | ✅ |
| 输出格式 | TypeScript 类型 | JSON shard 文件 | JSON shard 文件 |

**关键问题**：A/B/C 的分块结果可能不一致。如果 B 改了分块规则，A 和 C 可能没同步，导致运行时解析结果与索引数据不匹配。

### 可行性评估

| 指标 | 评分 | 说明 |
|------|:---:|------|
| **修改必要性** | ⭐⭐⭐⭐☆ (8/10) | 三套逻辑确实需要统一，否则长期维护成本高 |
| **修改风险** | ⭐⭐⭐☆☆ (6/10) | 涉及索引数据格式变更，需全量重建索引 |
| **修改工作量** | ⭐⭐⭐⭐☆ (8/10) | 需要设计统一接口，兼容 ESM/CJS，涉及多个文件 |
| **收益** | ⭐⭐⭐⭐☆ (8/10) | 消除不一致风险，减少未来 bug，新功能只需改一处 |
| **优先级** | 🔴 **高** | 基础设施问题，影响面广 |

### 推荐方案

**方案 A：提取共享 chunker 模块（推荐）**

```
src/lib/chunker.ts (新文件)
├── chunkMarkdown(content, options) → DocChunk[]
├── options: { headingLevel, splitter, minChunkSize, maxChunkSize }
├── 同时导出为 CJS 兼容格式（供 buildIndex/buildIncremental 使用）
```

- `buildIndex.cjs` 和 `buildIncremental.cjs` 引用同一个 chunker
- `parser.ts` 改为薄封装层，调用共享 chunker + 额外运行时逻辑
- 工作量：~2 天
- 风险：需回归测试全部检索链路

**方案 B：只合并 B 和 C，A 独立（次选）**
- B 和 C 共享分块逻辑（它们环境相同，都是 CJS 脚本）
- A 保留独立（运行时可能有不同需求）
- 工作量：~1 天
- 风险：低

### 讨论要点

- [ ] B 和 C 的分块逻辑是否真的完全相同？需要逐行 diff 确认
- [ ] 统一后是否需要支持 A 的灵活配置（如不同 heading level）？
- [ ] 是否要顺便统一 chunkId 生成规则？

---

## 2. 实体提取 ×2

### 现状

| 方法 | 位置 | 策略 |
|------|------|------|
| **LLM 提取** | `src/lib/queryRewriter.ts` → `rewriteQuery()` | 用 LLM 改写 query 时一并输出结构化实体列表 |
| **jieba+字典** | `src/lib/entityRouter.ts` → `extractEntityKeywords()` | 贪心最大匹配，从 Wiki/concept + Wiki/entity 目录加载关键字 |

### 差异分析

| 维度 | LLM 提取 | jieba+字典 |
|------|----------|------------|
| 准确率 | 高（理解语义，处理同义词） | 中（仅字面匹配） |
| 延迟 | 高（~500ms+） | 极低（<5ms） |
| 成本 | 有（API 调用） | 无 |
| 离线可用 | ❌ | ✅ |
| 同义词处理 | ✅ "宝武" → "宝武钢铁" | ❌ 只匹配字面 |
| 未知实体 | ✅ 可提取新实体 | ❌ 只匹配已知列表 |

### 调用链路

```
chat/route.ts
  → smartRewrite() [queryRewriter.ts]
    → rewriteQuery() [LLM 提取] ──成功──→ 返回 entities
    └──失败──→ fallbackExtract() [jieba+字典]
```

**当前设计是串联的**：LLM 优先，失败降级 jieba。这实际上不是"两套"而是"主备"，设计合理。

### 可行性评估

| 指标 | 评分 | 说明 |
|------|:---:|------|
| **修改必要性** | ⭐⭐☆☆☆ (3/10) | 当前主备模式设计合理，不是真正的重复实现 |
| **修改风险** | ⭐⭐☆☆☆ (3/10) | 改动风险低 |
| **修改工作量** | ⭐⭐☆☆☆ (3/10) | 工作量小 |
| **收益** | ⭐⭐☆☆☆ (2/10) | 收益有限，当前设计已经够用 |
| **优先级** | 🟢 **低** | 主备模式是正确的工程实践，不需要改 |

### 推荐方案

**暂不修改**。当前 LLM + fallback 的模式是正确的降级策略。

可选优化（低优先级）：
- LLM 提取时缓存同义词映射，下次 jieba 也能匹配同义词
- 在 jieba 路径也加入模糊匹配（编辑距离 ≤2）

### 讨论要点

- [ ] 是否需要给 LLM 提取的结果做缓存（同 query 不重复调用）？
- [ ] jieba 路径是否需要支持部分匹配/模糊匹配？

---

## 3. 检索路径 ×3

### 现状

| 路径 | 入口 | 策略 |
|------|------|------|
| **实体注入** | `chat/route.ts` → `loadEntityDocsContent()` | 命中实体 → 查 SQLite → 加载 Raw 全文/片段注入 prompt |
| **元信息查询** | `chat/route.ts` → `lookupIndexByQuery()` | 查 index.md 获取客户/项目/概念列表 |
| **RRF 语义检索** | `src/lib/hybridSearch.ts` | 向量 + BM25 → RRF 融合 |

### 差异分析

| 维度 | 实体注入 | 元信息查询 | RRF 语义检索 |
|------|----------|------------|:---:|
| 触发条件 | 实体命中 + SQLite 命中 | 实体未命中 + index 模式匹配 | 无实体命中 |
| 数据源 | Raw 文档全文 | Wiki/index.md | LanceDB + BM25 |
| 返回形式 | 全文/片段注入 prompt | 结构化列表 | chunk 列表 |
| 延迟 | 低（SQLite + 文件读取） | 极低 | 中等（向量+BM25+Rerank） |
| 适用场景 | 精确文档查找 | 列表/统计查询 | 语义分析/问答 |

### 调用链路（chat/route.ts）

```
1. smartRewrite() → entities
2. 如果有 entities → loadEntityDocsContent() [实体注入]
3. 如果无结果 → lookupIndexByQuery() [元信息查询]
4. 如果仍无结果 → hybridSearch() [RRF 语义检索]
```

**注意**：`entityRouter.ts` 的 `routedSearch()` 也有完整的路由逻辑（smartRoute + structured/hybrid/entity/rrf），但 chat/route.ts 并没有使用它，而是自己重新实现了类似的逻辑。

### 可行性评估

| 指标 | 评分 | 说明 |
|------|:---:|------|
| **修改必要性** | ⭐⭐⭐⭐☆ (7/10) | chat/route.ts 和 entityRouter.ts 存在重复路由逻辑 |
| **修改风险** | ⭐⭐⭐⭐☆ (7/10) | 检索是核心链路，改动需充分测试 |
| **修改工作量** | ⭐⭐⭐☆☆ (6/10) | 需要梳理 chat/route.ts 和 entityRouter 的差异，统一接口 |
| **收益** | ⭐⭐⭐⭐☆ (7/10) | 消除重复逻辑，未来新增检索路径只需改一处 |
| **优先级** | 🟡 **中** | 当前功能正确，但维护负担较重 |

### 推荐方案

**统一路由入口到 `entityRouter.ts` 的 `routedSearch()`**：

当前问题：
- `chat/route.ts` 自己实现了 `loadEntityDocsContent()`（查 SQLite → 读 Raw）
- `entityRouter.ts` 的 `routedSearch()` 也有完整的路由逻辑（smartRoute → structured/hybrid/entity/rrf）
- 两套逻辑并行存在，但 chat/route.ts 没用 entityRouter

建议：
1. 将 `loadEntityDocsContent()` 的逻辑合并到 `entityRouter.ts` 的 structured 路径中
2. chat/route.ts 统一调用 `routedSearch()`
3. 将 `lookupIndexByQuery()` 也纳入路由体系

工作量：~3 天
风险：中（核心链路变更）

### 讨论要点

- [ ] chat/route.ts 为什么没用 entityRouter 的 routedSearch？是有意为之还是历史遗留？
- [ ] 合并后是否需要保留 forceMethod 参数（用于调试/A/B 测试）？
- [ ] 元信息查询（index.md）是否应该独立于三路径之外？还是并入 structured？

---

## 4. Query改写 ×2

### 现状

| 方法 | 位置 | 策略 |
|------|------|------|
| **LLM 改写** | `src/lib/queryRewriter.ts` → `rewriteQuery()` | LLM 分析 query → 改写 + 实体提取 + 意图识别 |
| **jieba 仅提取** | `src/lib/queryRewriter.ts` → `fallbackExtract()` | jieba 分词 + 字典匹配（仅提取实体，不改写 query） |

### 差异分析

| 维度 | LLM 改写 | jieba fallback |
|------|----------|:---:|
| 改写 query | ✅ 消歧、补全、标准化 | ❌ 不改写 |
| 提取实体 | ✅ | ✅ |
| 意图识别 | ✅ fact/list/compare/summary/analysis | ❌ 默认 other |
| 延迟 | 高 | 极低 |
| 成本 | 有 | 无 |

### 调用链路

```
chat/route.ts → smartRewrite()
  ├── rewriteQuery() [LLM] ──成功──→ { rewrittenQuery, entities, intent }
  └──失败──→ fallbackExtract() [jieba] → { query不变, entities, intent:'other' }
```

**结论**：与"实体提取 ×2"相同，这是主备设计，不是重复实现。

### 可行性评估

| 指标 | 评分 | 说明 |
|------|:---:|------|
| **修改必要性** | ⭐☆☆☆☆ (1/10) | 主备模式正确，无需修改 |
| **修改风险** | ⭐☆☆☆☆ (1/10) | — |
| **修改工作量** | ⭐☆☆☆☆ (1/10) | — |
| **收益** | ⭐☆☆☆☆ (1/10) | — |
| **优先级** | 🟢 **低** | 无需修改 |

### 推荐方案

**不修改**。当前设计合理。

可选优化（极低优先级）：
- 将 `intent` 字段实际用于路由决策（目前路由用的是 smartRouter 的本地规则+LLM，没有用到 rewrite 的 intent）

### 讨论要点

- [ ] smartRewrite 返回的 `intent` 字段目前没有被路由决策使用，是否需要打通？
- [ ] 是否需要缓存 LLM 改写结果（同一 query 短时间内不重复改写）？

---

## 5. 上下文窗口 ×2

### 现状

| 方法 | 位置 | 策略 |
|------|------|------|
| **本地正则** | `src/lib/hybridSearch.ts` → `localAdaptiveWindow()` | 6 组正则规则匹配 query 模式，返回窗口 1/2/3 或 null |
| **LLM 判断** | `src/lib/hybridSearch.ts` → `llmAdaptiveWindow()` | 本地规则无法确定时，调用 LLM 判断窗口大小 |

另外，`chat/route.ts` 的 `loadEntityDocsContent()` 中还有一套硬编码的上下文窗口逻辑：

```typescript
// chat/route.ts 第 288-292 行
const SHORT_DOC_TOKEN_LIMIT = 3000;
const CONTEXT_WINDOW = 200;  // 固定窗口
const MAX_SNIPPETS_PER_DOC = 3;
```

这套逻辑用于长文档截断（±200 token 窗口提取实体附近内容），与 hybridSearch 的自适应窗口是不同场景。

### 差异分析

| 维度 | 本地正则 (hybridSearch) | LLM 判断 (hybridSearch) | 硬编码 (chat/route) |
|------|:---:|:---:|:---:|
| 用途 | Small-to-Big 扩展窗口 | Small-to-Big 扩展窗口 | 长文档截断窗口 |
| 窗口值 | 1/2/3 (chunk 数量) | 1/2/3 (chunk 数量) | 200 (token 数) |
| 触发时机 | 每次 RRF 检索后 | 本地规则未命中时 | 实体文档加载时 |
| 延迟 | 0 | ~300ms | 0 |
| 成本 | 无 | 有 | 无 |

### 可行性评估

| 指标 | 评分 | 说明 |
|------|:---:|------|
| **修改必要性** | ⭐⭐⭐☆☆ (5/10) | hybridSearch 的主备模式合理，但 chat/route 的硬编码窗口可以参数化 |
| **修改风险** | ⭐⭐☆☆☆ (3/10) | 改动风险低 |
| **修改工作量** | ⭐⭐☆☆☆ (3/10) | 将硬编码常量提取为可配置参数 |
| **收益** | ⭐⭐⭐☆☆ (5/10) | 可调优窗口大小，改善检索质量 |
| **优先级** | 🟡 **中低** | 主备模式合理，硬编码窗口可优化 |

### 推荐方案

1. **hybridSearch 的 localAdaptiveWindow + llmAdaptiveWindow**：保持现状，这是正确的降级策略
2. **chat/route.ts 的硬编码窗口**：将 `CONTEXT_WINDOW`、`SHORT_DOC_TOKEN_LIMIT`、`MAX_SNIPPETS_PER_DOC` 提取为可配置参数（环境变量或配置文件）

```typescript
// 建议提取到 config
const CONTEXT_WINDOW = parseInt(process.env.ENTITY_SNIPPET_WINDOW || '200');
const SHORT_DOC_TOKEN_LIMIT = parseInt(process.env.SHORT_DOC_TOKEN_LIMIT || '3000');
const MAX_SNIPPETS_PER_DOC = parseInt(process.env.MAX_SNIPPETS_PER_DOC || '3');
```

工作量：~0.5 天

### 讨论要点

- [ ] chat/route 的长文档截断窗口（200 token）是否合理？是否需要根据模型上下文窗口动态调整？
- [ ] 是否需要将 chat/route 的固定窗口也改为自适应（如用 hybridSearch 的 adaptiveContextWindow）？

---

## 6. 索引构建 ×2

### 现状

| 脚本 | 文件 | 策略 |
|------|------|------|
| **全量构建** | `scripts/buildIndex.cjs` | 遍历所有 Raw/Wiki 文档 → 分块 → 向量化 → 写入 LanceDB + BM25 + chunks_meta |
| **增量构建** | `scripts/buildIncremental.cjs` | 对比文件 hash → 仅处理变更文件 → 更新索引 |

### 差异分析

| 维度 | 全量构建 | 增量构建 |
|------|----------|----------|
| 处理范围 | 全部文档 | 仅变更文档 |
| 向量化 | 全量重新计算 | 仅新/变更文档 |
| BM25 | 全量重建 | 增量更新 |
| chunks_meta | 全量覆写 | 增量合并 |
| 速度 | 慢（全量） | 快（增量） |
| 一致性 | 100% | 依赖 hash 比对正确性 |

### 代码重复程度

两者共享大量逻辑：
- 文档扫描（Raw/Wiki 目录遍历）
- 分块逻辑（见问题 1）
- chunk 元数据生成
- wikiLinks 提取
- 向量化调用
- BM25 写入

增量构建实际上 = 全量构建 + hash 比对 + 增量合并，但当前是两个独立文件。

### 可行性评估

| 指标 | 评分 | 说明 |
|------|:---:|------|
| **修改必要性** | ⭐⭐⭐⭐☆ (8/10) | 大量重复代码，修复 bug 需要改两处 |
| **修改风险** | ⭐⭐⭐☆☆ (5/10) | 涉及索引构建，改坏会影响检索 |
| **修改工作量** | ⭐⭐⭐⭐☆ (7/10) | 需要抽象公共逻辑，重构两个脚本 |
| **收益** | ⭐⭐⭐⭐☆ (7/10) | 消除重复，增量构建可复用全量构建逻辑 |
| **优先级** | 🔴 **高** | 与问题 1 关联，建议一起解决 |

### 推荐方案

**将公共逻辑抽取为共享模块，全量和增量共用**：

```
scripts/
├── lib/
│   ├── chunker.cjs          # 统一分块逻辑（解决问题 1）
│   ├── indexWriter.cjs      # LanceDB + BM25 + chunks_meta 写入
│   ├── scanner.cjs          # Raw/Wiki 文档扫描
│   └── hasher.cjs           # 文件 hash 比对
├── buildIndex.cjs           # 全量构建（调用 lib/*）
└── buildIncremental.cjs     # 增量构建（调用 lib/* + hasher）
```

工作量：~3 天（与问题 1 合并解决）
风险：中

### 讨论要点

- [ ] 增量构建的 hash 比对策略是否可靠？有无漏更新/误更新的情况？
- [ ] 是否考虑用 git diff 替代文件 hash 做增量检测？
- [ ] 重构后是否需要保留"独立运行"能力（不依赖 lib/ 目录）？

---

## 总结与行动建议

### 优先级矩阵

| 问题 | 必要性 | 风险 | 工作量 | 收益 | **优先级** | 建议 |
|------|:---:|:---:|:---:|:---:|:---:|------|
| 1. 分块逻辑 ×3 | 8 | 6 | 8 | 8 | 🔴 **高** | 提取共享 chunker 模块 |
| 6. 索引构建 ×2 | 8 | 5 | 7 | 7 | 🔴 **高** | 与问题1合并，抽取公共 lib |
| 3. 检索路径 ×3 | 7 | 7 | 6 | 7 | 🟡 **中** | 统一到 routedSearch() |
| 5. 上下文窗口 ×2 | 5 | 3 | 3 | 5 | 🟡 **中低** | 硬编码常量参数化 |
| 2. 实体提取 ×2 | 3 | 3 | 3 | 2 | 🟢 **低** | 无需修改 |
| 4. Query改写 ×2 | 1 | 1 | 1 | 1 | 🟢 **低** | 无需修改 |

### 建议执行顺序

| 阶段 | 内容 | 预估工期 | 依赖 |
|------|------|:---:|------|
| **Phase 1** | 问题 1 + 6：统一分块逻辑 + 合并构建脚本公共模块 | 4 天 | 无 |
| **Phase 2** | 问题 3：统一检索路由入口 | 3 天 | Phase 1 |
| **Phase 3** | 问题 5：上下文窗口参数化 | 0.5 天 | 无 |
| — | 问题 2 + 4：保持现状 | — | — |

### 讨论决策点

请团队成员对以下问题给出意见：

1. **分块逻辑统一方案**：方案 A（全部统一）还是方案 B（仅统一构建脚本）？
2. **检索路由统一**：chat/route.ts 没有用 entityRouter 的原因是什么？是有意为之还是历史遗留？
3. **增量构建可靠性**：当前 hash 比对是否有已知的漏更新/误更新问题？
4. **重构时机**：是否等当前迭代的功能稳定后再做重构？还是趁早解决技术债？
5. **回归测试策略**：重构后的回归测试方案是什么？是否有自动化测试覆盖检索链路？

---

> **结论**：6 个问题中，2 个是真正的重复实现需要重构（分块逻辑、索引构建），1 个存在路由逻辑冗余需要统一（检索路径），1 个可低成本优化（上下文窗口），2 个是正确的主备设计无需修改（实体提取、Query改写）。

---

## 重构记录：问题 1 + 6（2026-06-08）

### 已完成的改动

#### 新增公共模块 `scripts/lib/`

| 模块 | 文件 | 职责 |
|------|------|------|
| `chunker.cjs` | 统一文档分块器 | `chunkDocument()` / `extractTitle()` / `parseFilename()` / `extractWikiLinks()` / `buildWikiChunk()` |
| `scanner.cjs` | 文件扫描器 | `scanRawDocuments()` / `scanWikiEntries()` / `scanAll()` |
| `tokenizer.cjs` | jieba 分词（单例） | `tokenize()` |
| `embedder.cjs` | DashScope Embedding 调用 | `getEmbeddingsBatch()` |
| `hasher.cjs` | 文件 Hash 工具 | `fileHash()` / `buildStateSnapshot()` |
| `indexWriter.cjs` | 索引写入器 | `writeChunksMeta()` / `writeBM25Index()` / `writeParents()` / `writeVectorConfig()` |
| `envLoader.cjs` | 环境变量加载 | `loadEnv()` |

#### 重构后的脚本

| 脚本 | 重构前 | 重构后 | 变化 |
|------|:---:|:---:|------|
| `buildIndex.cjs` | 570 行 | **239 行** | -58%，引用 6 个 lib 模块 |
| `buildIncremental.cjs` | 842 行 | **511 行** | -39%，引用 6 个 lib 模块 |
| 公共模块 | 0 | 653 行 | 新增，一次编写两处共享 |

#### parser.ts 修复

- **修复 chunkIndex 跨 section 重复 bug**：将 section 内独立分块改为全局统一收集句子后再分块，与 `chunker.cjs` 逻辑一致
- 降级分块参数统一为 MAX_CHUNK_SIZE=1000（与构建脚本一致）

#### 验证结果

- ✅ 所有 7 个 lib 模块独立加载测试通过
- ✅ chunkIndex 无重复验证通过
- ✅ parentDocId 一致性验证通过
- ✅ 降级分块逻辑验证通过
- ✅ parser.ts lint 无新增错误

---

## 专项分析：用户 Query 语义路由硬编码规则覆盖评估（2026-06-09）

> 分析范围：4 个模块中的硬编码正则/关键词规则，评估是否有常见用户 query 未被覆盖。

### 分析对象

| # | 模块 | 文件 | 硬编码规则数 | 核心用途 |
|---|------|------|:---:|------|
| A | **smartRouter 路由决策** | `src/lib/smartRouter.ts` | ~28 条正则 | 判断 query 走 structured/semantic/hybrid |
| B | **indexLookup 元信息查询** | `src/lib/indexLookup.ts` | 12 个章节 + ~65 关键词 | 匹配 index.md 中的章节内容 |
| C | **adaptiveWindow 上下文窗口** | `src/lib/hybridSearch.ts` | ~25 条正则 | 判断 Small-to-Big 扩展窗口大小 |
| D | **isFollowUpQuery 追问检测** | `src/lib/sessionManager.ts` | 10 条正则 | 检测用户是否在追问上一轮 |

---

### A. smartRouter 路由决策规则分析

#### A1. STRUCTURED_PATTERNS（18 条正则）

当前覆盖：
```
文档列表类：有哪些文档、关联文档、涉及哪些文档、列出所有文档、相关的所有文档、
           查文档列表、文档有哪些、涉及了哪些
项目/客户类：哪些项目用到了、哪些客户做、在哪些中、出现在哪些
统计类：    统计数量、有多少文档
实体维度类：有哪几家/些/个、哪些公司/项目/客户/部门/团队/系统/平台/产品/服务/应用、
           公司/项目/客户/部门/团队用了、多少公司/几个项目、
           属于哪些、做了哪些、被哪些使用、在哪些公司/项目
```

**未覆盖场景（疑似遗漏）**：

| 场景 | 示例 query | 当前行为 | 风险 |
|------|-----------|---------|------|
| **"谁负责/谁在做"** | "徐峰负责哪些项目"、"谁在做ERP" | 不命中 STRUCTURED，走 hybrid → 可能漏掉结构化关联 | 中 |
| **"什么时候做的"** | "宝武钢铁什么时候做的微服务" | 不命中任何模式，走 hybrid | 低 |
| **"哪些人参与了"** | "哪些人参与了国家电网项目" | "哪些" 可能命中 `/有(?:哪\|多少)(?:几?家\|些\|个)/`，但"人"不在实体类型列表中 | 中 |
| **"项目进度/状态"** | "国家电网项目进度怎么样" | 不命中 STRUCTURED，走 semantic → 合理 | 无 |
| **"技术栈/用了什么"** | "这个项目用了什么技术"、"用了什么数据库" | 不命中 STRUCTURED（因为 "用了" 前面没有公司/项目等实体词） | 中 |
| **"所有文档"** | "列出所有文档" | 命中 `/列出.*(?:所有\|全部).*文档/` → structured ✅ | 无 |
| **"某个文档的内容"** | "打开xxx文档"、"看xxx方案" | 不命中 → hybrid | 低 |
| **"最近/最新的文档"** | "最近更新的文档有哪些"、"最新的技术方案" | 不命中 STRUCTURED（无"最近/最新"相关模式） | 低 |
| **"有没有/是否存在"** | "有没有关于ERP的文档"、"是否存在微服务相关文档" | 不命中 STRUCTURED → hybrid | 中 |
| **"给我看看/找一下"** | "给我看看Kubernetes的文档"、"找一下Redis相关文档" | 不命中 → hybrid | 低 |

#### A2. SEMANTIC_PATTERNS（11 条正则）

当前覆盖：是什么/谁/多少、怎么做/实现/配置/部署、如何、为什么、对比/比较/区别/差异、总结/归纳/概括、分析/评估、建议/推荐、好不好/行不行/可不可以、的意思、解释

**未覆盖场景**：

| 场景 | 示例 query | 当前行为 | 风险 |
|------|-----------|---------|------|
| **"介绍一下"** | "介绍一下微服务架构"、"介绍ERP系统" | 不命中任何模式 → 走 hybrid（有实体时）或 semantic | 低 |
| **"讲一下/说说"** | "讲一下这个项目的技术方案"、"说说架构设计" | 不命中 → hybrid | 低 |
| **"帮我理解"** | "帮我理解一下这个架构" | 不命中 → hybrid | 低 |
| **"有什么特点/优势"** | "微服务有什么特点"、"K8s的优势" | "有什么"可能部分命中 `/.*是(?:什么\|谁\|多少)/`，但不稳定 | 低 |

#### A3. 关键逻辑链分析

在 `localRuleJudge()` 中：
1. matchedEntries 为空 → 先检查 `isIndexQuery()`，否则走 semantic ✅
2. 匹配 STRUCTURED_PATTERNS → structured ✅
3. 匹配 SEMANTIC_PATTERNS → semantic ✅
4. matchedEntries >= 1 且未命中上述两种 → **hybrid** ⚠️

**风险点**：第 4 步的兜底逻辑 "只要匹配到实体就 hybrid" 可能导致：
- "徐峰是谁" → 有实体 "徐峰"，但这是**事实查询**而非文档列表，hybrid 会让它去查 SQLite 关联文档，而这些关联文档可能跟 "徐峰是谁" 的回答无关
- "Redis 怎么配置" → 有实体 "Redis"，hybrid 会查 Redis 关联文档列表，但用户实际需要的是**技术指导**

### B. indexLookup 元信息查询规则分析

#### B1. 章节映射覆盖

当前 12 个章节的 intentKeywords 覆盖：

| 章节 | 关键词覆盖 | 缺失的关键词 |
|------|----------|------------|
| 客户列表 | 客户、客户列表、客户数量、有哪些客户、所有客户、全部客户、哪些客户、客户都有哪些、公司 | "甲方"、"业主"、"客户方" |
| 文档类型 | 文档类型、有哪些文档类型、文档分类、所有文档类型 | "文档类别"、"有哪些类型的文档" |
| 项目类型 | 项目类型、有哪些项目、项目系统、所有项目、哪些项目、项目列表 | "做过哪些项目"、"项目汇总" |
| 概念索引 | 概念、有哪些概念、概念列表、所有概念、全部概念、概念索引 | "术语"、"知识图谱"、"词条" |
| 实体索引 | 实体、有哪些实体、实体列表、所有实体、全部实体、实体索引 | "标签"、"实体标签" |
| 技术组件 | 技术组件、有哪些技术、技术栈、用了哪些技术、技术列表、组件 | "中间件"、"框架"、"用了什么技术"、"用什么开发的" |
| 人员 | 人员、有哪些人、成员、员工、团队人员 | "谁"、"都有谁"、"参与人员"、"负责人" |
| 部门 | 部门、有哪些部门、组织架构、部门列表 | "团队"、"组织"、"机构"、"事业部" |
| 全部原始文档 | 所有文档、全部文档、文档列表、原始文档、全部原始文档 | "文档总览"、"所有资料"、"全量文档" |
| 知识库概览 | 概览、统计、数量、有多少、知识库概况、overview | "总共"、"汇总"、"概况"、"知识库有多少" |

#### B2. 章节内容提取的潜在 Bug

```typescript:165:167:src/lib/indexLookup.ts
// 遇到下一个同级标题时停止
if (bestSection.stopPattern.test(line) && !bestSection.titlePattern.test(line)) {
  break;
}
```

**问题**：对于 `### 客户企业` 这样的子章节，`stopPattern: /^###\s+/` 无法区分同级的其他 `###` 子章节（如 `### 技术组件`），会一次性提取整个父章节下的所有内容，而不是只提取目标子章节。

### C. adaptiveWindow 上下文窗口规则分析

5 条规则的优先级链：数据查询(±3) → 分析对比(±2) → 结构化命中(±2) → 简单事实(±1) → query长度自适应(±1~2) → LLM

#### C1. 数据/表格查询规则（→ ±3）

当前覆盖：金额/费用/成本/预算、数量/个数/几次、统计/汇总/合计、表格/列表/清单/明细/账目/发票/回款/付款、数据查询、进度/完成率、具体多少/一共多少

**未覆盖**：

| 场景 | 示例 query | 风险 |
|------|-----------|------|
| **"资源/人力"** | "项目投入了多少人力"、"服务器资源使用情况" | 中 |
| **"时间线/里程碑"** | "项目的关键时间节点"、"什么时候上线的" | 低（走 LLM） |
| **"性能指标"** | "系统QPS是多少"、"响应时间多少" | 低（走 LLM） |

#### C2. 分析/对比规则（→ ±2）

**未覆盖**：

| 场景 | 示例 query | 风险 |
|------|-----------|------|
| **"介绍/概述"** | "介绍一下项目背景"、"系统概述" | 低 |
| **"流程/步骤"** | "部署流程是怎样的"、"审批流程" | 中 |

#### C3. 简单事实规则（→ ±1）

**未覆盖**：

| 场景 | 示例 query | 风险 |
|------|-----------|------|
| **"是谁/谁做的"** | 不命中 `/负责人\|谁负责/` 但本质也是简单事实 | 低 |
| **"几个/多少"** | "项目有几个"、"用了多少个服务" → 会先命中数据查询规则 → ±3 | 中（过度扩展） |

**潜在冲突**：规则 1 的数据查询中有 `/多少[钱费]\|金额\|.../` 和 `/数量\|个数\|几次\|多少[个次台套项]/`，但 "多少" 也在规则 5 的长度自适应中会 fallthrough。对于 "多少个" 类简单问题，可能被规则 1 误判为需要 ±3 窗口，实际 ±1 就够了。

### D. isFollowUpQuery 追问检测规则分析

当前 10 条正则覆盖：
- 指代词："那/那么/这个/第二个/它/他/她/这些"
- 详细展开："详细说说/具体讲讲/展开解释"
- 补充："还有呢/另外呢"
- 承接："然后呢/接下来呢"
- 追问："这是什么/那是什么/为什么"
- 回指："上面/前面/刚才/之前提到的"
- 比较："它和/跟/与/比"
- 继续："再说/继续/接着说"
- 澄清："什么意思/为什么"

**未覆盖场景**：

| 场景 | 示例 query | 风险 |
|------|-----------|------|
| **"那...呢"（省略追问）** | "那进度呢"、"那人呢"、"那成本呢" | 中（"那"已命中但 "呢" 结尾更明确） |
| **"还有别的吗"** | "还有别的吗"、"还有其他吗" | 低（"还有" 已命中） |
| **"就这些？"** | "就这些？"、"没了吗" | 高（纯确认/反问，完全不命中） |
| **"第一/二/三个呢"** | "第一个呢"、"第三个怎么样" | 中（"第一个" 在规则中但 "第三个怎么样" 可能不命中） |
| **"前面说的"** | "前面说的那个方案"、"你刚才提到的" | 低（"前面" 和 "刚才" 已覆盖） |
| **"不对/不是"** | "不是这个意思"、"不对，我说的是..." | 高（纠错场景完全不命中，会丢失上一轮上下文） |
| **"重新回答/再查"** | "重新查一下"、"再搜一次" | 中 |

### 总结：高优先级遗漏场景

| 优先级 | 模块 | 遗漏场景 | 建议 |
|:---:|------|------|------|
| 🔴 高 | **isFollowUpQuery** | 纠错场景（"不对/不是这个"）、确认反问（"就这些？"） | 新增 2 条正则 |
| 🔴 高 | **smartRouter** | "谁负责/谁在做"类结构化查询、"有没有/是否存在"类查询 | 新增 2-3 条正则 |
| 🟡 中 | **indexLookup** | 子章节边界提取 bug（### 级别停不下来） | 修复 stopPattern 逻辑 |
| 🟡 中 | **adaptiveWindow** | "多少个" 类简单问题被误判为数据查询 → 过度扩展窗口 | 调整规则 1 的优先级 |
| 🟡 中 | **smartRouter** | "介绍一下/讲一下" 类 query 无明确路由 | 新增 SEMANTIC 规则 |
| 🟢 低 | **indexLookup** | "甲方/中间件/事业部"等别名未覆盖 | 补充关键词 |
| 🟢 低 | **adaptiveWindow** | "流程/步骤"类、"性能指标"类 | 补充规则 |

### 建议行动

1. **优先修复 isFollowUpQuery 纠错场景**（用户纠错时丢失上下文影响最大）
2. **smartRouter 补充 "谁负责/有没有" 模式**（高频查询场景）
3. **indexLookup 子章节边界 bug**（当前会返回过多无关内容）
4. **adaptiveWindow 调整规则顺序**（"多少个" 不应走 ±3 窗口）

是否需要我立即实施上述修复？或者先团队讨论再动手？

---

## 实施记录：LLM 统一路由决策（2026-06-09）

> 决策：用一次轻量 LLM 调用统一覆盖 4 个模块的路由判断，同时保留硬编码作为降级策略。

### 改动方案

将 `queryRewriter` 的 LLM prompt 扩展，让其同时输出 `isFollowUp`、`route`、`contextWindow`、`indexSection` 四个路由决策字段。一次 LLM 调用覆盖原先 4 个独立模块的判断逻辑。

**架构变化：**

```
之前（2 次 LLM + 4 个硬编码）：
  queryRewriter (LLM) → isFollowUpQuery (硬编码) → smartRouter (硬编码/LLM) 
  → indexLookup (硬编码) → adaptiveWindow (硬编码/LLM) → RAG Chat (LLM)

之后（2 次 LLM + 硬编码降级）：
  queryRewriter + 路由决策 (LLM) → RAG Chat (LLM)
        ↓ LLM 失败时
  硬编码降级：isFollowUpQuery + indexLookup + adaptiveWindow（本地规则）
```

**LLM 新增输出字段：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `isFollowUp` | boolean | 是否为追问/纠错/反问（覆盖原 sessionManager 10条正则） |
| `route` | "structured"\|"semantic"\|"hybrid" | 检索路由决策（覆盖原 smartRouter 28条正则） |
| `contextWindow` | 1\|2\|3 | Small-to-Big 窗口大小（覆盖原 adaptiveWindow 25条正则） |
| `indexSection` | string\|null | index.md 章节命中（覆盖原 indexLookup 65关键词） |

### 降级策略

当 LLM 调用失败或返回格式异常时，`routeDecision` 为 `null`，各模块回退到本地硬编码：

- `isFollowUp` → 调用 `isFollowUpQuery()`（原 10 条正则）
- `indexSection` → 调用 `isIndexQuery()`（原关键词匹配）
- `contextWindow` → `ragEngine` 内部调用 `adaptiveContextWindow()`（原 25 条正则 + LLM fallback）
- `route` → chat/route.ts 直接走 `structured`（有实体时）或 `semantic`

### 改动文件

| 文件 | 改动 |
|------|------|
| `src/lib/queryRewriter.ts` | 新增 `LlmRouteDecision` 类型；扩展 LLM prompt 输出路由字段；`smartRewrite()` 返回值新增 `routeDecision` |
| `src/app/api/chat/route.ts` | 用 `routeDecision` 替代独立 `isFollowUpQuery()`/`lookupIndexByQuery()` 调用；fallback 时保留硬编码逻辑；传递 `contextWindowOverride` 给 ragEngine |
| `src/lib/ragEngine.ts` | options 新增 `contextWindowOverride`；有 override 时跳过 `adaptiveContextWindow()` 调用 |

### 关键设计点

1. **零额外 LLM 调用**：路由决策复用 `queryRewriter` 已有的 LLM 调用，只是多输出几个字段（token 增加约 50-100）
2. **硬编码降级不删除**：所有原硬编码模块保留，仅在 `routeDecision === null` 时作为 fallback 触发
3. **窗口优先级链**：`contextWindowOverride`（LLM路由） > `adaptiveContextWindow` 本地规则 > `adaptiveContextWindow` LLM判断
4. **`contextWindowOverride` 避免了二次 LLM 调用**：ragEngine 内不需要再调用 `adaptiveContextWindow` 的 LLM 判断
