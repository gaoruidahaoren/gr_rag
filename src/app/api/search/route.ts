import { NextRequest, NextResponse } from 'next/server';
import { hybridSearch } from '@/lib/hybridSearch';
import { isIndexReady } from '@/lib/indexManager';
import { extractEntityKeywords } from '@/lib/entityRouter';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get('q');
  const topK = parseInt(searchParams.get('topK') || '10');
  const searchMethod = searchParams.get('method') as 'rrf' | 'entity' | 'structured' | 'hybrid' | undefined;

  if (!query || query.trim().length === 0) {
    return NextResponse.json({ error: '请提供搜索关键词' }, { status: 400 });
  }

  if (!isIndexReady()) {
    return NextResponse.json(
      { error: '索引尚未初始化完成，请稍后再试' },
      { status: 503 }
    );
  }

  try {
    const trimmedQuery = query.trim();
    const matched = extractEntityKeywords(trimmedQuery);
    const results = await hybridSearch(trimmedQuery, topK, 20, 20, {
      matchedKeywords: matched.length > 0 ? matched : undefined,
    });

    return NextResponse.json({
      query,
      matchedKeywords: matched.length > 0 ? matched : undefined,
      total: results.length,
      results: results.map(r => ({
        id: r.chunk.id,
        docId: r.chunk.docId,
        docTitle: r.chunk.docTitle,
        docPath: r.chunk.docPath,
        content: r.chunk.content.slice(0, 500),
        metadata: r.chunk.metadata,
        score: r.score,
        source: r.source,
        highlight: r.highlight,
      })),
    });
  } catch (err: any) {
    console.error('[API] 搜索失败:', err);
    return NextResponse.json({ error: `搜索失败: ${err.message}` }, { status: 500 });
  }
}
