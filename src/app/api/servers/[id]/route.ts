import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    db.deleteServer(id);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unable to delete server';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
