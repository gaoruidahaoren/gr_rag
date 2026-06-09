// ============================================================
// 统一文档分块器（CommonJS）
// 供 buildIndex.cjs / buildIncremental.cjs 共用
//
// 分块策略：
//   1. 按 ## 标题粗切为 sections
//   2. 在每个 section 内按段落/句子边界细切
//   3. 将句子合并为 chunk（MIN~MAX 大小，带重叠）
//   4. 跨 section 全局统一 chunkIndex（避免不同 section 重复）
//   5. 合并过短的相邻 chunk
// ============================================================

/**
 * 提取文档中所有 [[wikiLinks]]
 * @param {string} content
 * @returns {string[]}
 */
function extractWikiLinks(content) {
  const regex = /\[\[([^\]]+)\]\]/g;
  const links = new Set();
  let match;
  while ((match = regex.exec(content)) !== null) links.add(match[1].trim());
  return [...links];
}

/**
 * 解析 Raw 文件名元数据
 * 格式：{客户}_{项目系统}_{文档类型}_{日期}.md
 * @param {string} filename
 * @returns {{ client: string, project: string, docType: string, date: string }}
 */
function parseFilename(filename) {
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

/**
 * 从文档内容中提取标题
 * @param {string} content - 文档原始内容
 * @param {string} filename - 文件名（作为降级标题）
 * @returns {string}
 */
function extractTitle(content, filename) {
  const firstLine = content.split('\n')[0]?.trim() || '';
  if (firstLine.startsWith('# ')) {
    return firstLine.replace(/^#\s+/, '').trim();
  }
  // 排除表格头、分隔线、空行等非标题内容
  if (firstLine.startsWith('|') || firstLine.startsWith('---') || firstLine.startsWith('###') || !firstLine) {
    const h1Match = content.match(/^# (.+)$/m);
    return h1Match ? h1Match[1].trim() : filename;
  }
  return firstLine.replace(/^#\s+/, '').trim() || filename;
}

/**
 * 语义分块：按句子边界切分文档
 *
 * @param {string} content - 文档内容
 * @param {string} docId - 文档 ID（如 raw_xxx）
 * @param {string} docTitle - 文档标题
 * @param {string} docPath - 文档路径（如 Raw/xxx.md）
 * @param {{ client: string, project: string, docType: string, date: string }} metadata
 * @param {object} [options]
 * @param {number} [options.minChunkSize=200] - 最小 chunk 大小
 * @param {number} [options.maxChunkSize=1000] - 最大 chunk 大小
 * @returns {Array<{ id: string, docId: string, docTitle: string, docPath: string, chunkIndex: number, content: string, metadata: object, wikiLinks: string[], parentDocId: string }>}
 */
function chunkDocument(content, docId, docTitle, docPath, metadata, options) {
  const MIN_CHUNK_SIZE = options?.minChunkSize ?? 200;
  const MAX_CHUNK_SIZE = options?.maxChunkSize ?? 1000;
  const parentDocId = `parent_${docId}`;

  // Step 1: 按 ## 标题粗切
  const sections = content.split(/(?=^## )/m);
  const allSentences = [];

  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;

    // 按段落边界切分（空行分隔）
    const paragraphs = trimmed.split(/\n\s*\n/).filter(p => p.trim().length > 0);

    // 进一步按句子边界切分
    const sectionSentences = [];
    for (const para of paragraphs) {
      const parts = para.split(/(?<=[。！？])\s*|(?<=\.)\s+(?=[A-Z])|(?<=[!?])\s+(?=[A-Z])/);
      for (const part of parts) {
        const s = part.trim();
        if (s.length > 0) sectionSentences.push(s);
      }
    }

    if (sectionSentences.length > 0) {
      allSentences.push(...sectionSentences);
    }
  }

  if (allSentences.length === 0) {
    // 降级：按固定大小切分
    const chunks = [];
    for (let i = 0; i < content.length; i += MAX_CHUNK_SIZE) {
      const sub = content.slice(i, i + MAX_CHUNK_SIZE);
      if (!sub.trim()) continue;
      chunks.push({
        id: `${docId}_${chunks.length}`,
        docId,
        docTitle,
        docPath,
        chunkIndex: chunks.length,
        content: sub,
        metadata,
        wikiLinks: extractWikiLinks(sub),
        parentDocId,
      });
    }
    return chunks;
  }

  // Step 2: 将句子合并为 chunk（保持语义完整性，全局统一 chunkIndex）
  const chunks = [];
  let currentChunk = '';
  let chunkIdx = 0;
  const OVERLAP_CHARS = Math.round((MIN_CHUNK_SIZE + MAX_CHUNK_SIZE) / 2 * 0.1); // 平均 chunk 大小的 10%

  for (let i = 0; i < allSentences.length; i++) {
    const sentence = allSentences[i];

    if (currentChunk.length + sentence.length > MAX_CHUNK_SIZE && currentChunk.length >= MIN_CHUNK_SIZE) {
      const chunkContent = currentChunk.trim();
      chunks.push({
        id: `${docId}_${chunkIdx}`,
        docId,
        docTitle,
        docPath,
        chunkIndex: chunkIdx,
        content: chunkContent,
        metadata,
        wikiLinks: extractWikiLinks(chunkContent),
        parentDocId,
      });
      chunkIdx++;

      // 重叠：从上一个 chunk 末尾往前取完整句子，使得重叠字符数 >= OVERLAP_CHARS
      let overlapChars = 0;
      let overlapIdx = i;
      while (overlapIdx > 0 && overlapChars < OVERLAP_CHARS) {
        overlapIdx--;
        overlapChars += allSentences[overlapIdx].length;
      }
      const overlapSentences = allSentences.slice(overlapIdx, i);
      currentChunk = overlapSentences.join('\n') + '\n' + sentence + '\n';
    } else {
      currentChunk += sentence + '\n';
    }
  }

  // 最后一个 chunk
  if (currentChunk.trim().length > 0) {
    const chunkContent = currentChunk.trim();
    chunks.push({
      id: `${docId}_${chunkIdx}`,
      docId,
      docTitle,
      docPath,
      chunkIndex: chunkIdx,
      content: chunkContent,
      metadata,
      wikiLinks: extractWikiLinks(chunkContent),
      parentDocId,
    });
    chunkIdx++;
  }

  // Step 3: 合并过短的相邻 chunk
  const mergedChunks = [];
  for (const chunk of chunks) {
    const last = mergedChunks[mergedChunks.length - 1];
    if (last && (last.content.length < MIN_CHUNK_SIZE || chunk.content.length < MIN_CHUNK_SIZE)) {
      last.content = last.content + '\n\n' + chunk.content;
      last.wikiLinks = [...new Set([...last.wikiLinks, ...chunk.wikiLinks])];
    } else {
      mergedChunks.push({ ...chunk });
    }
  }

  return mergedChunks;
}

/**
 * 构建 Wiki 词条的 chunk 对象
 * @param {string} name - 词条名
 * @param {'concept'|'entity'} type - 词条类型
 * @param {string} file - 文件路径（如 Wiki/entity/xxx.md）
 * @param {string} content - 文件原始内容
 * @returns {{ id: string, docId: string, docTitle: string, docPath: string, chunkIndex: number, content: string, metadata: object, wikiLinks: string[], parentDocId: undefined }}
 */
function buildWikiChunk(name, type, file, content) {
  const sub = file.includes('/entity/') ? 'entity' : 'concept';
  const freqMatch = content.match(/出现频次:\s*(\d+)/);
  const freq = freqMatch ? parseInt(freqMatch[1]) : 0;
  const text = `# ${name}\n${sub === 'concept' ? '概念' : '实体'} | 出现频次: ${freq}`;

  return {
    id: `wiki_${name}`,
    docId: `wiki_${name}`,
    docTitle: name,
    docPath: file,
    chunkIndex: 0,
    content: text,
    metadata: { client: '', project: '', docType: sub === 'concept' ? '概念' : '实体', date: '' },
    wikiLinks: [name],
    parentDocId: undefined,
  };
}

module.exports = {
  extractWikiLinks,
  parseFilename,
  extractTitle,
  chunkDocument,
  buildWikiChunk,
};
