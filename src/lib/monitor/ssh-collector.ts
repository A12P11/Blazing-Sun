import { Client } from 'ssh2';
import { db, Server, LogEntry, Incident, RcaReport, DiagnosticCommand } from '../db';
import { analyzeIncidentWithAI } from '../ai/rca-agent';

let isPollingStarted = false;
let pollingInterval: NodeJS.Timeout | null = null;
let mockAnomalyType: string | null = null;

export function setMockAnomalyType(type: string | null) {
  mockAnomalyType = type;
}

// Initialize monitoring poller
export function startMonitoringPoller() {
  if (isPollingStarted) return;
  isPollingStarted = true;

  console.log('--- Telemetry & Log Monitoring Poller Started ---');

  // Poll every 3 seconds for quick dashboard feedback
  pollingInterval = setInterval(async () => {
    try {
      const servers = db.getServers();
      for (const server of servers) {
        await pollRealServer(server);
      }
    } catch (err) {
      console.error('Error in monitoring poll cycle:', err);
    }
  }, 4000);
}

export function stopMonitoringPoller() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
  isPollingStarted = false;
}

// Evaluate threshold rules & generate incident if needed
async function evaluateIncidentTriggers(
  server: Server,
  cpu: number,
  ram: number,
  disk: number,
  logs: Omit<LogEntry, 'id'>[]
) {
  // Check if server already has an active incident to avoid duplication
  const activeIncidents = db.getIncidents('ACTIVE').filter(i => i.serverId === server.id);
  if (activeIncidents.length > 0) {
    return; // Already investigating or alert triggered
  }

  let triggerReason = '';
  let severity: 'WARNING' | 'CRITICAL' = 'WARNING';
  let title = '';
  let description = '';

  // 1. Metric threshold checks
  if (cpu > 85) {
    triggerReason = `Metric Threshold: CPU utilization reached ${cpu}%`;
    severity = cpu > 90 ? 'CRITICAL' : 'WARNING';
    title = `High CPU Anomaly on ${server.name}`;
    description = `The system detected that CPU usage has spiked to ${cpu}%, which exceeds the alert threshold of 85%.`;
  } else if (ram > 90) {
    triggerReason = `Metric Threshold: RAM usage reached ${ram}%`;
    severity = ram > 95 ? 'CRITICAL' : 'WARNING';
    title = `Memory Starvation Alert on ${server.name}`;
    description = `RAM consumption has reached ${ram}%. Potential memory leak or resource contention.`;
  } else if (disk > 95) {
    triggerReason = `Metric Threshold: Disk space utilization reached ${disk}%`;
    severity = 'CRITICAL';
    title = `Disk Storage Exhaustion on ${server.name}`;
    description = `Disk partition is almost full (${disk}% utilized). Immediate clean-up is required to prevent filesystem lockup.`;
  } else {
    // 2. Check for Error logs
    const errorLog = logs.find(l => l.level === 'ERROR');
    if (errorLog) {
      triggerReason = `Log Alert Error: "${errorLog.source}" daemon logged: ${errorLog.message}`;
      severity = 'CRITICAL';
      title = `Critical System Daemon Error: [${errorLog.source}]`;
      description = `The monitoring agent captured a critical error in system log stream from ${errorLog.source}: "${errorLog.message}"`;
    }
  }

  if (triggerReason) {
    // Prevent spamming the same incident if it was resolved recently (within 2 minutes)
    // Only apply this to Metric Thresholds, as Log Alerts are already deduplicated per-click
    if (triggerReason.startsWith('Metric Threshold')) {
      const resolvedIncidents = db.getIncidents('RESOLVED').filter(i => i.serverId === server.id);
      const recentIncident = resolvedIncidents[0];
      if (recentIncident && recentIncident.title === title) {
        const timeSinceLastIncident = Date.now() - new Date(recentIncident.createdAt).getTime();
        if (timeSinceLastIncident < 2 * 60 * 1000) { // 2 minutes cooldown
          return;
        }
      }
    }

    console.log(`[ALERT] Threshold breached! Creating incident for server: ${server.name} - ${triggerReason}`);

    // Capture logs and metrics history as context for AI
    const logsContext = db.getLogs(server.id, 15);
    const metricsContext = db.getMetrics(server.id, 10);

    const incident = db.addIncident({
      serverId: server.id,
      severity,
      title,
      description,
      triggeredBy: triggerReason,
      logsContext,
      metricsContext
    });

    // Fire off async AI diagnosis & SSH command investigation
    triggerIncidentInvestigation(server, incident);
  }
}

// Executes diagnostic commands via SSH (real) or mocks them (simulated)
async function triggerIncidentInvestigation(server: Server, incident: Incident) {
  console.log(`[SSH Investigation] Launching automated SSH diagnosis sequence for incident ${incident.id}...`);

  const diagnosticCommands: { command: string; desc: string }[] = [
    { command: 'uptime', desc: 'System uptime and load average' },
    { command: 'free -h', desc: 'Available and used physical RAM' },
    { command: 'df -h', desc: 'Disk space layout' },
    { command: 'ps -eo %cpu,%mem,pid,cmd --sort=-%cpu | head -n 8', desc: 'Top resource consuming processes' },
    { command: 'dmesg -T | tail -n 25', desc: 'Recent kernel rings and hardware messages (OOM killer info)' },
    { command: 'ss -antp | head -n 20', desc: 'Active network ports and processes' }
  ];

  const results: DiagnosticCommand[] = [];

  for (const cmdInfo of diagnosticCommands) {
    let output = '';
    if (server.isMock) {
      output = getSimulatedCommandOutput(cmdInfo.command, server);
    } else {
      output = await executeSSHCommand(server, cmdInfo.command);
    }

    results.push({
      command: cmdInfo.command,
      output,
      timestamp: new Date().toISOString()
    });
  }

  // Update incident with diagnostics run
  db.updateIncident(incident.id, {
    diagnosticCommandsRun: results
  });

  // Call AI Root Cause Investigator
  try {
    console.log(`[AI RCA] Analyzing gathered parameters for Incident ${incident.id} with Groq AI...`);
    const rcaReport = await analyzeIncidentWithAI(incident, results);
    db.resolveIncident(incident.id, rcaReport);
    console.log(`[AI RCA] Incident ${incident.id} successfully diagnosed and resolved!`);
  } catch (error) {
    console.error(`[AI RCA] AI generation failed for incident ${incident.id}:`, error);
    // Still resolve the incident with a fallback report so the UI is not blocked
    const fallbackReport: RcaReport = {
      summary: `Failed to compile automated analysis due to AI engine exception.`,
      rootCause: `Unknown (diagnostic collection succeeded but AI service returned an error)`,
      impact: `High risk of repeating failure logs`,
      technicalAnalysis: `Terminal diagnostic execution output is captured below. Review the commands section.`,
      remediationSteps: [
        'Examine the attached diagnostic logs manually.',
        'Restart the offending service manually.'
      ],
      aiModel: 'Fallback/Offline',
      generatedAt: new Date().toISOString()
    };
    db.resolveIncident(incident.id, fallbackReport);
  }
}

// Run SSH commands against a real server
function executeSSHCommand(server: Server, command: string): Promise<string> {
  return new Promise((resolve) => {
    const conn = new Client();
    conn.on('ready', () => {
      conn.exec(command, (err, stream) => {
        if (err) {
          resolve(`Command execution failed: ${err.message}`);
          conn.end();
          return;
        }
        let stdout = '';
        let stderr = '';
        stream.on('data', (data: Buffer) => {
          stdout += data.toString();
        });
        stream.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });
        stream.on('close', () => {
          resolve(stdout + (stderr ? `\nSTDERR:\n${stderr}` : ''));
          conn.end();
        });
      });
    }).on('error', (err) => {
      resolve(`SSH connection failed: ${err.message}`);
    }).connect({
      host: server.host,
      port: server.port,
      username: server.username,
      ...(server.authType === 'password'
        ? { password: server.password }
        : { privateKey: server.privateKey })
    });
  });
}

function getMockSystemMetrics() {
  const now = Date.now();
  const cycle = Math.sin(now / 4500);
  const anomaly = mockAnomalyType ?? null;

  if (anomaly === 'cpu') {
    return {
      cpu: Math.min(99, 86 + Math.abs(cycle) * 12 + 2),
      ram: 58 + Math.sin(now / 4700) * 9,
      disk: 60 + Math.cos(now / 5100) * 8,
    };
  }

  if (anomaly === 'ram') {
    return {
      cpu: 44 + Math.sin(now / 5200) * 10,
      ram: Math.min(99, 88 + Math.abs(cycle) * 8 + 3),
      disk: 62 + Math.cos(now / 4700) * 6,
    };
  }

  if (anomaly === 'disk') {
    return {
      cpu: 42 + Math.cos(now / 4300) * 9,
      ram: 60 + Math.sin(now / 4900) * 8,
      disk: Math.min(99, 92 + Math.abs(cycle) * 7 + 2),
    };
  }

  return {
    cpu: 26 + (Math.sin(now / 5500) + 1) * 16,
    ram: 38 + (Math.cos(now / 6300) + 1) * 16,
    disk: 48 + (Math.sin(now / 7000) + 1) * 10,
  };
}

function buildMockLogLines(): string[] {
  const anomaly = mockAnomalyType ?? null;

  if (anomaly === 'cpu') {
    return [
      '[ERROR] [cpu-saturation] CPU usage peaked at 96.4% on worker-2',
      '[WARN] [scheduler] Backlog queue is growing above the expected threshold',
      '[ERROR] [kubelet] Container runtime hit execution timeout for web-frontend-7',
    ];
  }

  if (anomaly === 'ram') {
    return [
      '[WARN] [oom-killer] Memory pressure exceeded safe limit for web-node-3',
      '[ERROR] [node] JavaScript heap out of memory in api-gateway',
      '[WARN] [allocator] GC pause exceeded 1.4s due to sustained heap growth',
    ];
  }

  if (anomaly === 'disk') {
    return [
      '[ERROR] [filesystem] /var/lib/app is 98% full; write failures imminent',
      '[WARN] [storage] I/O latency increased by 420ms during compaction',
      '[ERROR] [daemon] Failed to rotate log file due to no space left on device',
    ];
  }

  if (anomaly === 'db_error') {
    return [
      '[ERROR] [postgres] connection pool exhausted; 42 pending client requests',
      '[WARN] [db-proxy] retry storm detected against primary replica',
      '[ERROR] [postgres] remaining connection slots reserved for non-replication superusers',
    ];
  }

  if (anomaly === 'auth_error') {
    return [
      '[ERROR] [auth] invalid token signature for session token x9j-bm8',
      '[WARN] [gateway] suspicious authentication burst from 192.168.1.104',
      '[ERROR] [auth] unauthorized access attempt blocked by edge firewall',
    ];
  }

  if (anomaly === 'app_crash') {
    return [
      '[ERROR] [main] NullPointerException in UserService.getUser()',
      '[ERROR] [runtime] application crashed during bootstrap phase',
      '[WARN] [recovery] restart policy triggered after service exit event',
    ];
  }

  return [
    '[INFO] [heartbeat] probe completed successfully',
    '[INFO] [scheduler] health check passed for web-api',
    '[INFO] [service] traffic pattern within expected threshold',
  ];
}

// Poll real server statistics via SSH
async function pollRealServer(server: Server) {
  const timestamp = new Date().toISOString();
  try {
    let cpu = 10.0;
    let ram = 25.0;
    let disk = 45.0;

    if (server.isMock) {
      const mockStats = getMockSystemMetrics();
      cpu = mockStats.cpu;
      ram = mockStats.ram;
      disk = mockStats.disk;
    } else {
      // Gather system stats via lightweight shell commands
      const rawCpu = await executeSSHCommand(server, "top -b -n 1 | grep 'Cpu(s)' | awk '{print $2 + $4}'");
      const rawMem = await executeSSHCommand(server, "free | grep Mem | awk '{print $3/$2 * 100.0}'");
      const rawDisk = await executeSSHCommand(server, "df / | tail -1 | awk '{print $5}' | sed 's/%//' ");

      cpu = parseFloat(rawCpu.trim()) || 10.0;
      ram = parseFloat(rawMem.trim()) || 25.0;
      disk = parseFloat(rawDisk.trim()) || 45.0;
    }

    // Check last logs
    let rawLogs = '';
    if (server.isMock) {
      rawLogs = buildMockLogLines().join('\n');
    } else {
      const syslog = await executeSSHCommand(server, "journalctl -n 5 --no-pager -p 4 --output=short");
      if (syslog && !syslog.startsWith('Command execution failed') && !syslog.startsWith('SSH connection failed')) {
        rawLogs += syslog + '\n';
      }
      const simulatorLog = await executeSSHCommand(server, "tail -n 10 /var/log/simulator.log 2>/dev/null");
      if (simulatorLog && !simulatorLog.startsWith('Command execution failed') && !simulatorLog.startsWith('SSH connection failed') && simulatorLog.trim() !== '') {
        rawLogs += simulatorLog + '\n';
      }
    }

    const injectedLogs: Omit<LogEntry, 'id'>[] = [];

    if (rawLogs.trim() !== '') {
      const lines = rawLogs.split('\n').filter(Boolean);
      const recentLogs = db.getLogs(server.id, 30);
      const recentMessages = new Set(recentLogs.map(l => l.message));
      
      for (const line of lines) {
        // Ignore the "STDERR:" prefix we add ourselves, and empty journalctl lines
        if (line.includes('STDERR:') || line.includes('No journal files were found') || line.includes('-- No entries --')) continue;

        // Use the persistent DB to verify we haven't processed this log line recently
        // This solves the Next.js hot-reloading module state reset issue
        if (recentMessages.has(line)) continue;
        
        const lowerLine = line.toLowerCase();
        
        // Skip simulator internal debug INFO logs that happen to contain the word "error" (e.g., triggering db_error)
        if (lowerLine.includes('[info]') || lowerLine.includes('received request to trigger anomaly')) {
          continue;
        }

        const isError = lowerLine.includes('err') || lowerLine.includes('fail') || lowerLine.includes('fatal') || lowerLine.includes('exception');
        injectedLogs.push({
          serverId: server.id,
          timestamp,
          level: isError ? 'ERROR' : 'WARN',
          source: 'ssh-monitor',
          message: line
        });
        db.addLog({
          serverId: server.id,
          timestamp,
          level: isError ? 'ERROR' : 'WARN',
          source: 'ssh-monitor',
          message: line
        });
      }
    }

    db.addMetric({ serverId: server.id, timestamp, cpu, ram, disk });
    db.updateServer(server.id, { status: 'online', lastChecked: timestamp });

    await evaluateIncidentTriggers(server, cpu, ram, disk, injectedLogs);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Polling failed';
    db.updateServer(server.id, { status: 'error', errorMessage: message, lastChecked: timestamp });
  }
}

// Generate realistic simulated command outputs for our mock environment
function getSimulatedCommandOutput(command: string, server: Server): string {
  const time = new Date().toLocaleTimeString();
  const activeAnomaly = mockAnomalyType ?? null;
  const mockStats = getMockSystemMetrics();

  if (command === 'uptime') {
    const load = activeAnomaly === 'cpu' ? '6.84, 4.22, 2.15' : activeAnomaly === 'ram' ? '1.31, 1.40, 1.82' : activeAnomaly === 'disk' ? '0.92, 1.08, 1.37' : '0.12, 0.25, 0.18';
    return ` ${time} up 12 days,  3:14,  1 user,  load average: ${load}`;
  }

  if (command === 'free -h') {
    const usedGiB = Math.max(1, mockStats.ram * 0.08);
    const freeGiB = Math.max(0.2, 7.7 - usedGiB);
    if (activeAnomaly === 'ram') {
      return `               total        used        free      shared  buff/cache   available\nMem:           7.7Gi       ${usedGiB.toFixed(1)}Gi       ${freeGiB.toFixed(1)}Gi       122Mi       184Mi        92Mi\nSwap:          2.0Gi       1.8Gi       200Mi`;
    }
    return `               total        used        free      shared  buff/cache   available\nMem:           7.7Gi       ${usedGiB.toFixed(1)}Gi       ${freeGiB.toFixed(1)}Gi       122Mi       1.8Gi       4.2Gi\nSwap:          2.0Gi          0B       2.0Gi`;
  }

  if (command === 'df -h') {
    const usedPct = Math.max(45, Math.min(99, Math.round(mockStats.disk)));
    const usedGiB = Math.max(20, Math.round((usedPct / 100) * 39));
    const freeGiB = Math.max(1, 39 - usedGiB);
    return `Filesystem      Size  Used Avail Use% Mounted on\n/dev/root        39G   ${usedGiB}G  ${freeGiB}G  ${usedPct}% /\ntmpfs           3.9G     0  3.9G   0% /dev/shm\n/dev/sda15      124M   11M  114M   9% /boot/efi`;
  }

  if (command.startsWith('top')) {
    const cpuValue = Math.max(8, Math.min(99, Math.round(mockStats.cpu)));
    return `%Cpu(s): ${cpuValue.toFixed(1)} us, 2.8 sy, 0.0 ni, 72.1 id, 0.0 wa, 0.0 hi, 0.0 si, 0.0 st`;
  }

  if (command.startsWith('ps')) {
    if (activeAnomaly === 'cpu') {
      return `%CPU %MEM   PID CMD\n94.2  1.4  4819 node /var/www/app/server.js -worker\n 1.2  8.4  1248 postgres: writer process\n 0.8  0.4  1922 nginx: worker process\n 0.0  0.1     1 /sbin/init`;
    }
    if (activeAnomaly === 'ram') {
      return `%CPU %MEM   PID CMD\n 2.4 86.2  4819 node --max-old-space-size=4096 /var/www/app/server.js\n 0.5  4.1  1248 postgres: writer process\n 0.1  0.5  1922 nginx: worker process\n 0.0  0.1     1 /sbin/init`;
    }
    return `%CPU %MEM   PID CMD\n 1.4  4.2  4819 node /var/www/app/server.js\n 0.5  4.1  1248 postgres: writer process\n 0.1  0.5  1922 nginx: worker process`;
  }

  if (command.startsWith('dmesg')) {
    if (activeAnomaly === 'ram') {
      return `[1048201.2184] oom-kill:constraint=CONSTRAINT_NONE,nodemask=(null),cpuset=/,mems_allowed=0,global_oom,task_memcg=/system.slice/web.service,task=node,pid=4819,uid=1000\n[1048201.2291] Out of memory: Killed process 4819 (node) total-vm:4910242kB, anon-rss:3214812kB, file-rss:0kB, shmem-rss:0kB, UID=1000 pgtables:8204kB oom_score_adj=0`;
    }
    if (activeAnomaly === 'disk') {
      return `[84920.1284] ext4_lookup: deleted inode referenced: 104859\n[84922.8491] EXT4-fs warning (device sda1): ext4_dx_add_entry: Directory index full!`;
    }
    return `[    0.0000] Booting Linux... \n[    2.1284] EXT4-fs (sda1): mounted filesystem with ordered data mode. Opts: (null).\n[    4.9124] systemd[1]: Started Journal Service.`;
  }

  if (command.startsWith('ss')) {
    if (activeAnomaly === 'log_error') {
      return `Netid State  Recv-Q Send-Q  Local Address:Port   Peer Address:Port\ntcp   ESTAB  0      0       127.0.0.1:5432       127.0.0.1:48210 (postgres: connection limit active)\ntcp   ESTAB  4096   0       10.0.1.45:80         192.168.1.12:51280 (nginx worker queue full)\ntcp   ESTAB  4096   0       10.0.1.45:80         192.168.1.14:51282 (nginx worker queue full)`;
    }
    return `Netid State  Recv-Q Send-Q  Local Address:Port   Peer Address:Port\ntcp   LISTEN 0      4096         *:80                  *:*\ntcp   LISTEN 0      1024         *:22                  *:*\ntcp   LISTEN 0      512    127.0.0.1:5432              *:*`;
  }

  return `Command executed on ${server.name}`;
}
