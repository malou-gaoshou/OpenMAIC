import { NextRequest, NextResponse } from 'next/server';
import { listClassroomsFromSupabase, isSupabaseServerConfigured } from '@/lib/server/classroom-storage';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const limit = parseInt(searchParams.get('limit') || '20', 10);
  const offset = parseInt(searchParams.get('offset') || '0', 10);
  const language = searchParams.get('language') || undefined;

  if (!isSupabaseServerConfigured()) {
    return NextResponse.json(
      { error: 'Supabase not configured' },
      { status: 503 }
    );
  }

  try {
    const classrooms = await listClassroomsFromSupabase({ limit, offset, language });

    return NextResponse.json({
      data: classrooms,
      pagination: {
        limit,
        offset,
        hasMore: classrooms.length === limit,
      },
    });
  } catch (error) {
    console.error('Error listing classrooms:', error);
    return NextResponse.json(
      { error: 'Failed to list classrooms' },
      { status: 500 }
    );
  }
}
