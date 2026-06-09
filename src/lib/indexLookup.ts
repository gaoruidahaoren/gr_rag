// ============================================================
// Wiki/index.md 智能查询
// 针对"有哪些客户/项目/技术栈"等元信息查询，
// 智能提取 index.md 中对应章节的内容
// ============================================================

import fs from 'fs';
import path from 'path';

const WIKI_ROOT = path.join(process.cwd(), '..', 'Wiki');
const INDEX_PATH = path.join(WIKI_ROOT, 'index.md');

/** index.md 是否存在 */
export function isIndexAvailable(): boolean {
  return fs.existsSync(INDEX_PATH);
}

// ============================================================
// 查询意图 → index.md 章节映射
// ============================================================

interface IndexSection {
  /** 章节标题关键词 */
  titlePattern: RegExp;
  /** 结束标记（遇到下一个同级别标题时停止） */
  stopPattern: RegExp;
  /** 匹配该章节的查询意图关键词 */
  intentKeywords: string[];
}

const INDEX_SECTIONS: IndexSection[] = [
  {
    titlePattern: /^##\s+🏢\s*客户列表/,
    stopPattern: /^##\s+/,
    intentKeywords: ['客户', '客户列表', '客户数量', '有哪些客户', '所有客户', '全部客户', '哪些客户', '客户都有哪些', '公司'],
  },
  {
    titlePattern: /^##\s+📋\s*文档类型/,
    stopPattern: /^##\s+/,
    intentKeywords: ['文档类型', '有哪些文档类型', '文档分类', '所有文档类型'],
  },
  {
    titlePattern: /^##\s+💻\s*项目类型/,
    stopPattern: /^##\s+/,
    intentKeywords: ['项目类型', '有哪些项目', '项目系统', '所有项目', '哪些项目', '项目列表'],
  },
  {
    titlePattern: /^##\s+💡\s*概念索引/,
    stopPattern: /^##\s+/,
    intentKeywords: ['概念', '有哪些概念', '概念列表', '所有概念', '全部概念', '概念索引'],
  },
  {
    titlePattern: /^##\s+🏷️\s*实体索引/,
    stopPattern: /^##\s+/,
    intentKeywords: ['实体', '有哪些实体', '实体列表', '所有实体', '全部实体', '实体索引'],
  },
  // 实体索引下的子章节
  {
    titlePattern: /^###\s+客户企业/,
    stopPattern: /^###\s+/,
    intentKeywords: ['客户企业', '有哪些客户企业', '客户公司'],
  },
  {
    titlePattern: /^###\s+技术组件/,
    stopPattern: /^###\s+/,
    intentKeywords: ['技术组件', '有哪些技术', '技术栈', '用了哪些技术', '技术列表', '组件'],
  },
  {
    titlePattern: /^###\s+项目系统/,
    stopPattern: /^###\s+/,
    intentKeywords: ['项目系统', '有哪些系统', '系统列表'],
  },
  {
    titlePattern: /^###\s+人员/,
    stopPattern: /^###\s+/,
    intentKeywords: ['人员', '有哪些人', '成员', '员工', '团队人员'],
  },
  {
    titlePattern: /^###\s+部门/,
    stopPattern: /^###\s+/,
    intentKeywords: ['部门', '有哪些部门', '组织架构', '部门列表'],
  },
  {
    titlePattern: /^##\s+📂\s*全部原始文档/,
    stopPattern: /^$/,
    intentKeywords: ['所有文档', '全部文档', '文档列表', '原始文档', '全部原始文档'],
  },
  {
    titlePattern: /^##\s+📊\s*知识库概览/,
    stopPattern: /^##\s+/,
    intentKeywords: ['概览', '统计', '数量', '有多少', '知识库概况', 'overview'],
  },
];

// ============================================================
// 核心方法
// ============================================================

export interface IndexLookupResult {
  /** 命中的章节标题 */
  sectionTitle: string;
  /** 章节内容（原始 markdown） */
  content: string;
  /** 匹配的意图关键词 */
  matchedIntent: string;
}

/**
 * 根据查询意图，提取 index.md 中对应的章节内容
 *
 * 匹配策略：
 * 1. 计算查询与每个章节 intentKeywords 的重叠度
 * 2. 取重叠度最高的章节
 * 3. 解析 index.md，提取该章节的完整内容
 */
export function lookupIndexByQuery(query: string): IndexLookupResult | null {
  if (!isIndexAvailable()) {
    console.warn('[IndexLookup] index.md 不存在');
    return null;
  }

  const queryLower = query.toLowerCase();

  // 计算每个章节的匹配分数
  let bestSection: IndexSection | null = null;
  let bestScore = 0;
  let bestMatchedKeyword = '';

  for (const section of INDEX_SECTIONS) {
    let score = 0;
    let matchedKeyword = '';
    for (const kw of section.intentKeywords) {
      if (queryLower.includes(kw.toLowerCase())) {
        // 更长的关键词匹配给更高分
        score += kw.length;
        if (kw.length > matchedKeyword.length) {
          matchedKeyword = kw;
        }
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestSection = section;
      bestMatchedKeyword = matchedKeyword;
    }
  }

  if (!bestSection || bestScore === 0) return null;

  // 读取 index.md 并提取对应章节
  const indexContent = fs.readFileSync(INDEX_PATH, 'utf-8');
  const lines = indexContent.split('\n');

  let sectionContent = '';
  let inSection = false;

  for (const line of lines) {
    if (!inSection) {
      // 寻找章节起始
      if (bestSection.titlePattern.test(line)) {
        inSection = true;
        sectionContent += line + '\n';
      }
    } else {
      // 遇到下一个同级标题时停止
      if (bestSection.stopPattern.test(line) && !bestSection.titlePattern.test(line)) {
        break;
      }
      sectionContent += line + '\n';
    }
  }

  if (!sectionContent.trim()) return null;

  console.log(`[IndexLookup] 命中章节: ${bestMatchedKeyword} → 提取 ${sectionContent.split('\n').length} 行`);

  return {
    sectionTitle: bestMatchedKeyword,
    content: sectionContent.trim(),
    matchedIntent: bestMatchedKeyword,
  };
}

/**
 * 判断查询是否适合走 index.md 查询
 * 用于 smartRouter 路由决策
 */
export function isIndexQuery(query: string): boolean {
  const queryLower = query.toLowerCase();
  return INDEX_SECTIONS.some(section =>
    section.intentKeywords.some(kw => queryLower.includes(kw.toLowerCase()))
  );
}
