import { NextResponse } from 'next/server';
import { db, readDb, writeDb } from '@/lib/db';
import { setMockAnomalyType } from '@/lib/monitor/ssh-collector';

export async function GET() {
  try {
    const incidents = db.getIncidents();
    return NextResponse.json(incidents);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, type, incidentId } = body;

    if (action === 'trigger_anomaly') {
      if (!type) {
        return NextResponse.json({ error: 'Anomaly type is required' }, { status: 400 });
      }

      setMockAnomalyType(type);

      // Hit the Docker python simulator
      try {
        await fetch('http://localhost:5050/trigger', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type })
        });
      } catch (e) {
        console.log('Failed to reach docker simulator API (may not be running).', e);
      }

      return NextResponse.json({ success: true, message: `Anomaly ${type} triggered` });
    }

    if (action === 'clear_anomaly') {
      setMockAnomalyType(null);
      try {
        await fetch('http://localhost:5050/trigger', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'clear' })
        });
      } catch (e) {
        // ignore
      }
      return NextResponse.json({ success: true, message: 'Anomaly cleared' });
    }

    if (action === 'resolve') {
      if (!incidentId) {
        return NextResponse.json({ error: 'Incident ID is required' }, { status: 400 });
      }
      db.resolveIncident(incidentId);
      return NextResponse.json({ success: true });
    }

    if (action === 'reset_all') {
      // Clear logs, metrics, incidents
      const database = readDb();
      database.logs = [];
      database.metrics = [];
      database.incidents = [];
      writeDb(database);
      return NextResponse.json({ success: true, message: 'History reset successfully' });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
