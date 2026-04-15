import { NextRequest, NextResponse } from 'next/server';
import { readClassroomFromSupabase, isValidClassroomId } from '@/lib/server/classroom-storage';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!isValidClassroomId(id)) {
    return NextResponse.json(
      { error: 'Invalid classroom ID' },
      { status: 400 }
    );
  }

  try {
    const classroom = await readClassroomFromSupabase(id);

    if (!classroom) {
      return NextResponse.json(
        { error: 'Classroom not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      data: classroom,
    });
  } catch (error) {
    console.error('Error reading classroom from Supabase:', error);
    return NextResponse.json(
      { error: 'Failed to read classroom' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!isValidClassroomId(id)) {
    return NextResponse.json(
      { error: 'Invalid classroom ID' },
      { status: 400 }
    );
  }

  try {
    const { deleteClassroomFromSupabase } = await import('@/lib/server/classroom-storage');
    await deleteClassroomFromSupabase(id);

    return NextResponse.json({
      success: true,
      id,
    });
  } catch (error) {
    console.error('Error deleting classroom:', error);
    return NextResponse.json(
      { error: 'Failed to delete classroom' },
      { status: 500 }
    );
  }
}
