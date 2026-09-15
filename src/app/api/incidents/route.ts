import { NextResponse } from 'next/server';
import { db, readDb, writeDb } from '@/lib/db';
import { setMockAnomalyType } from '@/lib/monitor/ssh-collector';
import { ensureSimulatorRunning } from '@/lib/simulator';

export async function GET() {
  try {
    const incidents = db.getIncidents();
    return NextResponse.json(incidents);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unable to load incidents';
    return NextResponse.json({ error: message }, { status: 500 });
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

      const simulatorReady = await ensureSimulatorRunning();
      if (!simulatorReady) {
        console.log('Failed to start or reach the Python simulator API.');
        return NextResponse.json({ error: 'Python anomaly simulator is unavailable' }, { status: 503 });
      }

      try {
        await fetch('http://localhost:5050/trigger', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type })
        });
      } catch (e) {
        console.log('Failed to reach Python simulator API.', e);
        return NextResponse.json({ error: 'Python anomaly simulator is unavailable' }, { status: 503 });
      }

      return NextResponse.json({ success: true, message: `Anomaly ${type} triggered` });
    }

    if (action === 'clear_anomaly') {
      setMockAnomalyType(null);
      const simulatorReady = await ensureSimulatorRunning();
      if (!simulatorReady) {
        return NextResponse.json({ success: true, message: 'Anomaly cleared locally; simulator unavailable' });
      }
      try {
        await fetch('http://localhost:5050/trigger', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'clear' })
        });
      } catch {
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
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Incident request failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
