// ============================================================
// 索引构建脚本（使用 jieba 分词 + 阿里 DashScope Embedding）
// 用法: npx tsx scripts/buildIndex.ts
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import { DocChunk } from '../src/lib/types';
import { tokenize } from '../src/lib/tokenizer';

// 加载 .env 环境变量
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

const RAW_DIR = path.join(process.cwd(), '..', 'Raw');
const WIKI_DIR = path.join(process.cwd(), '..', 'Wiki');
const DATA_DIR = path.join(process.cwd(), 'src', 'data');

// 阿里 DashScope Embedding 配置
const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY || '';
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-v4';
const EMBEDDING_DIM = parseInt(process.env.EMBEDDING_DIM || '1024', 10);
const DASHSCOPE_URL = 'https://dashscope.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding';

const DIM = EMBEDDING_DIM;

// ============================================================
// 阿里 DashScope Embedding 批量调用
// ============================================================

async function getEmbeddingsBatch(texts: string[]): Promise<number[][]> {
  const BATCH_SIZE = 10; // DashScope text-embedding-v4 限制单次最多 10 条
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const response = await fetch(DASHSCOPE_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DASHSCOPE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: { texts: batch },
        parameters: { text_type: 'document' },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`DashScope API error (${response.status}): ${errText}`);
    }

    const data = await response.json();
    for (const emb of data.output.embeddings) {
      results.push(emb.embedding);
    }

    console.log(`  Embedding: ${Math.min(i + BATCH_SIZE, texts.length)}/${texts.length}`);
  }

  return results;
}

// ============================================================
// 解析工具
// ============================================================

function parseRawFilename(filename: string) {
  const name = filename.replace(/\.md$/, '');
  const parts = name.split('_');
  if (parts.length >= 4) {
    return {
      client: parts.slice(0, parts.length - 3).join('_'),
      project: parts[parts.length - 3],
      docType: parts[parts.length - 2],
      date: parts[parts.length - 1],
    };
  }
  return { client: '', project: '', docType: '', date: '' };
}

function extractWikiLinks(content: string): string[] {
  const regex = /\[\[([^\]]+)\]\]/g;
  const links: string[] = [];
  let match;
  while ((match = regex.exec(content)) !== null) links.push(match[1].trim());
  return [...new Set(links)];
}

function chunkDocument(
  content: string, docId: string, docTitle: string, docPath: string,
  metadata: DocChunk['metadata']
): DocChunk[] {
  const MAX_CHUNK_SIZE = 800;
  const OVERLAP = 100;
  const sections = content.split(/(?=^## )/m);
  const chunks: DocChunk[] = [];
  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;
    if (trimmed.length > MAX_CHUNK_SIZE) {
      let start = 0;
      while (start < trimmed.length) {
        const end = Math.min(start + MAX_CHUNK_SIZE, trimmed.length);
        const sub = trimmed.slice(start, end);
        chunks.push({
          id: `${docId}_${chunks.length}`, docId, docTitle, docPath,
          chunkIndex: chunks.length, content: sub,
          metadata, wikiLinks: extractWikiLinks(sub),
        });
        start = end - OVERLAP;
      }
    } else {
      chunks.push({
        id: `${docId}_${chunks.length}`, docId, docTitle, docPath,
        chunkIndex: chunks.length, content: trimmed,
        metadata, wikiLinks: extractWikiLinks(trimmed),
      });
    }
  }
  return chunks;
}

// ============================================================
// 主构建流程
// ============================================================

async function main() {
  console.log('========================================');
  console.log('  星辰Wiki 知识库索引构建（纯 JS）');
  console.log('========================================\n');

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  // --- 阶段1：解析所有文档并生成 chunks ---
  console.log('[阶段 1] 解析文档并分块...');

  const allChunks: DocChunk[] = [];
  const rawFiles = fs.readdirSync(RAW_DIR).filter(f => f.endsWith('.md'));

  for (let fi = 0; fi < rawFiles.length; fi++) {
    const file = rawFiles[fi];
    const content = fs.readFileSync(path.join(RAW_DIR, file), 'utf-8');
    const meta = parseRawFilename(file);
    const firstLine = content.split('\n')[0]?.trim() || '';
    let title: string;
    if (firstLine.startsWith('# ')) {
      title = firstLine.replace(/^#\s+/, '').trim();
    } else if (firstLine.startsWith('|') || firstLine.startsWith('---') || firstLine.startsWith('###') || !firstLine) {
      const h1Match = content.match(/^# (.+)$/m);
      title = h1Match ? h1Match[1].trim() : file;
    } else {
      title = firstLine.replace(/^#\s+/, '').trim() || file;
    }
    const docId = `raw_${file.replace(/\.md$/, '')}`;

    const chunks = chunkDocument(content, docId, title, `Raw/${file}`, {
      client: meta.client, project: meta.project, docType: meta.docType, date: meta.date,
    });
    allChunks.push(...chunks);

    if ((fi + 1) % 20 === 0) {
      console.log(`  已解析 ${fi + 1}/${rawFiles.length} 个文档, ${allChunks.length} 个块`);
    }
  }

  // 添加 Wiki 词条
  console.log('  添加 Wiki 词条...');
  for (const sub of ['concept', 'entity']) {
    const dir = path.join(WIKI_DIR, sub);
    if (!fs.existsSync(dir)) continue;
    for (const wf of fs.readdirSync(dir).filter(f => f.endsWith('.md'))) {
      const wContent = fs.readFileSync(path.join(dir, wf), 'utf-8');
      const name = wf.replace(/\.md$/, '');
      const freqMatch = wContent.match(/出现频次:\s*(\d+)/);
      const freq = freqMatch ? parseInt(freqMatch[1]) : 0;
      const text = `# ${name}\n${sub === 'concept' ? '概念' : '实体'} | 出现频次: ${freq}`;
      allChunks.push({
        id: `wiki_${name}`, docId: `wiki_${name}`, docTitle: name,
        docPath: `Wiki/${sub}/${wf}`, chunkIndex: 0, content: text,
        metadata: { client: '', project: '', docType: sub === 'concept' ? '概念' : '实体', date: '' },
        wikiLinks: [name],
      });
    }
  }

  console.log(`  ✅ 共 ${allChunks.length} 个文档块\n`);

  // --- 阶段2：构建向量索引（使用阿里 DashScope Embedding）---
  console.log('[阶段 2] 构建向量索引（阿里 DashScope Embedding）...');

  if (!DASHSCOPE_API_KEY || DASHSCOPE_API_KEY.startsWith('sk-你的')) {
    console.error('  ❌ DASHSCOPE_API_KEY 未配置，请在 .env 中设置有效的 API Key');
    process.exit(1);
  }

  // 准备所有文本（取前 2000 字符）
  const vecTexts = allChunks.map(c => c.content.slice(0, 2000));
  console.log(`  共 ${vecTexts.length} 条文本待向量化，维度: ${DIM}`);

  // 批量调用阿里 embedding API
  const allVectors = await getEmbeddingsBatch(vecTexts);
  console.log(`  ✅ Embedding 完成: ${allVectors.length} 个向量`);

  const vecMetadata = allChunks.map(c => ({
    id: c.id, docId: c.docId, docTitle: c.docTitle, docPath: c.docPath,
    metadata: c.metadata, content: c.content.slice(0, 3000), wikiLinks: c.wikiLinks,
  }));

  // 保存向量到 JSON（分片）
  const vecDir = path.join(DATA_DIR, 'vectors');
  if (!fs.existsSync(vecDir)) fs.mkdirSync(vecDir, { recursive: true });

  const vecShardSize = 1000;
  for (let i = 0; i < allVectors.length; i += vecShardSize) {
    const shardVectors = allVectors.slice(i, i + vecShardSize);
    const shardMeta = vecMetadata.slice(i, i + vecShardSize);
    fs.writeFileSync(
      path.join(vecDir, `shard_${Math.floor(i / vecShardSize)}.json`),
      JSON.stringify({ vectors: shardVectors, meta: shardMeta })
    );
  }

  fs.writeFileSync(path.join(vecDir, 'config.json'), JSON.stringify({
    totalChunks: allVectors.length,
    dim: DIM,
    shardSize: vecShardSize,
    totalShards: Math.ceil(allVectors.length / vecShardSize),
  }));

  console.log(`  ✅ 向量索引完成: ${allVectors.length} 个向量, ${Math.ceil(allVectors.length / vecShardSize)} 个分片\n`);

  // --- 阶段3：构建 BM25 倒排索引 ---
  console.log('[阶段 3] 构建 BM25 倒排索引...');

  const invIndex = new Map<string, Array<{ chunkId: string; tf: number }>>();
  const docLengths: Record<string, number> = {};

  for (let i = 0; i < allChunks.length; i++) {
    const c = allChunks[i];
    const tokens = tokenize(c.content);
    docLengths[c.id] = tokens.length;

    const tfMap = new Map<string, number>();
    for (const t of tokens) tfMap.set(t, (tfMap.get(t) || 0) + 1);
    for (const [term, tf] of tfMap) {
      if (!invIndex.has(term)) invIndex.set(term, []);
      invIndex.get(term)!.push({ chunkId: c.id, tf });
    }

    if ((i + 1) % 500 === 0) {
      console.log(`  已索引 ${i + 1}/${allChunks.length}, ${invIndex.size} 个词项`);
    }
  }

  // 保存 BM25 索引
  const bm25Dir = path.join(DATA_DIR, 'bm25');
  if (!fs.existsSync(bm25Dir)) fs.mkdirSync(bm25Dir, { recursive: true });

  let totalLen = 0;
  for (const len of Object.values(docLengths)) totalLen += len;
  const avgDocLen = allChunks.length > 0 ? totalLen / allChunks.length : 0;

  // 倒排索引分片保存
  const entries = Array.from(invIndex.entries());
  const bm25ShardSize = 5000;
  for (let i = 0; i < entries.length; i += bm25ShardSize) {
    const shard: Record<string, any> = {};
    for (let j = i; j < Math.min(i + bm25ShardSize, entries.length); j++) {
      shard[entries[j][0]] = entries[j][1];
    }
    fs.writeFileSync(path.join(bm25Dir, `shard_${Math.floor(i / bm25ShardSize)}.json`), JSON.stringify(shard));
  }

  fs.writeFileSync(path.join(bm25Dir, 'meta.json'), JSON.stringify({
    docCount: allChunks.length,
    avgDocLen,
    totalTerms: invIndex.size,
    totalShards: Math.ceil(entries.length / bm25ShardSize),
  }));
  fs.writeFileSync(path.join(bm25Dir, 'doc_lengths.json'), JSON.stringify(docLengths));

  // 保存 chunks 元数据（供检索时查询内容）
  const chunksMetaDir = path.join(DATA_DIR, 'chunks_meta');
  if (!fs.existsSync(chunksMetaDir)) fs.mkdirSync(chunksMetaDir, { recursive: true });

  const metaShardSize = 2000;
  for (let i = 0; i < allChunks.length; i += metaShardSize) {
    const shard: Record<string, any> = {};
    for (let j = i; j < Math.min(i + metaShardSize, allChunks.length); j++) {
      const c = allChunks[j];
      shard[c.id] = {
        docId: c.docId, docTitle: c.docTitle, docPath: c.docPath,
        metadata: c.metadata, content: c.content.slice(0, 3000), wikiLinks: c.wikiLinks,
      };
    }
    fs.writeFileSync(path.join(chunksMetaDir, `shard_${Math.floor(i / metaShardSize)}.json`), JSON.stringify(shard));
  }

  fs.writeFileSync(path.join(chunksMetaDir, 'config.json'), JSON.stringify({
    totalChunks: allChunks.length,
    shardSize: metaShardSize,
    totalShards: Math.ceil(allChunks.length / metaShardSize),
  }));

  console.log(`  ✅ BM25 索引完成: ${allChunks.length} 文档, ${invIndex.size} 词项, 平均长度 ${avgDocLen.toFixed(1)}\n`);

  console.log('========================================');
  console.log('  ✅ 全部索引构建完成!');
  console.log('========================================');
  console.log(`  总文档块: ${allChunks.length}`);
  console.log(`  向量维度: ${DIM}`);
  console.log(`  BM25 词项: ${invIndex.size}`);
  console.log(`  数据目录: ${DATA_DIR}`);
  console.log('========================================');
}

main().catch(err => {
  console.error('索引构建失败:', err);
  process.exit(1);
});
