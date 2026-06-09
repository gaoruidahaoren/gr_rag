// ============================================================
// 结构化检索引擎
// 基于 SQLite 数据库，支持精确查询概念/实体关联的所有文档
// 
// 核心能力：
//   1. 根据词条名精确查询关联的文档列表
//   2. 多词条联合查询（AND/OR 语义）
//   3. 按客户/项目/文档类型过滤
//   4. 与向量库协同工作：提供文档列表给向量库做二次检索
// ============================================================

import path from 'path';
import fs from 'fs';

const DB_PATH = path.join(process.cwd(), 'src', 'data', 'struct_kb.db');

/** 结构化数据库是否就绪 */
export function isStructDbReady(): boolean {
  return fs.existsSync(DB_PATH);
}

/** 获取数据库连接（只读模式，缓存复用） */
let _db: any = null;

function getDb(): any {
  if (_db) return _db;
  if (!isStructDbReady()) {
    throw new Error('结构化数据库未构建，请运行: node scripts/buildStructDb.cjs');
  }
  // better-sqlite3 是 C++ 原生模块，动态 require 以兼容 Next.js Turbopack
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const BetterSqlite3 = require('better-sqlite3');
  _db = new BetterSqlite3(DB_PATH, { readonly: true });
  _db.pragma('journal_mode = WAL');
  return _db;
}

// ============================================================
// 类型定义
// ============================================================

export interface StructEntry {
  id: number;
  name: string;
  type: 'concept' | 'entity';
  category: string;
  frequency: number;
  path: string;
}

export interface StructDocument {
  id: number;
  name: string;
  title: string;
  client: string;
  project: string;
  docType: string;
  date: string;
}

export interface StructSearchResult {
  /** 匹配到的词条 */
  entry: StructEntry;
  /** 关联的文档列表 */
  documents: StructDocument[];
  /** 匹配方式 */
  matchType: 'exact' | 'fuzzy';
}

// ============================================================
// 核心查询方法
// ============================================================

/**
 * 根据词条名精确查询关联文档
 * @param entryName 词条名称
 * @returns 词条信息 + 关联文档列表
 */
export function queryByEntry(entryName: string): StructSearchResult | null {
  const db = getDb();

  const entry = db.prepare('SELECT * FROM entries WHERE name = ?').get(entryName) as StructEntry | undefined;
  if (!entry) return null;

  const docs = db.prepare(`
    SELECT d.* FROM documents d
    INNER JOIN entry_docs ed ON d.id = ed.doc_id
    WHERE ed.entry_id = ?
    ORDER BY d.client, d.project, d.doc_type
  `).all(entry.id) as StructDocument[];

  return { entry, documents: docs, matchType: 'exact' };
}

/**
 * 批量精确查询：多个词条取交集（AND 语义）
 * 返回所有词条共同关联的文档
 */
export function queryByEntriesAnd(entryNames: string[]): StructSearchResult[] {
  const db = getDb();

  const results: StructSearchResult[] = [];
  const entries = db.prepare(
    `SELECT * FROM entries WHERE name IN (${entryNames.map(() => '?').join(',')})`
  ).all(...entryNames) as StructEntry[];

  if (entries.length === 0) return [];

  // 找到所有词条共同关联的文档 ID
  let commonDocIds: Set<number> | null = null;

  for (const entry of entries) {
    const docIds = new Set<number>(
      (db.prepare('SELECT doc_id FROM entry_docs WHERE entry_id = ?').all(entry.id) as { doc_id: number }[])
        .map(r => r.doc_id)
    );

    if (commonDocIds === null) {
      commonDocIds = docIds;
    } else {
      // 取交集
      const intersection = new Set<number>();
      for (const id of commonDocIds) {
        if (docIds.has(id)) intersection.add(id);
      }
      commonDocIds = intersection;
    }
  }

  if (!commonDocIds || commonDocIds.size === 0) {
    // 无交集，返回空结果但保留词条信息
    return entries.map(e => ({ entry: e, documents: [], matchType: 'exact' as const }));
  }

  // 加载文档详情
  const docIdsArray = [...commonDocIds];
  const docs = db.prepare(
    `SELECT * FROM documents WHERE id IN (${docIdsArray.map(() => '?').join(',')})`
  ).all(...docIdsArray) as StructDocument[];

  // 构建结果
  const docMap = new Map(docs.map(d => [d.id, d]));
  for (const entry of entries) {
    const entryDocIds = new Set(
      (db.prepare('SELECT doc_id FROM entry_docs WHERE entry_id = ?').all(entry.id) as { doc_id: number }[])
        .map(r => r.doc_id)
    );
    const intersectionDocs = [...commonDocIds]
      .filter(id => entryDocIds.has(id))
      .map(id => docMap.get(id)!)
      .filter(Boolean);

    results.push({ entry, documents: intersectionDocs, matchType: 'exact' });
  }

  return results;
}

/**
 * 批量精确查询：多个词条取并集（OR 语义）
 * 返回所有词条关联的文档（去重）
 */
export function queryByEntriesOr(entryNames: string[]): StructSearchResult[] {
  const db = getDb();

  const entries = db.prepare(
    `SELECT * FROM entries WHERE name IN (${entryNames.map(() => '?').join(',')})`
  ).all(...entryNames) as StructEntry[];

  if (entries.length === 0) return [];

  // 收集所有文档 ID（去重）
  const allDocIds = new Set<number>();
  const entryDocMap = new Map<number, Set<number>>();

  for (const entry of entries) {
    const docIds = (db.prepare('SELECT doc_id FROM entry_docs WHERE entry_id = ?').all(entry.id) as { doc_id: number }[])
      .map(r => r.doc_id);
    entryDocMap.set(entry.id, new Set(docIds));
    docIds.forEach(id => allDocIds.add(id));
  }

  // 加载所有文档
  const docIdsArray = [...allDocIds];
  const docs = db.prepare(
    `SELECT * FROM documents WHERE id IN (${docIdsArray.map(() => '?').join(',')})`
  ).all(...docIdsArray) as StructDocument[];

  const docMap = new Map(docs.map(d => [d.id, d]));

  const results: StructSearchResult[] = [];
  for (const entry of entries) {
    const entryDocs = [...(entryDocMap.get(entry.id) || [])]
      .map(id => docMap.get(id)!)
      .filter(Boolean)
      .sort((a, b) => (a.client + a.project).localeCompare(b.client + b.project));

    results.push({ entry, documents: entryDocs, matchType: 'exact' });
  }

  return results;
}

/**
 * 模糊搜索词条名（支持前缀/包含匹配）
 */
export function fuzzySearchEntries(keyword: string, limit = 20): StructEntry[] {
  const db = getDb();

  return db.prepare(`
    SELECT * FROM entries
    WHERE name LIKE ? OR name LIKE ?
    ORDER BY frequency DESC
    LIMIT ?
  `).all(`%${keyword}%`, `${keyword}%`, limit) as StructEntry[];
}

/**
 * 获取词条总数统计
 */
export function getStructStats(): {
  totalEntries: number;
  totalConcepts: number;
  totalEntities: number;
  totalDocs: number;
  totalRelations: number;
} {
  const db = getDb();

  return {
    totalEntries: (db.prepare('SELECT COUNT(*) as c FROM entries').get() as any).c,
    totalConcepts: (db.prepare("SELECT COUNT(*) as c FROM entries WHERE type='concept'").get() as any).c,
    totalEntities: (db.prepare("SELECT COUNT(*) as c FROM entries WHERE type='entity'").get() as any).c,
    totalDocs: (db.prepare('SELECT COUNT(*) as c FROM documents').get() as any).c,
    totalRelations: (db.prepare('SELECT COUNT(*) as c FROM entry_docs').get() as any).c,
  };
}

/**
 * 获取所有词条名称列表（用于 LLM 路由分析）
 */
export function getAllEntryNames(): string[] {
  const db = getDb();
  return (db.prepare('SELECT name FROM entries ORDER BY frequency DESC').all() as { name: string }[])
    .map(r => r.name);
}

/**
 * 按文档名查询它关联的所有词条
 */
export function queryEntriesByDoc(docName: string): StructEntry[] {
  const db = getDb();
  return db.prepare(`
    SELECT e.* FROM entries e
    INNER JOIN entry_docs ed ON e.id = ed.entry_id
    INNER JOIN documents d ON d.id = ed.doc_id
    WHERE d.name = ?
    ORDER BY e.frequency DESC
  `).all(docName) as StructEntry[];
}

/** 关闭数据库连接 */
export function closeStructDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
