// ============================================================
// smartRouter - localRuleJudge 纯函数测试
// 测试本地路由规则判断逻辑（正则匹配 + 实体路由决策）
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock isIndexQuery 为始终返回 false（独立测试路由逻辑）
vi.mock('@/lib/indexLookup', () => ({
  isIndexQuery: vi.fn(() => false),
}));

import { localRuleJudge } from '@/lib/smartRouter';

describe('localRuleJudge', () => {
  describe('无匹配实体 → 语义检索', () => {
    it('无匹配实体时应返回 semantic', () => {
      const result = localRuleJudge('微服务架构的核心设计原则是什么', []);

      expect(result).not.toBeNull();
      expect(result!.decision).toBe('semantic');
      expect(result!.reason).toContain('语义检索');
    });

    it('无匹配实体时 matchedEntries 应为空', () => {
      const result = localRuleJudge('如何配置 Nginx 反向代理', []);

      expect(result!.matchedEntries).toEqual([]);
    });
  });

  describe('结构化查询模式匹配', () => {
    it('"微服务相关的文档有哪些" 应匹配结构化', () => {
      const result = localRuleJudge(
        '微服务相关的文档有哪些',
        ['微服务']
      );

      expect(result!.decision).toBe('structured');
      expect(result!.reason).toContain('结构化模式');
      expect(result!.matchedEntries).toContain('微服务');
    });

    it('"列出所有用到 Kubernetes 的文档" 应匹配结构化', () => {
      const result = localRuleJudge(
        '列出所有用到 Kubernetes 的文档',
        ['Kubernetes']
      );

      expect(result!.decision).toBe('structured');
    });

    it('"宝武钢铁涉及了哪些项目" 应匹配结构化', () => {
      const result = localRuleJudge(
        '宝武钢铁涉及了哪些项目',
        ['宝武钢铁']
      );

      expect(result!.decision).toBe('structured');
    });

    it('"哪些项目用到了 Redis" 应匹配结构化', () => {
      const result = localRuleJudge(
        '哪些项目用到了 Redis',
        ['Redis']
      );

      expect(result!.decision).toBe('structured');
    });

    it('"有多少文档" 应匹配结构化', () => {
      const result = localRuleJudge(
        '有多少文档',
        ['文档']
      );

      expect(result!.decision).toBe('structured');
    });

    it('"有哪几家公司" 应匹配结构化（实体维度查询）', () => {
      const result = localRuleJudge(
        '有哪几家公司',
        ['公司']
      );

      expect(result!.decision).toBe('structured');
    });

    it('"哪些公司在用微服务" 应匹配结构化', () => {
      const result = localRuleJudge(
        '哪些公司在用微服务',
        ['微服务']
      );

      expect(result!.decision).toBe('structured');
    });

    it('"统计数量" 应匹配结构化', () => {
      const result = localRuleJudge(
        '统计微服务相关的数量',
        ['微服务']
      );

      expect(result!.decision).toBe('structured');
    });
  });

  describe('语义查询模式匹配', () => {
    it('"微服务架构的核心设计原则是什么" 应匹配语义', () => {
      const result = localRuleJudge(
        '微服务架构的核心设计原则是什么',
        ['微服务']
      );

      expect(result!.decision).toBe('semantic');
      expect(result!.reason).toContain('语义分析');
    });

    it('"如何配置 Nacos 服务注册" 应匹配语义', () => {
      const result = localRuleJudge(
        '如何配置 Nacos 服务注册',
        ['Nacos']
      );

      expect(result!.decision).toBe('semantic');
    });

    it('"对比 MySQL 和 Redis 的使用场景" 应匹配语义', () => {
      const result = localRuleJudge(
        '对比 MySQL 和 Redis 的使用场景',
        ['MySQL', 'Redis']
      );

      expect(result!.decision).toBe('semantic');
    });

    it('"总结国家电网项目的技术架构" 应匹配语义', () => {
      const result = localRuleJudge(
        '总结国家电网项目的技术架构',
        ['国家电网']
      );

      expect(result!.decision).toBe('semantic');
    });

    it('"为什么选择微服务架构" 应匹配语义', () => {
      const result = localRuleJudge(
        '为什么选择微服务架构',
        ['微服务']
      );

      expect(result!.decision).toBe('semantic');
    });

    it('"这样做好不好" 应匹配语义', () => {
      const result = localRuleJudge(
        '微服务改造这样做行不行',
        ['微服务']
      );

      expect(result!.decision).toBe('semantic');
    });

    it('"解释一下分布式事务" 应匹配语义', () => {
      const result = localRuleJudge(
        '解释一下分布式事务',
        ['分布式事务']
      );

      expect(result!.decision).toBe('semantic');
    });
  });

  describe('混合检索模式（hybrid）', () => {
    it('有实体匹配但既非结构化也非语义时，走 hybrid', () => {
      const result = localRuleJudge(
        '宝武钢铁的财务系统',
        ['宝武钢铁', '财务系统']
      );

      expect(result!.decision).toBe('hybrid');
      expect(result!.reason).toContain('混合检索');
    });

    it('单个实体匹配应走 hybrid', () => {
      const result = localRuleJudge(
        '国家电网',
        ['国家电网']
      );

      expect(result!.decision).toBe('hybrid');
      expect(result!.matchedEntries).toEqual(['国家电网']);
    });

    it('多个实体匹配应走 hybrid', () => {
      const result = localRuleJudge(
        '阿里巴巴的云计算平台',
        ['阿里巴巴', '云计算']
      );

      expect(result!.decision).toBe('hybrid');
    });
  });

  describe('结构化模式优先于语义模式', () => {
    it('同时命中两种模式时，结构化优先', () => {
      // "有哪些文档" 命中结构化，"为什么" 命中语义
      // 结构化模式在前，应优先匹配
      const result = localRuleJudge(
        '微服务相关的文档有哪些，为什么这么设计',
        ['微服务']
      );

      expect(result!.decision).toBe('structured');
    });
  });

  describe('边界情况', () => {
    it('空查询无实体 → semantic', () => {
      const result = localRuleJudge('', []);

      expect(result!.decision).toBe('semantic');
    });

    it('纯数字 query → 无实体匹配走 semantic', () => {
      const result = localRuleJudge('12345', []);

      expect(result!.decision).toBe('semantic');
    });

    it('特殊字符 query → semantic', () => {
      const result = localRuleJudge('@#$%', []);

      expect(result!.decision).toBe('semantic');
    });

    it('极长 query 有实体 → hybrid', () => {
      const longQuery = 'Redis'.repeat(100);
      const result = localRuleJudge(longQuery, ['Redis']);

      expect(result!.decision).toBe('hybrid');
    });
  });

  describe('reason 字段', () => {
    it('结构化决策应包含匹配到的词条', () => {
      const result = localRuleJudge(
        '微服务相关的文档有哪些',
        ['微服务', '架构']
      );

      expect(result!.reason).toContain('微服务');
      expect(result!.reason).toContain('架构');
    });

    it('语义决策应包含说明', () => {
      const result = localRuleJudge(
        '微服务是什么意思',
        ['微服务']
      );

      expect(result!.reason).toContain('语义分析');
    });
  });
});
