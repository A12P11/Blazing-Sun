import fs from 'fs';
import path from 'path';

export interface Server {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'key';
  password?: string;
  privateKey?: string;
  isMock: boolean;
  status: 'online' | 'offline' | 'error';
  lastChecked?: string;
  errorMessage?: string;
}

export interface MetricEntry {
  serverId: string;
  timestamp: string;
  cpu: number; // percentage
  ram: number; // percentage
  disk: number; // percentage
}

export interface LogEntry {
  id: string;
  serverId: string;
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  source: string;
  message: string;
}

export interface RcaReport {
  summary: string;
  rootCause: string;
  impact: string;
  technicalAnalysis: string;
  remediationSteps: string[];
  aiModel: string;
  generatedAt: string;
}

export interface DiagnosticCommand {
  command: string;
  output: string;
  timestamp: string;
}

export interface Incident {
  id: string;
  serverId: string;
  status: 'ACTIVE' | 'RESOLVED';
  severity: 'WARNING' | 'CRITICAL';
  title: string;
  description: string;
  triggeredBy: string; // e.g. "Metric Threshold: CPU > 85%" or "Log Error: OOM"
  createdAt: string;
  resolvedAt?: string;
  logsContext?: LogEntry[];
  metricsContext?: MetricEntry[];
  diagnosticCommandsRun?: DiagnosticCommand[];
  rcaReport?: RcaReport;
}

interface DatabaseSchema {
  servers: Server[];
  metrics: MetricEntry[];
  logs: LogEntry[];
  incidents: Incident[];
}

const DB_FILE_PATH = path.join(process.cwd(), 'db.json');

// Default initial state
const defaultDbState: DatabaseSchema = {
  servers: [
    {
      id: 'mock-web-prod-1',
      name: 'Mock Web Server (Production)',
      host: '10.0.1.45',
      port: 22,
      username: 'ubuntu',
      authType: 'password',
      password: 'password',
      isMock: true,
      status: 'online',
      lastChecked: new Date().toISOString(),
    },
    {
      id: 'mock-db-primary',
      name: 'Mock DB Server (Primary)',
      host: '10.0.2.12',
      port: 22,
      username: 'postgres',
      authType: 'password',
      password: 'password',
      isMock: true,
      status: 'online',
      lastChecked: new Date().toISOString(),
    }
  ],
  metrics: [],
  logs: [],
  incidents: []
};

// Initialize database file if it doesn't exist
function initDb() {
  if (!fs.existsSync(DB_FILE_PATH)) {
    fs.writeFileSync(DB_FILE_PATH, JSON.stringify(defaultDbState, null, 2), 'utf-8');
  }
}

// Read database from file
export function readDb(): DatabaseSchema {
  initDb();
  try {
    const data = fs.readFileSync(DB_FILE_PATH, 'utf-8');
    return JSON.parse(data) as DatabaseSchema;
  } catch (error) {
    console.error('Error reading JSON database, resetting to default state:', error);
    return defaultDbState;
  }
}

// Write database to file
export function writeDb(db: DatabaseSchema): void {
  try {
    fs.writeFileSync(DB_FILE_PATH, JSON.stringify(db, null, 2), 'utf-8');
  } catch (error) {
    console.error('Error writing to JSON database:', error);
  }
}

// Helper CRUD operations
export const db = {
  // Servers
  getServers: () => readDb().servers,
  getServer: (id: string) => readDb().servers.find(s => s.id === id),
  addServer: (server: Omit<Server, 'id'>) => {
    const database = readDb();
    const newServer: Server = {
      ...server,
      id: `server-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      status: 'online',
      lastChecked: new Date().toISOString()
    };
    database.servers.push(newServer);
    writeDb(database);
    return newServer;
  },
  updateServer: (id: string, updates: Partial<Server>) => {
    const database = readDb();
    const serverIndex = database.servers.findIndex(s => s.id === id);
    if (serverIndex !== -1) {
      database.servers[serverIndex] = {
        ...database.servers[serverIndex],
        ...updates
      };
      writeDb(database);
      return database.servers[serverIndex];
    }
    return null;
  },
  deleteServer: (id: string) => {
    const database = readDb();
    database.servers = database.servers.filter(s => s.id !== id);
    database.metrics = database.metrics.filter(m => m.serverId !== id);
    database.logs = database.logs.filter(l => l.serverId !== id);
    database.incidents = database.incidents.filter(i => i.serverId !== id);
    writeDb(database);
  },

  // Metrics
  getMetrics: (serverId?: string, limit = 50) => {
    const metrics = readDb().metrics;
    if (serverId) {
      return metrics
        .filter(m => m.serverId === serverId)
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
        .slice(-limit);
    }
    return metrics;
  },
  addMetric: (entry: MetricEntry) => {
    const database = readDb();
    database.metrics.push(entry);
    // Limit total metric history to last 500 records per server to avoid db.json bloat
    const serverMetrics = database.metrics.filter(m => m.serverId === entry.serverId);
    if (serverMetrics.length > 500) {
      const recordsToRemove = serverMetrics.length - 500;
      let removedCount = 0;
      database.metrics = database.metrics.filter(m => {
        if (m.serverId === entry.serverId && removedCount < recordsToRemove) {
          removedCount++;
          return false;
        }
        return true;
      });
    }
    writeDb(database);
  },

  // Logs
  getLogs: (serverId?: string, limit = 100) => {
    const logs = readDb().logs;
    if (serverId) {
      return logs
        .filter(l => l.serverId === serverId)
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
        .slice(-limit);
    }
    return logs;
  },
  addLog: (entry: Omit<LogEntry, 'id'>) => {
    const database = readDb();
    const newLog: LogEntry = {
      ...entry,
      id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
    };
    database.logs.push(newLog);
    // Keep logs cap to 1000 items
    if (database.logs.length > 1000) {
      database.logs.shift();
    }
    writeDb(database);
    return newLog;
  },

  // Incidents
  getIncidents: (status?: 'ACTIVE' | 'RESOLVED') => {
    const incidents = readDb().incidents;
    if (status) {
      return incidents.filter(i => i.status === status).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
    return incidents.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },
  getIncident: (id: string) => readDb().incidents.find(i => i.id === id),
  addIncident: (incident: Omit<Incident, 'id' | 'status' | 'createdAt'>) => {
    const database = readDb();
    const newIncident: Incident = {
      ...incident,
      id: `incident-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      status: 'ACTIVE',
      createdAt: new Date().toISOString()
    };
    database.incidents.push(newIncident);
    writeDb(database);
    return newIncident;
  },
  updateIncident: (id: string, updates: Partial<Incident>) => {
    const database = readDb();
    const index = database.incidents.findIndex(i => i.id === id);
    if (index !== -1) {
      database.incidents[index] = {
        ...database.incidents[index],
        ...updates
      };
      writeDb(database);
      return database.incidents[index];
    }
    return null;
  },
  resolveIncident: (id: string, rcaReport?: RcaReport) => {
    const database = readDb();
    const index = database.incidents.findIndex(i => i.id === id);
    if (index !== -1) {
      database.incidents[index] = {
        ...database.incidents[index],
        status: 'RESOLVED',
        resolvedAt: new Date().toISOString(),
        ...(rcaReport ? { rcaReport } : {})
      };
      writeDb(database);
      return database.incidents[index];
    }
    return null;
  }
};
