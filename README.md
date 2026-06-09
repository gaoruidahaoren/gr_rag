# 星辰Wiki - 企业知识库智能检索系统

基于 **RAG + 混合检索** 的企业内部项目文档智能知识库。

## 检索架构

```
用户查询
    │
    ├──→ 向量检索 (DashScope 1024维, top20)
    │
    ├──→ BM25 检索 (倒排索引, top20)
    │
    └──→ RRF 加权融合 → top5 文档块
              │
              ├──→ 搜索结果展示
              └──→ LLM RAG 问答（流式输出）
```

### RRF (Reciprocal Rank Fusion) 公式

```
RRF(d) = Σ 1/(k + rank_i(d))
```

- `k = 60` 平滑参数
- 向量检索和 BM25 各自召回 top20
- RRF 融合后返回 top5

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

## 项目结构

```
llm-wiki/
├── scripts/
│   └── buildIndex.cjs       # 索引构建脚本
├── src/
│   ├── app/
│   │   ├── page.tsx          # 首页仪表盘
│   │   ├── search/page.tsx   # 智能搜索页
│   │   ├── chat/page.tsx     # AI 问答页
│   │   ├── docs/page.tsx     # 文档浏览页
│   │   └── api/
│   │       ├── search/       # 搜索 API
│   │       ├── chat/         # RAG 问答 API (SSE)
│   │       ├── stats/        # 统计 API
│   │       └── docs/list/    # 文档列表 API
│   ├── lib/
│   │   ├── types.ts          # 类型定义
│   │   ├── parser.ts         # 文档解析器
│   │   ├── vectorEngine.ts   # 向量检索引擎
│   │   ├── bm25Engine.ts     # BM25 检索引擎
│   │   ├── hybridSearch.ts   # 混合检索 + RRF
│   │   ├── ragEngine.ts      # RAG 问答引擎
│   │   └── indexManager.ts   # 索引管理器
│   └── data/                 # 预构建索引数据
│       ├── vectors/          # 向量索引分片
│       ├── bm25/             # BM25 倒排索引
│       └── chunks_meta/      # 文档块元数据
└── package.json
```

## LLM 配置

复制 `.env` 为 `.env.local`，配置 LLM API：

```env
OPENAI_API_KEY=sk-xxx
OPENAI_BASE_URL=https://api.xiaomimimo.com/v1
LLM_MODEL=mimo-v2.5
```

也可以在 AI 问答页面的设置面板中直接配置。

不配置 LLM 时，AI 问答会自动降级为基于检索结果的文档摘要展示。

## 技术栈

- **前端**: Next.js 16 + React 19 + Tailwind CSS 4
- **分词**: @node-rs/jieba（结巴分词 Rust 实现，支持业务自定义词典）
- **向量**: 1024维 DashScope `text-embedding-v4` + LanceDB IVF_PQ 索引 + 余弦相似度
- **BM25**: 纯 JS 倒排索引实现
- **LLM**: 阿里云 DashScope API（兼容 OpenAI 格式，流式 SSE 输出）
