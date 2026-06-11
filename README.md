# 星辰Wiki - 企业知识库智能检索系统

基于 **RAG + 混合检索** 的企业内部项目文档智能知识库。

## 技术架构全景

```
用户查询
    │
    ├── ① 语义路由 ──── LLM 分析查询意图 ──→ structured / semantic / hybrid
    │                      ↓
    ├── ② Query 改写 ──── LLM 改写 + 提取实体 + 判断上下文窗口
    │                      ↓
    └── ③ 混合检索 ──── 双路召回 → RRF 融合
                         │
          ┌──────────────┼──────────────┐
          ↓              ↓              ↓
     向量检索      BM25 检索     结构化查询
    (1024维)     (jieba分词)   (SQLite DB)
    top20        top20         关联文档
          └──────────────┼──────────────┘
                         ↓
                  RRF(k=60) 融合
                         ↓
                    top5 文档块
                         │
          ┌──────────────┼──────────────┐
          ↓              ↓              ↓
      搜索结果       RAG 生成      流式输出
     展示排序        (LLM)        (SSE)
```

---

## 完整检索流程

### ① 语义路由层（Unified Router）

**目标**：一次 LLM 调用同时完成路由决策 + Query 改写 + 实体提取，零额外开销。

| 路由类型 | 触发条件 | 检索行为 |
|---------|---------|---------|
| `structured` | 查询关联文档列表（如"哪些项目用了Redis"、"宝武钢铁有哪些文档"） | 从 SQLite 结构化数据库查关联文档 |
| `semantic` | 理解/分析类问题（如"微服务架构设计原则是什么"） | 走向量+BM25 语义检索 |
| `hybrid` | 既要列表又要内容（如"哪些客户做了ERP，技术架构如何"） | 结构化+语义双路并行后融合 |

**策略**：
- **LLM-first（主路径）**：一次 LLM 调用输出 `route` + `isFollowUp` + `contextWindow` + `indexSection` 四个决策字段
- **正则降级（fallback）**：LLM 不可用时，38 条正则规则（结构化/语义/追问）兜底，零延迟降级

### ② Query 改写层（Query Rewriter）

**目标**：将用户自然语言转化为检索友好的表达，并提取结构化实体。

一次 LLM 调用同时完成 6 件事：

| 输出字段 | 说明 |
|---------|------|
| `rewritten` | 改写后的检索语句（同义词展开、隐含实体补全、术语标准化） |
| `entities` | 从 query 中提取的实体关键词列表（与 SQLite 词条匹配） |
| `intent` | 查询意图：`fact` / `list` / `compare` / `summary` / `analysis` |
| `routeDecision` | 统一路由决策（`route` + `isFollowUp` + `contextWindow` + `indexSection`） |
| `contextWindow` | 上下文窗口大小（1=小/2=中/3=大），控制召回粒度 |

**降级策略**：LLM 不可用时 → `fallbackRoute()` 正则匹配（38 条规则）+ jieba 分词 + 字典匹配

### ③ 混合检索层（Hybrid Search）

双路并行召回，结果通过 **RRF（Reciprocal Rank Fusion）** 融合：

```
RRF(d) = Σ 1/(k + rank_i(d))，k = 60
```

| 检索通路 | 技术方案 | 召回量 |
|---------|---------|-------|
| 向量检索 | DashScope `text-embedding-v4`，1024维，余弦相似度，LanceDB IVF_PQ 索引 | top20 |
| BM25 检索 | @node-rs/jieba 分词，纯 JS 倒排索引，支持自定义词典 | top20 |
| 结构化查询 | SQLite 词条数据库（公司/项目/人员/技术栈 → 关联文档） | 全部匹配 |

融合后输出 **top5 文档块**，无 LLM 时降级为检索结果直接展示。

### ④ RAG 生成层（RAG Engine）

将 top5 文档块拼入 prompt，调用 LLM（兼容 OpenAI 格式）生成回答，支持：
- **流式输出**（SSE），实时显示生成进度
- **思考模型支持**（自动识别 `mimo`/`reasoning` 模型，调整 temperature）
- **多轮对话**：基于 session 管理上下文，支持追问、指代消解

---

## 核心技术设计

### 多路召回 + RRF 融合

单一检索方式各有局限：
- **向量检索**：语义相关性好，但精确术语召回弱
- **BM25**：精确术语匹配强，但无法捕捉语义相关性

RRF 融合兼顾两者优势，k=60 平滑参数防止排名差异过大影响融合结果。

### 统一路由决策（一次 LLM 调用替代多次）

传统方案每个模块独立调用 LLM，本系统将追问检测、路由决策、上下文窗口判断合并为**一次 LLM 调用**，降低延迟和 token 消耗。

### 分层降级策略

```
LLM 可用 → 完整 pipeline（路由决策+改写+检索+RAG）  ← 主路径
LLM 失败 → 正则 fallbackRoute() + jieba 分词 → 检索结果降级展示
```

降级链路（LLM 不可用时各模块独立兜底）：

| 决策项 | LLM 主路径 | 正则降级 |
|--------|-----------|---------|
| `route`（路由类型） | `routeDecision.route` | `fallbackRoute()` 38 条正则 |
| `isFollowUp`（追问检测） | `routeDecision.isFollowUp` | `isFollowUpQuery()` 10 条正则 |
| `contextWindow`（窗口大小） | `routeDecision.contextWindow` | `adaptiveContextWindow()` 25 条正则 |
| `indexSection`（章节命中） | `routeDecision.indexSection` | `lookupIndexByQuery()` 65 关键词 |

### @node-rs/jieba 自定义词典

内置 80+ 业务术语（客户企业、技术组件、部门、业务系统），最高优先级 100，确保专业词汇不被错误切分。例如：
- `Kubernetes` 不被切成 `Kuber`、`netes`
- `国家电网` 不被切成 `国家`、`电网`

---

## 快速开始

```bash
# 1. 安装依赖
cd llm-wiki
npm install

# 2. 构建索引（首次必须运行）
node scripts/buildIndex.cjs

# 3. 启动开发服务器
npm run dev

# 4. 访问 http://localhost:3000
```

---

## 环境配置

复制 `.env` 为 `.env.local`，配置 LLM API：

```env
OPENAI_API_KEY=sk-xxx
OPENAI_BASE_URL=https://api.xiaomimimo.com/v1
LLM_MODEL=mimo-v2.5

# 向量 Embedding（必填）
DASHSCOPE_API_KEY=sk-xxx
EMBEDDING_MODEL=text-embedding-v4
EMBEDDING_DIM=1024
```

也可以在 AI 问答页面的设置面板中直接配置。

不配置 LLM 时，AI 问答自动降级为基于检索结果的文档摘要展示。

---

## 项目结构

```
llm-wiki/
├── scripts/
│   └── buildIndex.cjs       # 索引构建脚本（文档解析→分块→Embedding→存储）
├── src/
│   ├── app/
│   │   ├── page.tsx          # 首页仪表盘
│   │   ├── search/page.tsx   # 智能搜索页
│   │   ├── chat/page.tsx     # AI 问答页（多轮对话 + 流式输出）
│   │   ├── docs/page.tsx     # 文档浏览页
│   │   └── api/
│   │       ├── search/       # 混合检索 API
│   │       ├── chat/         # RAG 问答 API (SSE)
│   │       ├── stats/        # 知识库统计 API
│   │       └── docs/list/    # 文档列表 API
│   ├── lib/
│   │   ├── types.ts          # 统一类型定义
│   │   ├── parser.ts         # 文档解析器（支持 PDF/MD/TXT/DOCX）
│   │   ├── tokenizer.ts      # jieba 分词 + 业务自定义词典
│   │   ├── embedding.ts       # DashScope Embedding API 调用
│   │   ├── vectorEngine.ts   # LanceDB 向量检索引擎
│   │   ├── bm25Engine.ts     # BM25 倒排索引引擎
│   │   ├── hybridSearch.ts   # 混合检索 + RRF 融合
│   │   ├── entityRouter.ts   # 实体关键词提取（jieba + 字典匹配）
│   │   ├── smartRouter.ts    # 兼容层（re-export，原路由逻辑已迁移至 queryRewriter）
│   │   ├── queryRewriter.ts  # Query 改写 + 实体提取 + 意图分类
│   │   ├── structSearchEngine.ts  # SQLite 结构化检索引擎
│   │   ├── ragEngine.ts      # RAG 生成引擎（OpenAI 兼容 API）
│   │   └── indexManager.ts   # 索引管理器
│   └── data/                 # 预构建索引数据（git 追踪）
│       ├── vectors/          # 向量分片（Shard 0/1）
│       ├── bm25/             # BM25 倒排索引分片
│       ├── chunks_meta/      # 文档块元数据
│       ├── parents/          # 父子文档关系
│       ├── lancedb/          # LanceDB 向量数据库
│       └── struct_kb.db      # SQLite 结构化知识库
└── test/                     # 单元测试（vitest，116 个测试用例）
    ├── tokenizer.test.ts
    ├── hybridSearch.test.ts
    ├── queryRewriter.test.ts   # fallbackRoute 正则降级测试（37 条）
    ├── smartRouter.test.ts     # 兼容层验证
    ├── entityRouter.test.ts
    └── sessionManager.test.ts
```

---

## 技术栈

- **前端**: Next.js 16 + React 19 + Tailwind CSS 4
- **分词**: @node-rs/jieba（结巴分词 Rust 实现，支持业务自定义词典）
- **向量**: 1024维 DashScope `text-embedding-v4` + LanceDB IVF_PQ 索引 + 余弦相似度
- **BM25**: 纯 JS 倒排索引实现（@node-rs/jieba 分词）
- **LLM**: OpenAI 兼容 API（流式 SSE 输出，支持思考模型）
- **向量数据库**: LanceDB（本地文件存储，支持增量索引）
- **结构化数据**: SQLite（词条 → 关联文档映射）
- **测试**: Vitest（116 个测试用例）
