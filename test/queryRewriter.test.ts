// ============================================================
// queryRewriter - fallbackRoute 正则降级路由测试
//
// 测试 fallbackRoute 函数：当 LLM 不可用时，用正则匹配判断
// 路由决策（结构化/语义/混合检索）
// ============================================================

import { describe, it, expect } from 'vitest';
import { fallbackRoute } from '@/lib/queryRewriter';

describe('fallbackRoute', () => {
  describe('无匹配实体 → 语义检索', () => {
    it('无匹配实体时应返回 semantic', () => {
      const result = fallbackRoute('微服务架构的核心设计原则是什么', []);

      expect(result.route).toBe('semantic');
      expect(result.reason).toContain('语义检索');
    });

    it('无匹配实体时 matchedEntries 应为空', () => {
      const result = fallbackRoute('如何配置 Nginx 反向代理', []);

      expect(result.matchedEntries).toEqual([]);
    });
  });

  describe('结构化查询模式匹配', () => {
    it('"微服务相关的文档有哪些" 应匹配结构化', () => {
      const result = fallbackRoute(
        '微服务相关的文档有哪些',
        ['微服务']
      );

      expect(result.route).toBe('structured');
      expect(result.reason).toContain('结构化模式');
      expect(result.matchedEntries).toContain('微服务');
    });

    it('"列出所有用到 Kubernetes 的文档" 应匹配结构化', () => {
      const result = fallbackRoute(
        '列出所有用到 Kubernetes 的文档',
        ['Kubernetes']
      );

      expect(result.route).toBe('structured');
    });

    it('"宝武钢铁涉及了哪些项目" 应匹配结构化', () => {
      const result = fallbackRoute(
        '宝武钢铁涉及了哪些项目',
        ['宝武钢铁']
      );

      expect(result.route).toBe('structured');
    });

    it('"哪些项目用到了 Redis" 应匹配结构化', () => {
      const result = fallbackRoute(
        '哪些项目用到了 Redis',
        ['Redis']
      );

      expect(result.route).toBe('structured');
    });

    it('"有多少文档" 应匹配结构化', () => {
      const result = fallbackRoute(
        '有多少文档',
        ['文档']
      );

      expect(result.route).toBe('structured');
    });

    it('"有哪几家公司" 应匹配结构化（实体维度查询）', () => {
      const result = fallbackRoute(
        '有哪几家公司',
        ['公司']
      );

      expect(result.route).toBe('structured');
    });

    it('"哪些公司在用微服务" 应匹配结构化', () => {
      const result = fallbackRoute(
        '哪些公司在用微服务',
        ['微服务']
      );

      expect(result.route).toBe('structured');
    });

    it('"统计数量" 应匹配结构化', () => {
      const result = fallbackRoute(
        '统计微服务相关的数量',
        ['微服务']
      );

      expect(result.route).toBe('structured');
    });

    // 新增补充模式测试
    it('"徐峰负责哪些项目" 应匹配结构化（谁负责类）', () => {
      const result = fallbackRoute(
        '徐峰负责哪些项目',
        ['徐峰']
      );

      expect(result.route).toBe('structured');
    });

    it('"谁在做ERP项目" 应匹配结构化（谁在做类）', () => {
      const result = fallbackRoute(
        '谁在做ERP项目',
        ['ERP']
      );

      expect(result.route).toBe('structured');
    });

    it('"有没有关于ERP的文档" 应匹配结构化（有没有类）', () => {
      const result = fallbackRoute(
        '有没有关于ERP的文档',
        ['ERP']
      );

      expect(result.route).toBe('structured');
    });

    it('"是否存在微服务相关的文档" 应匹配结构化（是否存在类）', () => {
      const result = fallbackRoute(
        '是否存在微服务相关的文档',
        ['微服务']
      );

      expect(result.route).toBe('structured');
    });
  });

  describe('语义查询模式匹配', () => {
    it('"微服务架构的核心设计原则是什么" 应匹配语义', () => {
      const result = fallbackRoute(
        '微服务架构的核心设计原则是什么',
        ['微服务']
      );

      expect(result.route).toBe('semantic');
      expect(result.reason).toContain('语义分析');
    });

    it('"如何配置 Nacos 服务注册" 应匹配语义', () => {
      const result = fallbackRoute(
        '如何配置 Nacos 服务注册',
        ['Nacos']
      );

      expect(result.route).toBe('semantic');
    });

    it('"对比 MySQL 和 Redis 的使用场景" 应匹配语义', () => {
      const result = fallbackRoute(
        '对比 MySQL 和 Redis 的使用场景',
        ['MySQL', 'Redis']
      );

      expect(result.route).toBe('semantic');
    });

    it('"总结国家电网项目的技术架构" 应匹配语义', () => {
      const result = fallbackRoute(
        '总结国家电网项目的技术架构',
        ['国家电网']
      );

      expect(result.route).toBe('semantic');
    });

    it('"为什么选择微服务架构" 应匹配语义', () => {
      const result = fallbackRoute(
        '为什么选择微服务架构',
        ['微服务']
      );

      expect(result.route).toBe('semantic');
    });

    it('"这样做好不好" 应匹配语义', () => {
      const result = fallbackRoute(
        '微服务改造这样做行不行',
        ['微服务']
      );

      expect(result.route).toBe('semantic');
    });

    it('"解释一下分布式事务" 应匹配语义', () => {
      const result = fallbackRoute(
        '解释一下分布式事务',
        ['分布式事务']
      );

      expect(result.route).toBe('semantic');
    });

    // 新增补充模式测试
    it('"介绍一下微服务架构" 应匹配语义（介绍类）', () => {
      const result = fallbackRoute(
        '介绍一下微服务架构',
        ['微服务']
      );

      expect(result.route).toBe('semantic');
    });

    it('"讲一下这个项目的技术方案" 应匹配语义（讲一下类）', () => {
      const result = fallbackRoute(
        '讲一下这个项目的技术方案',
        ['项目']
      );

      expect(result.route).toBe('semantic');
    });

    it('"说说架构设计" 应匹配语义（说说类）', () => {
      const result = fallbackRoute(
        '说说架构设计',
        ['架构']
      );

      expect(result.route).toBe('semantic');
    });
  });

  describe('混合检索模式（hybrid）', () => {
    it('有实体匹配但既非结构化也非语义时，走 hybrid', () => {
      const result = fallbackRoute(
        '宝武钢铁的财务系统',
        ['宝武钢铁', '财务系统']
      );

      expect(result.route).toBe('hybrid');
      expect(result.reason).toContain('混合检索');
    });

    it('单个实体匹配应走 hybrid', () => {
      const result = fallbackRoute(
        '国家电网',
        ['国家电网']
      );

      expect(result.route).toBe('hybrid');
      expect(result.matchedEntries).toEqual(['国家电网']);
    });

    it('多个实体匹配应走 hybrid', () => {
      const result = fallbackRoute(
        '阿里巴巴的云计算平台',
        ['阿里巴巴', '云计算']
      );

      expect(result.route).toBe('hybrid');
    });
  });

  describe('结构化模式优先于语义模式', () => {
    it('同时命中两种模式时，结构化优先', () => {
      // "有哪些文档" 命中结构化，"为什么" 命中语义
      // 结构化模式在前，应优先匹配
      const result = fallbackRoute(
        '微服务相关的文档有哪些，为什么这么设计',
        ['微服务']
      );

      expect(result.route).toBe('structured');
    });
  });

  describe('边界情况', () => {
    it('空查询无实体 → semantic', () => {
      const result = fallbackRoute('', []);

      expect(result.route).toBe('semantic');
    });

    it('纯数字 query → 无实体匹配走 semantic', () => {
      const result = fallbackRoute('12345', []);

      expect(result.route).toBe('semantic');
    });

    it('特殊字符 query → semantic', () => {
      const result = fallbackRoute('@#$%', []);

      expect(result.route).toBe('semantic');
    });

    it('极长 query 有实体 → hybrid', () => {
      const longQuery = 'Redis'.repeat(100);
      const result = fallbackRoute(longQuery, ['Redis']);

      expect(result.route).toBe('hybrid');
    });
  });

  describe('reason 字段', () => {
    it('结构化决策应包含匹配到的词条', () => {
      const result = fallbackRoute(
        '微服务相关的文档有哪些',
        ['微服务', '架构']
      );

      expect(result.reason).toContain('微服务');
      expect(result.reason).toContain('架构');
    });

    it('语义决策应包含说明', () => {
      const result = fallbackRoute(
        '微服务是什么意思',
        ['微服务']
      );

      expect(result.reason).toContain('语义分析');
    });

    it('hybrid 决策应包含实体信息', () => {
      const result = fallbackRoute(
        '国家电网的智慧能源平台建设',
        ['国家电网', '智慧能源']
      );

      expect(result.reason).toContain('国家电网');
    });
  });

  describe('返回类型校验', () => {
    it('返回结果应包含 route、matchedEntries、reason 三个字段', () => {
      const result = fallbackRoute('测试查询', ['测试']);

      expect(result).toHaveProperty('route');
      expect(result).toHaveProperty('matchedEntries');
      expect(result).toHaveProperty('reason');
      expect(['structured', 'semantic', 'hybrid']).toContain(result.route);
    });

    it('route 值必须是合法的 RouteDecision 类型', () => {
      const cases = [
        { query: '有哪些文档', entities: ['文档'] },
        { query: '微服务是什么', entities: ['微服务'] },
        { query: '国家电网项目', entities: ['国家电网'] },
      ];

      for (const { query, entities } of cases) {
        const result = fallbackRoute(query, entities);
        expect(['structured', 'semantic', 'hybrid']).toContain(result.route);
      }
    });
  });
});
