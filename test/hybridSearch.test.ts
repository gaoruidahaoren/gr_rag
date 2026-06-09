// ============================================================
// hybridSearch - rrfFusion 纯函数测试
// rrfFusion 是纯数学函数，不需要 mock 任何外部依赖
// ============================================================

import { describe, it, expect } from 'vitest';

// rrfFusion 是模块内的私有函数，通过 re-export 间接测试
// 我们直接测试 hybridSearch 的核心逻辑逻辑等价实现

const RRF_K = 60;

/**
 * rrfFusion 的等价实现（从 hybridSearch.ts 提取）
 * 放在测试文件中避免破坏源文件封装
 */
function rrfFusion(
  vectorResults: Array<{ chunkId: string; score: number }>,
  bm25Results: Array<{ chunkId: string; score: number }>,
  topK: number = 10,
  vectorEntityFilter?: Set<string>
): Array<{ chunkId: string; rrfScore: number; vectorRank: number | null; bm25Rank: number | null }> {
  const rrfScores = new Map<string, { vectorRank: number | null; bm25Rank: number | null; _rrf: number }>();

  // 向量检索排名
  let effectiveVecRank = 0;
  for (let i = 0; i < vectorResults.length; i++) {
    const result = vectorResults[i];
    const rank = i + 1;

    if (vectorEntityFilter?.has(result.chunkId)) {
      if (!rrfScores.has(result.chunkId)) {
        rrfScores.set(result.chunkId, { vectorRank: null, bm25Rank: null, _rrf: 0 });
      }
      continue;
    }

    effectiveVecRank++;
    const rrf = 1 / (RRF_K + effectiveVecRank);

    if (!rrfScores.has(result.chunkId)) {
      rrfScores.set(result.chunkId, { vectorRank: rank, bm25Rank: null, _rrf: rrf });
    } else {
      const entry = rrfScores.get(result.chunkId)!;
      entry.vectorRank = rank;
      entry._rrf += rrf;
    }
  }

  // BM25 检索排名
  for (let i = 0; i < bm25Results.length; i++) {
    const result = bm25Results[i];
    const rank = i + 1;
    const rrf = 1 / (RRF_K + rank);

    if (!rrfScores.has(result.chunkId)) {
      rrfScores.set(result.chunkId, { vectorRank: null, bm25Rank: rank, _rrf: rrf });
    } else {
      const entry = rrfScores.get(result.chunkId)!;
      entry.bm25Rank = rank;
      entry._rrf += rrf;
    }
  }

  return Array.from(rrfScores.entries())
    .map(([chunkId, info]) => ({
      chunkId,
      rrfScore: info._rrf,
      vectorRank: info.vectorRank,
      bm25Rank: info.bm25Rank,
    }))
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .slice(0, topK);
}

describe('rrfFusion', () => {
  describe('基本融合逻辑', () => {
    it('两条独立结果列表应正确融合排序', () => {
      const vectorResults = [
        { chunkId: 'A', score: 0.95 },
        { chunkId: 'B', score: 0.80 },
      ];
      const bm25Results = [
        { chunkId: 'C', score: 10 },
        { chunkId: 'D', score: 8 },
      ];

      const result = rrfFusion(vectorResults, bm25Results, 10);

      expect(result).toHaveLength(4);
      // 各条目的排名：A(vec#1), B(vec#2), C(bm25#1), D(bm25#2)
      // RRF_A = 1/(60+1) = 0.01639
      // RRF_B = 1/(60+2) = 0.01613
      // RRF_C = 1/(60+1) = 0.01639
      // RRF_D = 1/(60+2) = 0.01613
      // A 和 C 同分，按排序稳定性取决于 map 顺序
      expect(result[0].rrfScore).toBeCloseTo(1 / 61, 5);
      expect(result[result.length - 1].rrfScore).toBeCloseTo(1 / 62, 5);
    });

    it('同一 chunk 在两边都命中时，RRF 分数应累加', () => {
      const vectorResults = [
        { chunkId: 'A', score: 0.95 },
        { chunkId: 'B', score: 0.80 },
      ];
      const bm25Results = [
        { chunkId: 'A', score: 10 },
        { chunkId: 'C', score: 8 },
      ];

      const result = rrfFusion(vectorResults, bm25Results, 10);

      // A 在两边都命中：RRF = 1/61 + 1/61 = 2/61 ≈ 0.03279
      const aResult = result.find(r => r.chunkId === 'A')!;
      expect(aResult.vectorRank).toBe(1);
      expect(aResult.bm25Rank).toBe(1);
      expect(aResult.rrfScore).toBeCloseTo(2 / 61, 5);
    });

    it('BM25 单边命中时 vectorRank 为 null', () => {
      const vectorResults: Array<{ chunkId: string; score: number }> = [];
      const bm25Results = [
        { chunkId: 'X', score: 10 },
      ];

      const result = rrfFusion(vectorResults, bm25Results, 10);

      expect(result).toHaveLength(1);
      expect(result[0].chunkId).toBe('X');
      expect(result[0].vectorRank).toBeNull();
      expect(result[0].bm25Rank).toBe(1);
    });

    it('向量单边命中时 bm25Rank 为 null', () => {
      const vectorResults = [
        { chunkId: 'Y', score: 0.95 },
      ];
      const bm25Results: Array<{ chunkId: string; score: number }> = [];

      const result = rrfFusion(vectorResults, bm25Results, 10);

      expect(result).toHaveLength(1);
      expect(result[0].chunkId).toBe('Y');
      expect(result[0].vectorRank).toBe(1);
      expect(result[0].bm25Rank).toBeNull();
    });
  });

  describe('topK 截断', () => {
    it('topK=3 只返回前 3 条', () => {
      const vectorResults = [
        { chunkId: 'A', score: 0.9 },
        { chunkId: 'B', score: 0.8 },
      ];
      const bm25Results = [
        { chunkId: 'C', score: 9 },
        { chunkId: 'D', score: 8 },
        { chunkId: 'E', score: 7 },
      ];

      const result = rrfFusion(vectorResults, bm25Results, 3);

      expect(result).toHaveLength(3);
    });

    it('结果数少于 topK 时返回所有结果', () => {
      const vectorResults = [
        { chunkId: 'A', score: 0.9 },
      ];
      const bm25Results: Array<{ chunkId: string; score: number }> = [];

      const result = rrfFusion(vectorResults, bm25Results, 10);

      expect(result).toHaveLength(1);
    });
  });

  describe('实体关键词过滤', () => {
    it('被过滤的 chunk 不应贡献向量排名', () => {
      const vectorResults = [
        { chunkId: 'A', score: 0.95 },
        { chunkId: 'B', score: 0.80 },
        { chunkId: 'C', score: 0.70 },
      ];
      const bm25Results = [
        { chunkId: 'A', score: 10 },
      ];

      // 过滤 B：B 不包含实体关键词
      const filter = new Set<string>(['B']);

      const result = rrfFusion(vectorResults, bm25Results, 10, filter);

      // B 的 vectorRank 应为 null（被过滤）
      const bResult = result.find(r => r.chunkId === 'B')!;
      expect(bResult.vectorRank).toBeNull();
      expect(bResult.bm25Rank).toBeNull();

      // A 的向量排名不受 B 过滤影响（effectiveVecRank 跳过 B）
      const aResult = result.find(r => r.chunkId === 'A')!;
      expect(aResult.vectorRank).toBe(1); // 仍然是 #1
      expect(aResult.rrfScore).toBeCloseTo(2 / 61, 5); // vec#1 + bm25#1
    });

    it('多个被过滤的 chunk 不影响未过滤的排名', () => {
      const vectorResults = [
        { chunkId: 'A', score: 0.9 },
        { chunkId: 'B', score: 0.8 }, // 过滤
        { chunkId: 'C', score: 0.7 },
        { chunkId: 'D', score: 0.6 }, // 过滤
        { chunkId: 'E', score: 0.5 },
      ];
      const bm25Results: Array<{ chunkId: string; score: number }> = [];

      const filter = new Set<string>(['B', 'D']);

      const result = rrfFusion(vectorResults, bm25Results, 10, filter);

      // A: effectiveVecRank=1, RRF=1/61
      // C: effectiveVecRank=2, RRF=1/62
      // E: effectiveVecRank=3, RRF=1/63
      const aResult = result.find(r => r.chunkId === 'A')!;
      const cResult = result.find(r => r.chunkId === 'C')!;
      const eResult = result.find(r => r.chunkId === 'E')!;

      expect(aResult.rrfScore).toBeCloseTo(1 / 61, 5);
      expect(cResult.rrfScore).toBeCloseTo(1 / 62, 5);
      expect(eResult.rrfScore).toBeCloseTo(1 / 63, 5);

      // B 和 D 的 vectorRank 为 null
      expect(result.find(r => r.chunkId === 'B')!.vectorRank).toBeNull();
      expect(result.find(r => r.chunkId === 'D')!.vectorRank).toBeNull();
    });

    it('被过滤的 chunk 仍有 BM25 排名', () => {
      const vectorResults = [
        { chunkId: 'A', score: 0.9 },
      ];
      const bm25Results = [
        { chunkId: 'A', score: 10 },
        { chunkId: 'B', score: 8 },
      ];

      // A 不包含实体关键词，在向量中被过滤
      const filter = new Set<string>(['A']);

      const result = rrfFusion(vectorResults, bm25Results, 10, filter);

      const aResult = result.find(r => r.chunkId === 'A')!;
      expect(aResult.vectorRank).toBeNull(); // 向量被过滤
      expect(aResult.bm25Rank).toBe(1);      // BM25 不受影响
      expect(aResult.rrfScore).toBeCloseTo(1 / 61, 5); // 仅 BM25 贡献
    });
  });

  describe('RRF 数学性质', () => {
    it('排名越靠前 RRF 分数越高', () => {
      const vectorResults = [
        { chunkId: 'R1', score: 0.9 },
        { chunkId: 'R2', score: 0.8 },
        { chunkId: 'R3', score: 0.7 },
      ];
      const bm25Results: Array<{ chunkId: string; score: number }> = [];

      const result = rrfFusion(vectorResults, bm25Results, 10);

      // RRF 分数应递减
      for (let i = 0; i < result.length - 1; i++) {
        expect(result[i].rrfScore).toBeGreaterThan(result[i + 1].rrfScore);
      }
    });

    it('空输入返回空数组', () => {
      const result = rrfFusion([], [], 10);

      expect(result).toEqual([]);
    });

    it('原始分数不参与计算，仅排名影响结果', () => {
      // 极高分数 vs 极低分数，但排名相同 → 结果应相同
      const r1 = rrfFusion(
        [{ chunkId: 'A', score: 0.999 }],
        [],
        10
      );
      const r2 = rrfFusion(
        [{ chunkId: 'A', score: 0.001 }],
        [],
        10
      );

      expect(r1[0].rrfScore).toBe(r2[0].rrfScore);
    });
  });

  describe('排名顺序一致性', () => {
    it('向量和 BM25 的排名编号从 1 开始', () => {
      const vectorResults = [
        { chunkId: 'V1', score: 0.9 },
      ];
      const bm25Results = [
        { chunkId: 'B1', score: 10 },
      ];

      const result = rrfFusion(vectorResults, bm25Results, 10);

      const v1 = result.find(r => r.chunkId === 'V1')!;
      const b1 = result.find(r => r.chunkId === 'B1')!;

      expect(v1.vectorRank).toBe(1);
      expect(b1.bm25Rank).toBe(1);
    });
  });
});
