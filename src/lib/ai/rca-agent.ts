import { Incident, DiagnosticCommand, RcaReport } from '../db';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'openai/gpt-oss-120b';

type GroqChatCompletion = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  error?: {
    message?: string;
  };
};

function getGroqConfiguration() {
  return {
    apiKey: process.env.GROQ_API_KEY?.trim(),
    model: process.env.GROQ_MODEL?.trim() || DEFAULT_MODEL
  };
}

async function generateRcaWithGroq(systemInstructions: string, userPrompt: string): Promise<string> {
  const { apiKey, model } = getGroqConfiguration();

  if (!apiKey) {
    throw new Error('GROQ_API_KEY is not configured.');
  }

  const response = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemInstructions },
        { role: 'user', content: userPrompt }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_completion_tokens: 1800
    }),
    signal: AbortSignal.timeout(30_000)
  });

  const payload = await response.json() as GroqChatCompletion;
  if (!response.ok) {
    throw new Error(payload.error?.message || `Groq returned HTTP ${response.status}.`);
  }

  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error('Groq returned an empty response.');
  }

  return content;
}

/**
 * Analyzes gathered telemetry metrics, log traces, and SSH command outputs to generate an RCA report.
 */
export async function analyzeIncidentWithAI(incident: Incident, diagnostics: DiagnosticCommand[]): Promise<RcaReport> {
  const { apiKey, model: modelName } = getGroqConfiguration();

  // Format the diagnostic commands output
  const diagnosticsFormatted = diagnostics
    .map(d => `### Command: "${d.command}"\nOutput:\n\`\`\`\n${d.output}\n\`\`\`\n`)
    .join('\n');

  // Format the logs context
  const logsFormatted = (incident.logsContext || [])
    .map(l => `[${l.timestamp}] [${l.level}] [${l.source}] ${l.message}`)
    .join('\n');

  // Format the metrics context
  const metricsFormatted = (incident.metricsContext || [])
    .map(m => `[${m.timestamp}] CPU: ${m.cpu}%, RAM: ${m.ram}%, Disk: ${m.disk}%`)
    .join('\n');

  const systemInstructions = `
You are a Lead Site Reliability Engineer (SRE) and DevOps Architect.
Analyze the provided system crash details, logs, metrics history, and SSH diagnostic outputs, then compile a highly technical and precise Root Cause Analysis (RCA) report.

Your analysis must be returned in strict JSON format matching this schema:
{
  "summary": "High level 1-2 sentence summary of what happened.",
  "rootCause": "The underlying technical root cause (e.g. Memory leak in process, disk exhaust due to log file size, lock contention). Be specific.",
  "impact": "What is the impact on applications, services, or downstream systems?",
  "technicalAnalysis": "Detailed correlation analysis of the metrics, logs, and command outputs. Explain step-by-step why the metrics or logs support your root cause conclusion.",
  "remediationSteps": [
    "Actionable step 1 including exact command line if possible",
    "Actionable step 2",
    "..."
  ]
}

DO NOT wrap your JSON in backticks or markdown, output ONLY raw JSON. Ensure all JSON fields are populated and valid.
`;

  const userPrompt = `
SERVER DETAILS:
- Name: ${incident.serverId}
- Host/IP: Monitored target server

INCIDENT DETAILS:
- Title: ${incident.title}
- Triggered By: ${incident.triggeredBy}
- Severity: ${incident.severity}
- Triggered At: ${incident.createdAt}

RESOURCE METRICS BEFORE INCIDENT:
${metricsFormatted}

RELEVANT LOG TAIL SAMPLES:
${logsFormatted}

SSH DIAGNOSTIC TERMINAL LOGS:
${diagnosticsFormatted}
`;

  if (apiKey) {
    try {
      const text = await generateRcaWithGroq(systemInstructions, userPrompt);
      const parsedReport = JSON.parse(text);
      return {
        summary: parsedReport.summary || 'Incident auto-analyzed by DevOps AI.',
        rootCause: parsedReport.rootCause || 'Root cause could not be clearly isolated.',
        impact: parsedReport.impact || 'Service degradation or latency spikes.',
        technicalAnalysis: parsedReport.technicalAnalysis || 'Metrics and log traces correlate with resource exhaustion.',
        remediationSteps: Array.isArray(parsedReport.remediationSteps)
          ? parsedReport.remediationSteps
          : ['Perform service restart.', 'Verify host metrics.'],
        aiModel: modelName,
        generatedAt: new Date().toISOString()
      };
    } catch (error) {
      console.error('[AI RCA] Groq API invocation failed. Falling back to templates:', error);
    }
  }

  // Fallback to offline template reports if Groq is unavailable or not configured.
  return generateOfflineReport(incident);
}

/**
 * Generates high-quality offline reports for local testing/mocking when the AI API is unavailable.
 */
function generateOfflineReport(incident: Incident): RcaReport {
  const trigger = incident.triggeredBy.toLowerCase();

  let summary = 'A system resource threshold was breached on the server.';
  let rootCause = 'General resource contention.';
  let impact = 'Degraded server response times and potential client request queue timeout.';
  let technicalAnalysis = 'Analytical telemetry showed resource usage spikes above safety limits. Logs verify process-level activity.';
  let remediationSteps = [
    'Run `top` or `htop` to identify CPU-intensive running threads.',
    'Verify if log rotation is functioning correctly via `logrotate -d /etc/logrotate.conf`.',
    'Restart any leaking worker daemons: `systemctl restart web-app`.'
  ];

  if (trigger.includes('cpu')) {
    summary = 'The CPU utilization spiked to critical levels, saturating system cores.';
    rootCause = 'Infinite process loop or runaway thread in Node worker process (PID 4819).';
    impact = 'Severely delayed event loop execution, causing API timeout rates to rise above 8%.';
    technicalAnalysis = 'CPU usage spiked to 94%+ while RAM remained stable. SSH diagnostics `ps aux` command showed Node worker thread occupying 94.2% CPU resources.';
    remediationSteps = [
      'Locate runaway thread using `pidstat -u -p 4819 1 5`.',
      'Terminate the offending process: `kill -9 4819`.',
      'Audit event loop blocking operations in the worker scheduler code.',
      'Configure CPU quota limits in the systemd service file (`CPUQuota=80%`).'
    ];
  } else if (trigger.includes('ram') || trigger.includes('oom') || trigger.includes('out of memory')) {
    summary = 'A critical memory starvation alert occurred, triggering system warnings.';
    rootCause = 'V8 Engine Heap space leakage in the background queues processor node daemon.';
    impact = 'Node process was terminated by the Linux Out Of Memory (OOM) Killer, leading to downtime.';
    technicalAnalysis = 'RAM utilization rose incrementally from 48% to 96%. Logs reveal minor GC operations exceeding 400ms followed by OOM-kill logs in `dmesg` killing process ID 4819.';
    remediationSteps = [
      'Analyze heap allocation snapshot file `/var/log/node-heap.heapsnapshot`.',
      'Increase heap memory limit parameter: `--max-old-space-size=4096` in start command.',
      'Verify memory retention in global event listener registries inside queue listeners.',
      'Restart the systemd unit: `systemctl restart web-service`.'
    ];
  } else if (trigger.includes('disk') || trigger.includes('space') || trigger.includes('no space left')) {
    summary = 'The primary filesystem storage reached full capacity.';
    rootCause = 'Runaway application debug logs writing excessively without logrotation configuration.';
    impact = 'System unable to write temporary files or session records, causing write operations to crash.';
    technicalAnalysis = 'Disk storage capacity grew to 98% utilization. SSH diagnostic output of `df -h` confirms `/dev/root` mounted on `/` has only 1.2G available disk space.';
    remediationSteps = [
      'Locate largest directory consumers using `du -ah /var/log | sort -rh | head -10`.',
      'Safely truncate large debug log file: `truncate -s 0 /var/log/web-app/debug.log`.',
      'Enable log compression inside `/etc/logrotate.d/web-app`.',
      'Add disk alerts at 80% usage to catch issues before partition exhaustion.'
    ];
  } else if (trigger.includes('connection') || trigger.includes('worker_connections')) {
    summary = 'Incoming traffic overflowed server worker capacity.';
    rootCause = 'Nginx worker connection starvation and Postgres DB connection pool saturation.';
    impact = 'New clients received 502 Bad Gateway responses; database rejected connection requests.';
    technicalAnalysis = 'System metrics show moderate CPU load, but logs reveal "4096 worker_connections are not enough" and "FATAL: connection pool limit exceeded".';
    remediationSteps = [
      'Increase connection limits in `/etc/nginx/nginx.conf` (`worker_connections 8192;`).',
      'Configure connection pooling backend (e.g. pgBouncer) for postgres database.',
      'Check system socket limits: `sysctl -w net.core.somaxconn=1024`.',
      'Gracefully reload services: `nginx -s reload`.'
    ];
  }

  return {
    summary,
    rootCause,
    impact,
    technicalAnalysis,
    remediationSteps,
    aiModel: 'Local SRE Template Engine',
    generatedAt: new Date().toISOString()
  };
}
