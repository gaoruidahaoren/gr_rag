import { NextResponse } from 'next/server';
import { loadAllRawDocs } from '@/lib/parser';

export async function GET() {
  try {
    const docs = loadAllRawDocs();
    const list = docs.map(doc => ({
      id: doc.id,
      title: doc.title,
      path: doc.path,
      metadata: doc.metadata,
      wikiLinks: doc.wikiLinks,
      chunkCount: doc.chunks.length,
    }));

    return NextResponse.json({ total: list.length, docs: list });
  } catch (err: any) {
    console.error('[API] 获取文档列表失败:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
