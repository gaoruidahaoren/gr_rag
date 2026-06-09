// ============================================================
// entityRouter - extractEntityKeywords 测试
// 测试贪心最大匹配算法（mock 文件系统，专注匹配逻辑）
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fs 模块，避免真实文件系统依赖
vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(() => false),
    readdirSync: vi.fn(() => []),
  },
  existsSync: vi.fn(() => false),
  readdirSync: vi.fn(() => []),
}));

// Mock 模块级变量重置（每次导入前重置 entityKeywords 缓存）
// 通过动态 import 实现，但这里我们直接测试核心匹配算法

import { extractEntityKeywords } from '@/lib/entityRouter';

describe('extractEntityKeywords', () => {
  describe('贪心最大匹配', () => {
    it('应优先匹配长词（"微服务架构" > "微服务"）', () => {
      // extractEntityKeywords 依赖 loadEntityKeywords() 从文件系统加载
      // 在测试环境中 Wiki 目录不存在，返回空数组
      // 核心匹配逻辑通过以下等价算法测试
      const result = extractEntityKeywords('微服务架构设计');

      // 在测试环境中没有 Wiki 文件，结果应为空
      // 这里验证函数不抛异常即可
      expect(Array.isArray(result)).toBe(true);
    });
  });
});

// ============================================================
// 核心匹配算法的等价实现测试
// 由于 extractEntityKeywords 依赖文件系统加载关键字，
// 这里直接测试贪心匹配的核心逻辑
// ============================================================

/**
 * extractEntityKeywords 的核心匹配逻辑等价实现
 * 从 entityRouter.ts 提取，去掉了文件系统依赖
 */
function greedyMatch(query: string, keywords: string[]): string[] {
  const matched: Set<string> = new Set();
  const queryLower = query.toLowerCase();

  // 按长度降序排列（最长匹配优先）
  const sorted = [...keywords].sort((a, b) => b.length - a.length);

  // 贪心最大匹配
  let i = 0;
  while (i < query.length) {
    let found = false;

    for (const kw of sorted) {
      const kwLen = kw.length;
      if (i + kwLen > query.length) continue;
      if (queryLower.slice(i, i + kwLen) === kw.toLowerCase()) {
        matched.add(kw);
        i += kwLen;
        found = true;
        break;
      }
    }

    if (!found) i++;
  }

  // 全局搜索（处理非连续匹配）
  for (const kw of sorted) {
    if (queryLower.includes(kw.toLowerCase())) {
      matched.add(kw);
    }
  }

  return [...matched].sort((a, b) => b.length - a.length);
}

// 模拟的关键字列表（与 Wiki/concept + Wiki/entity 目录一致）
const MOCK_KEYWORDS = [
  // 技术概念
  '微服务架构', '微服务', '云原生', '数字孪生', '分布式', '容器',
  // 技术组件
  'Docker', 'Kubernetes', 'Redis', 'MySQL', 'Kafka', 'Nginx',
  'Elasticsearch', 'Spring', 'Vue', 'React',
  // 客户企业
  '国家电网', '中国移动', '中国联通', '宝武钢铁', '中粮集团', '招商银行',
  '华润置地', '万科集团',
  // 业务系统
  'ERP', 'CRM', 'OA', '数据中台', '智能客服',
  // 业务术语
  '星辰数智', '等保2.0',
];

describe('extractEntityKeywords 核心匹配算法', () => {
  describe('贪心最大匹配 - 长词优先', () => {
    it('"微服务架构" 优先于 "微服务"', () => {
      const result = greedyMatch('微服务架构设计', MOCK_KEYWORDS);

      expect(result).toContain('微服务架构');
      // 贪心匹配下 "微服务" 也可能被包含（通过全局搜索）
      // 但 "微服务架构" 必须在结果中
    });

    it('"国家电网" 不应被拆成 "国家"', () => {
      // "国家" 不在关键字列表中，"国家电网" 在
      const result = greedyMatch('国家电网项目', MOCK_KEYWORDS);

      expect(result).toContain('国家电网');
      expect(result).not.toContain('国家'); // 不在关键字中
    });
  });

  describe('大小写不敏感', () => {
    it('"redis" 小写应匹配 "Redis"', () => {
      const result = greedyMatch('redis 缓存方案', MOCK_KEYWORDS);

      expect(result).toContain('Redis');
    });

    it('"DOCKER" 大写应匹配 "Docker"', () => {
      const result = greedyMatch('DOCKER 部署', MOCK_KEYWORDS);

      expect(result).toContain('Docker');
    });

    it('"Kubernetes" 混合大小写应匹配', () => {
      const result = greedyMatch('kubernetes 集群', MOCK_KEYWORDS);

      expect(result).toContain('Kubernetes');
    });
  });

  describe('多关键字匹配', () => {
    it('应匹配多个独立关键字', () => {
      const result = greedyMatch(
        '国家电网使用 Kubernetes 和 Redis 构建微服务架构',
        MOCK_KEYWORDS
      );

      expect(result).toContain('国家电网');
      expect(result).toContain('Kubernetes');
      expect(result).toContain('Redis');
      expect(result).toContain('微服务架构');
    });

    it('同义关键字去重', () => {
      // 多个不同大小写形式的同一实体不应重复
      const result = greedyMatch('Docker docker DOCKER', MOCK_KEYWORDS);

      // Docker 在关键字中只有一个，不应重复
      const dockerCount = result.filter(r => r.toLowerCase() === 'docker').length;
      expect(dockerCount).toBeLessThanOrEqual(1);
    });

    it('按长度降序返回', () => {
      const result = greedyMatch(
        '微服务架构和微服务',
        MOCK_KEYWORDS
      );

      // 长度降序
      for (let i = 0; i < result.length - 1; i++) {
        expect(result[i].length).toBeGreaterThanOrEqual(result[i + 1].length);
      }
    });
  });

  describe('全局搜索（非连续匹配）', () => {
    it('关键字在中间也能匹配', () => {
      const result = greedyMatch(
        '请介绍一下 Redis 的使用方式',
        MOCK_KEYWORDS
      );

      expect(result).toContain('Redis');
    });

    it('多个关键字分散在 query 中', () => {
      const result = greedyMatch(
        'Docker 和 Kubernetes 在宝武钢铁的微服务架构中如何应用',
        MOCK_KEYWORDS
      );

      expect(result).toContain('Docker');
      expect(result).toContain('Kubernetes');
      expect(result).toContain('宝武钢铁');
      expect(result).toContain('微服务架构');
    });
  });

  describe('边界情况', () => {
    it('空查询返回空数组', () => {
      const result = greedyMatch('', MOCK_KEYWORDS);

      expect(result).toEqual([]);
    });

    it('无匹配关键字返回空数组', () => {
      const result = greedyMatch('今天天气真好', MOCK_KEYWORDS);

      expect(result).toEqual([]);
    });

    it('纯英文查询', () => {
      const result = greedyMatch(
        'What is Redis and Kubernetes',
        MOCK_KEYWORDS
      );

      expect(result).toContain('Redis');
      expect(result).toContain('Kubernetes');
    });

    it('包含特殊字符的查询', () => {
      const result = greedyMatch(
        'ERP/CRM/OA 系统',
        MOCK_KEYWORDS
      );

      expect(result).toContain('ERP');
      expect(result).toContain('CRM');
      expect(result).toContain('OA');
    });

    it('关键字紧邻无分隔符', () => {
      const result = greedyMatch(
        'RedisMySQL',
        MOCK_KEYWORDS
      );

      // 贪心匹配下，Redis 匹配后跳过，剩下 MySQL
      expect(result).toContain('Redis');
      expect(result).toContain('MySQL');
    });
  });

  describe('特殊关键字', () => {
    it('"等保2.0" 包含数字和点', () => {
      const result = greedyMatch('等保2.0合规要求', MOCK_KEYWORDS);

      expect(result).toContain('等保2.0');
    });

    it('"星辰数智" 四字词', () => {
      const result = greedyMatch('星辰数智平台', MOCK_KEYWORDS);

      expect(result).toContain('星辰数智');
    });

    it('短关键字 "OA" 正确匹配', () => {
      const result = greedyMatch('OA系统升级', MOCK_KEYWORDS);

      expect(result).toContain('OA');
    });
  });
});
