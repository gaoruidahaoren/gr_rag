// ============================================================
// 结构化数据库构建脚本
// 从 Wiki/concept 和 Wiki/entity 中解析词条，扫描 Raw 文档中的 [[wikiLinks]]
// 构建 entity-doc 关联关系并存入 SQLite 数据库
//
// 用法: node scripts/buildStructDb.cjs
// ============================================================

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..', '..');
const RAW_DIR = path.join(ROOT, 'Raw');
const WIKI_DIR = path.join(ROOT, 'Wiki');
const DB_PATH = path.join(__dirname, '..', 'src', 'data', 'struct_kb.db');

// ============================================================
// 1. 解析 Wiki 词条（概念 + 实体）
// ============================================================

function loadWikiEntries() {
  const entries = [];

  for (const sub of ['concept', 'entity']) {
    const dir = path.join(WIKI_DIR, sub);
    if (!fs.existsSync(dir)) continue;

    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.md')) continue;

      const name = file.replace(/\.md$/, '');
      const content = fs.readFileSync(path.join(dir, file), 'utf-8');

      // 提取分类标签
      let category = '';
      const catMatch = content.match(/^>\s*(.+?)\s*\|/m);
      if (catMatch) category = catMatch[1].trim();

      // 提取出现频次
      let frequency = 0;
      const freqMatch = content.match(/出现频次:\s*(\d+)/);
      if (freqMatch) frequency = parseInt(freqMatch[1]);

      entries.push({
        name,
        type: sub, // 'concept' | 'entity'
        category: category || sub,
        frequency,
        path: `Wiki/${sub}/${file}`,
      });
    }
  }

  return entries;
}

// ============================================================
// 2. 扫描 Raw 文档，提取 [[wikiLinks]] 并建立关联
// ============================================================

function scanRawDocuments() {
  /** @type {Map<string, {name: string, type: string, client: string, project: string, docType: string, date: string, wikiLinks: string[]}>} */
  const docMap = new Map();

  if (!fs.existsSync(RAW_DIR)) return docMap;

  const files = fs.readdirSync(RAW_DIR).filter(f => f.endsWith('.md'));

  for (const file of files) {
    const content = fs.readFileSync(path.join(RAW_DIR, file), 'utf-8');

    // 解析文件名元数据
    const name = file.replace(/\.md$/, '');
    const parts = name.split('_');
    let client = '', project = '', docType = '', date = '';
    if (parts.length >= 4) {
      client = parts.slice(0, parts.length - 3).join('_');
      project = parts[parts.length - 3];
      docType = parts[parts.length - 2];
      date = parts[parts.length - 1];
    }

    // 提取文档标题
    const titleLine = content.split('\n')[0];
    const title = titleLine.replace(/^#\s+/, '').replace(/\[\[([^\]]+)\]\]/g, '$1').trim();

    // 提取所有 wiki 链接
    const wikiLinks = [];
    const regex = /\[\[([^\]]+)\]\]/g;
    let match;
    const seen = new Set();
    while ((match = regex.exec(content)) !== null) {
      const link = match[1].trim();
      if (!seen.has(link)) {
        seen.add(link);
        wikiLinks.push(link);
      }
    }

    docMap.set(name, {
      name,
      title,
      client,
      project,
      docType,
      date,
      wikiLinks,
    });
  }

  return docMap;
}

// ============================================================
// 3. 建立关联关系矩阵
// ============================================================

/**
 * 构建关联关系：
 * - entry_docs: 每个词条关联哪些文档（通过 wikiLinks 反向查找）
 * - doc_entries: 每个文档引用了哪些词条
 */
function buildRelations(entries, docMap) {
  // 词条名集合（快速查找）
  const entryNameSet = new Set(entries.map(e => e.name));

  // entry -> docs 映射
  /** @type {Map<string, Set<string>>} */
  const entryToDocs = new Map();
  for (const entry of entries) {
    entryToDocs.set(entry.name, new Set());
  }

  // 遍历每个文档，找出它引用了哪些词条
  for (const [docName, doc] of docMap) {
    for (const link of doc.wikiLinks) {
      if (entryNameSet.has(link)) {
        entryToDocs.get(link).add(docName);
      }
    }
  }

  return { entryToDocs, entryNameSet };
}

// ============================================================
// 4. 写入 SQLite
// ============================================================

function buildDatabase(entries, docMap, entryToDocs) {
  // 删除旧数据库
  if (fs.existsSync(DB_PATH)) {
    fs.unlinkSync(DB_PATH);
    console.log('  已删除旧数据库');
  }

  const db = new Database(DB_PATH);

  // 开启 WAL 模式 + 性能优化
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -64000');

  // 创建表结构
  db.exec(`
    -- 词条表（概念 + 实体）
    CREATE TABLE IF NOT EXISTS entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL CHECK(type IN ('concept', 'entity')),
      category TEXT NOT NULL DEFAULT '',
      frequency INTEGER NOT NULL DEFAULT 0,
      path TEXT NOT NULL DEFAULT ''
    );

    -- 文档表
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL DEFAULT '',
      client TEXT NOT NULL DEFAULT '',
      project TEXT NOT NULL DEFAULT '',
      doc_type TEXT NOT NULL DEFAULT '',
      date TEXT NOT NULL DEFAULT ''
    );

    -- 关联关系表：词条 N-N 文档
    CREATE TABLE IF NOT EXISTS entry_docs (
      entry_id INTEGER NOT NULL,
      doc_id INTEGER NOT NULL,
      PRIMARY KEY (entry_id, doc_id),
      FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE,
      FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE
    );

    -- 索引加速查询
    CREATE INDEX IF NOT EXISTS idx_entries_name ON entries(name);
    CREATE INDEX IF NOT EXISTS idx_entries_type ON entries(type);
    CREATE INDEX IF NOT EXISTS idx_documents_client ON documents(client);
    CREATE INDEX IF NOT EXISTS idx_documents_project ON documents(project);
    CREATE INDEX IF NOT EXISTS idx_entry_docs_entry ON entry_docs(entry_id);
    CREATE INDEX IF NOT EXISTS idx_entry_docs_doc ON entry_docs(doc_id);
  `);

  // 插入词条
  const insertEntry = db.prepare(`
    INSERT OR REPLACE INTO entries (name, type, category, frequency, path)
    VALUES (@name, @type, @category, @frequency, @path)
  `);

  const insertDoc = db.prepare(`
    INSERT OR REPLACE INTO documents (name, title, client, project, doc_type, date)
    VALUES (@name, @title, @client, @project, @docType, @date)
  `);

  const insertRelation = db.prepare(`
    INSERT OR IGNORE INTO entry_docs (entry_id, doc_id)
    VALUES (@entry_id, @doc_id)
  `);

  // 事务批量写入
  const insertAll = db.transaction(() => {
    // 插入所有词条
    for (const entry of entries) {
      insertEntry.run(entry);
    }

    // 插入所有文档
    for (const [docName, doc] of docMap) {
      insertDoc.run({
        name: docName,
        title: doc.title,
        client: doc.client,
        project: doc.project,
        docType: doc.docType,
        date: doc.date,
      });
    }

    // 插入关联关系
    for (const [entryName, docNames] of entryToDocs) {
      const entryRow = db.prepare('SELECT id FROM entries WHERE name = ?').get(entryName);
      if (!entryRow) continue;

      for (const docName of docNames) {
        const docRow = db.prepare('SELECT id FROM documents WHERE name = ?').get(docName);
        if (!docRow) continue;
        insertRelation.run({ entry_id: entryRow.id, doc_id: docRow.id });
      }
    }
  });

  insertAll();

  // 统计信息
  const stats = {
    totalEntries: db.prepare('SELECT COUNT(*) as c FROM entries').get().c,
    totalConcepts: db.prepare("SELECT COUNT(*) as c FROM entries WHERE type='concept'").get().c,
    totalEntities: db.prepare("SELECT COUNT(*) as c FROM entries WHERE type='entity'").get().c,
    totalDocs: db.prepare('SELECT COUNT(*) as c FROM documents').get().c,
    totalRelations: db.prepare('SELECT COUNT(*) as c FROM entry_docs').get().c,
  };

  db.close();
  return stats;
}

// ============================================================
// 主流程
// ============================================================

function main() {
  console.log('========================================');
  console.log('  星辰Wiki 结构化数据库构建');
  console.log('========================================\n');

  // Step 1: 加载词条
  console.log('[1/4] 加载 Wiki 词条...');
  const entries = loadWikiEntries();
  console.log(`  ✅ 概念词条: ${entries.filter(e => e.type === 'concept').length} 个`);
  console.log(`  ✅ 实体词条: ${entries.filter(e => e.type === 'entity').length} 个`);
  console.log(`  ✅ 总计: ${entries.length} 个\n`);

  // Step 2: 扫描文档
  console.log('[2/4] 扫描 Raw 文档...');
  const docMap = scanRawDocuments();
  console.log(`  ✅ 文档: ${docMap.size} 个\n`);

  // Step 3: 建立关联
  console.log('[3/4] 建立词条-文档关联关系...');
  const { entryToDocs, entryNameSet } = buildRelations(entries, docMap);

  // 统计关联密度
  let linkedEntries = 0;
  let totalLinks = 0;
  for (const [name, docs] of entryToDocs) {
    if (docs.size > 0) {
      linkedEntries++;
      totalLinks += docs.size;
    }
  }
  console.log(`  ✅ 有文档关联的词条: ${linkedEntries}/${entries.length}`);
  console.log(`  ✅ 总关联边数: ${totalLinks}`);
  console.log(`  ✅ 平均每词条关联: ${(totalLinks / entries.length).toFixed(1)} 个文档\n`);

  // Step 4: 写入数据库
  console.log('[4/4] 写入 SQLite 数据库...');
  const stats = buildDatabase(entries, docMap, entryToDocs);
  console.log(`  ✅ 数据库路径: ${DB_PATH}`);
  console.log(`  ✅ 词条: ${stats.totalEntries} (概念${stats.totalConcepts}/实体${stats.totalEntities})`);
  console.log(`  ✅ 文档: ${stats.totalDocs}`);
  console.log(`  ✅ 关联边: ${stats.totalRelations}\n`);

  console.log('========================================');
  console.log('  ✅ 结构化数据库构建完成!');
  console.log('========================================');
}

// 导出 main 供 buildIndex 调用，同时支持独立运行
module.exports = { main };

// 如果是直接运行（非 require），执行 main
if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error('构建失败:', err);
    process.exit(1);
  }
}
