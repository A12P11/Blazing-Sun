import { db, MetricEntry, LogEntry } from '@/lib/db';
import { startMonitoringPoller } from '@/lib/monitor/ssh-collector';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  // Ensure the poller daemon is active
  startMonitoringPoller();

  const responseHeaders = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
  };

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const sendUpdate = () => {
        try {
          const servers = db.getServers();
          const incidents = db.getIncidents();
          
          // Organize metrics and logs context per server
          const metrics: Record<string, MetricEntry[]> = {};
          const logs: Record<string, LogEntry[]> = {};

          for (const server of servers) {
            metrics[server.id] = db.getMetrics(server.id, 25);
            logs[server.id] = db.getLogs(server.id, 35);
          }

          const streamPayload = {
            servers,
            incidents,
            metrics,
            logs
          };

          controller.enqueue(encoder.encode(`data: ${JSON.stringify(streamPayload)}\n\n`));
        } catch (error) {
          console.error('[SSE Stream] Failed to send update:', error);
        }
      };

      // Send initial data immediately
      sendUpdate();

      // Poll database cache for changes and stream to client
      const intervalId = setInterval(sendUpdate, 2000);

      // Clean up when client disconnects
      request.signal.addEventListener('abort', () => {
        clearInterval(intervalId);
        try {
          controller.close();
        } catch {
          // ignore already closed stream
        }
      });
    }
  });

  return new Response(stream, { headers: responseHeaders });
}
