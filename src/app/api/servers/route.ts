import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { startMonitoringPoller } from '@/lib/monitor/ssh-collector';

export async function GET() {
  try {
    // Ensure poller is running
    startMonitoringPoller();
    const servers = db.getServers();
    return NextResponse.json(servers);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, host, port, username, authType, password, privateKey, isMock } = body;

    if (!name || !host || !username) {
      return NextResponse.json({ error: 'Name, host and username are required' }, { status: 400 });
    }

    const newServer = db.addServer({
      name,
      host,
      port: Number(port) || 22,
      username,
      authType: authType || 'password',
      password,
      privateKey,
      isMock: !!isMock,
      status: 'online',
    });

    return NextResponse.json(newServer, { status: 210 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
