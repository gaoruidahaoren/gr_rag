// ============================================================
// 索引管理器：检查索引状态，追踪增量构建信息
// ============================================================

import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'src', 'data');
const STATE_PATH = path.join(DATA_DIR, 'index_state.json');

export function isIndexReady(): boolean {
  // LanceDB 向量索引 + BM25 倒排索引
  const lancedbDir = path.join(DATA_DIR, 'lancedb');
  const bm25Meta = path.join(DATA_DIR, 'bm25', 'meta.json');
  return fs.existsSync(lancedbDir) && fs.existsSync(bm25Meta);
}

/** 检查结构化数据库是否就绪 */
export function isStructDbReady(): boolean {
  return fs.existsSync(path.join(DATA_DIR, 'struct_kb.db'));
}

/**
 * 获取索引状态信息（增量构建时生成）
 * 返回：上次构建时间、追踪的文件数量等
 */
export function getIndexState(): {
  lastBuildAt: string | null;
  trackedFiles: number;
  stateExists: boolean;
} | null {
  if (!fs.existsSync(STATE_PATH)) return null;
  try {
    const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));
    const stat = fs.statSync(STATE_PATH);
    return {
      lastBuildAt: stat.mtime.toISOString(),
      trackedFiles: Object.keys(state).length,
      stateExists: true,
    };
  } catch {
    return null;
  }
}

export async function initIndexes(): Promise<void> {
  if (isIndexReady()) {
    const state = getIndexState();
    if (state) {
      console.log(`[IndexManager] ✅ 检索索引已就绪（${state.trackedFiles} 个文件，上次构建: ${state.lastBuildAt}）`);
    } else {
      console.log('[IndexManager] ✅ 检索索引已就绪（无增量状态文件，可能为全量构建）');
    }
  } else {
    console.warn('[IndexManager] ⚠️ 索引未构建，请运行: node scripts/buildIndex.cjs');
  }

  if (isStructDbReady()) {
    console.log('[IndexManager] ✅ 结构化数据库已就绪');
  } else {
    console.warn('[IndexManager] ⚠️ 结构化数据库未构建，请运行: node scripts/buildStructDb.cjs');
  }
}
