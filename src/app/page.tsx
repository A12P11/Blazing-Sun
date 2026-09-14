'use client';

import React, { useEffect, useState, useRef } from 'react';
import { 
  Server, 
  Incident, 
  MetricEntry, 
  LogEntry 
} from '@/lib/db';
import { 
  Activity, 
  Plus, 
  Trash2, 
  AlertTriangle, 
  CheckCircle, 
  Cpu, 
  Database, 
  HardDrive, 
  Terminal, 
  Zap, 
  Play, 
  RefreshCw, 
  X, 
  Server as ServerIcon, 
  ShieldAlert,
  CornerDownRight,
  Sparkles,
  Link2
} from 'lucide-react';

export default function Dashboard() {
  const [servers, setServers] = useState<Server[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [metrics, setMetrics] = useState<Record<string, MetricEntry[]>>({});
  const [logs, setLogs] = useState<Record<string, LogEntry[]>>({});
  
  const [selectedServerId, setSelectedServerId] = useState<string>('mock-web-prod-1');
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
  const [serverToDelete, setServerToDelete] = useState<{id: string, name: string} | null>(null);
  
  const [isAddServerOpen, setIsAddServerOpen] = useState(false);
  const [newServer, setNewServer] = useState({
    name: 'Aura Docker Target',
    host: 'localhost',
    port: '2222',
    username: 'root',
    authType: 'password' as 'password' | 'key',
    password: 'password',
    privateKey: '',
    isMock: false
  });

  const [simulatingType, setSimulatingType] = useState<string | null>(null);
  const [sseConnected, setSseConnected] = useState(false);
  const consoleEndRef = useRef<HTMLDivElement>(null);

  // SSE Telemetry Connection
  useEffect(() => {
    let eventSource: EventSource;

    function connectSSE() {
      eventSource = new EventSource('/api/monitoring/stream');
      
      eventSource.onopen = () => {
        setSseConnected(true);
        console.log('SSE monitoring stream connected.');
      };

      eventSource.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          setServers(payload.servers || []);
          setIncidents(payload.incidents || []);
          setMetrics(payload.metrics || {});
          setLogs(payload.logs || {});
        } catch (err) {
          console.error('Error parsing SSE telemetry payload:', err);
        }
      };

      eventSource.onerror = (err) => {
        setSseConnected(false);
        console.error('SSE monitoring connection error:', err);
        eventSource.close();
        // Retry connection in 3 seconds
        setTimeout(connectSSE, 3000);
      };
    }

    connectSSE();

    return () => {
      if (eventSource) {
        eventSource.close();
      }
    };
  }, []);

  // Auto scroll console to bottom on new logs
  useEffect(() => {
    if (consoleEndRef.current) {
      consoleEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [logs, selectedServerId]);

  // Handle add server
  const handleAddServerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newServer)
      });
      if (res.ok) {
        setIsAddServerOpen(false);
        setNewServer({
          name: '',
          host: '',
          port: '22',
          username: '',
          authType: 'password',
          password: '',
          privateKey: '',
          isMock: false
        });
      } else {
        const err = await res.json();
        alert(`Failed to add server: ${err.error}`);
      }
    } catch (error) {
      alert('Error connecting to servers API');
    }
  };

  // Handle delete server
  const confirmDeleteServer = (id: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setServerToDelete({ id, name });
  };

  const handleDeleteServer = async () => {
    if (!serverToDelete) return;
    
    try {
      const res = await fetch(`/api/servers/${serverToDelete.id}`, { method: 'DELETE' });
      if (res.ok) {
        if (selectedServerId === serverToDelete.id) {
          const remaining = servers.filter(s => s.id !== serverToDelete.id);
          if (remaining.length > 0) setSelectedServerId(remaining[0].id);
        }
      }
    } catch (err) {
      console.error(err);
    }
    setServerToDelete(null);
  };

  // Trigger simulated metric/log anomaly
  const handleTriggerAnomaly = async (type: string) => {
    const isContinuous = ['cpu', 'ram', 'disk'].includes(type);
    if (isContinuous) {
      setSimulatingType(type);
    }
    
    try {
      await fetch('/api/incidents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'trigger_anomaly', type })
      });
    } catch (err) {
      console.error(err);
    }
  };

  // Clear simulated anomaly
  const handleClearAnomaly = async () => {
    setSimulatingType(null);
    try {
      await fetch('/api/incidents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'clear_anomaly' })
      });
    } catch (err) {
      console.error(err);
    }
  };

  // Reset database metrics/incidents history
  const handleResetHistory = async () => {
    if (!confirm('Are you sure you want to purge all telemetry and incidents history?')) return;
    setSimulatingType(null);
    setSelectedIncident(null);
    try {
      await fetch('/api/incidents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset_all' })
      });
    } catch (err) {
      console.error(err);
    }
  };

  const selectedServer = servers.find(s => s.id === selectedServerId);
  const serverMetrics = selectedServerId ? metrics[selectedServerId] || [] : [];
  const serverLogs = selectedServerId ? logs[selectedServerId] || [] : [];

  const currentCpu = serverMetrics.length > 0 ? serverMetrics[serverMetrics.length - 1].cpu : 0;
  const currentRam = serverMetrics.length > 0 ? serverMetrics[serverMetrics.length - 1].ram : 0;
  const currentDisk = serverMetrics.length > 0 ? serverMetrics[serverMetrics.length - 1].disk : 0;

  // Determine indicator state
  const getStatusColor = (val: number, warn = 80, crit = 90) => {
    if (val >= crit) return 'var(--color-danger)';
    if (val >= warn) return 'var(--color-warning)';
    return 'var(--color-success)';
  };

  const getMetricFillClass = (val: number, warn = 80, crit = 90) => {
    if (val >= crit) return 'metric-fill-danger';
    if (val >= warn) return 'metric-fill-warning';
    return 'metric-fill-normal';
  };

  // Dependency free SVG Sparkline Renderer
  const renderSparkline = (metricKey: 'cpu' | 'ram' | 'disk', color: string) => {
    if (serverMetrics.length < 2) return null;
    const width = 500;
    const height = 100;
    const padding = 10;
    
    const maxVal = 100;
    const minVal = 0;
    
    const points = serverMetrics.map((m, index) => {
      const x = padding + (index / (serverMetrics.length - 1)) * (width - padding * 2);
      const val = m[metricKey];
      const y = height - padding - ((val - minVal) / (maxVal - minVal)) * (height - padding * 2);
      return `${x},${y}`;
    }).join(' ');

    const fillPoints = `${padding},${height - padding} ${points} ${width - padding},${height - padding}`;

    return (
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-24 overflow-visible">
        <defs>
          <linearGradient id={`grad-${metricKey}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Gridlines */}
        <line x1={padding} y1={height/2} x2={width-padding} y2={height/2} stroke="rgba(255,255,255,0.05)" strokeDasharray="3,3" />
        <line x1={padding} y1={height-padding} x2={width-padding} y2={height-padding} stroke="rgba(255,255,255,0.08)" />
        {/* Shaded Area */}
        <polygon points={fillPoints} fill={`url(#grad-${metricKey})`} />
        {/* Stroke Line */}
        <polyline fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" points={points} />
        {/* Current Indicator Marker */}
        {serverMetrics.length > 0 && (
          <circle 
            cx={padding + (serverMetrics.length - 1) * ((width - padding * 2) / (serverMetrics.length - 1))}
            cy={height - padding - ((serverMetrics[serverMetrics.length - 1][metricKey] - minVal) / (maxVal - minVal)) * (height - padding * 2)}
            r="4" 
            fill={color} 
            stroke="white" 
            strokeWidth="1.5"
          />
        )}
      </svg>
    );
  };

  return (
    <div className="dashboard-container">
      {/* Top Banner Navigation */}
      <header className="main-header" style={{ margin: '-1.5rem -1.5rem 0 -1.5rem', borderBottomLeftRadius: '8px', borderBottomRightRadius: '8px' }}>
        <div className="logo-container">
          <div className="logo-icon">
            <Activity size={20} color="#04080f" />
          </div>
          <div>
            <span className="logo-text">AURA SRE</span>
            <span className="logo-badge" style={{ marginLeft: '8px' }}>ANALYTICS v2</span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem' }}>
            <span className={`active-pulse-dot ${sseConnected ? 'success' : 'danger'}`}></span>
            <span style={{ color: sseConnected ? 'var(--text-secondary)' : 'var(--color-danger)' }}>
              {sseConnected ? 'Real-Time stream connected' : 'Connecting SRE Daemon...'}
            </span>
          </div>

          <button className="btn btn-danger btn-sm" onClick={handleResetHistory}>
            <RefreshCw size={14} /> Purge Metrics
          </button>
        </div>
      </header>

      {/* SRE Stats Bar */}
      <div className="grid-cols-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        <div className="glass-card" style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '1.25rem' }}>
          <div style={{ background: 'rgba(59, 130, 246, 0.15)', padding: '10px', borderRadius: '12px' }}>
            <ServerIcon size={24} color="var(--color-info)" />
          </div>
          <div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', fontWeight: 600, textTransform: 'uppercase' }}>Monitored Nodes</div>
            <div style={{ fontSize: '1.6rem', fontWeight: 800 }}>{servers.length}</div>
          </div>
        </div>

        <div className="glass-card" style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '1.25rem' }}>
          <div style={{ background: 'rgba(239, 68, 68, 0.15)', padding: '10px', borderRadius: '12px' }}>
            <ShieldAlert size={24} color="var(--color-danger)" />
          </div>
          <div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', fontWeight: 600, textTransform: 'uppercase' }}>Active Alerts</div>
            <div style={{ fontSize: '1.6rem', fontWeight: 800, color: incidents.filter(i => i.status === 'ACTIVE').length > 0 ? 'var(--color-danger)' : 'var(--text-primary)' }}>
              {incidents.filter(i => i.status === 'ACTIVE').length}
            </div>
          </div>
        </div>

        <div className="glass-card" style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '1.25rem' }}>
          <div style={{ background: 'rgba(16, 185, 129, 0.15)', padding: '10px', borderRadius: '12px' }}>
            <CheckCircle size={24} color="var(--color-success)" />
          </div>
          <div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', fontWeight: 600, textTransform: 'uppercase' }}>Resolved Incidents</div>
            <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--color-success)' }}>
              {incidents.filter(i => i.status === 'RESOLVED').length}
            </div>
          </div>
        </div>

        <div className="glass-card" style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '1.25rem' }}>
          <div style={{ background: 'rgba(161, 140, 209, 0.15)', padding: '10px', borderRadius: '12px' }}>
            <Sparkles size={24} color="var(--accent-purple)" />
          </div>
          <div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', fontWeight: 600, textTransform: 'uppercase' }}>AI SRE Model</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--accent-purple)', marginTop: '4px' }}>openai/gpt-oss-120b</div>
          </div>
        </div>
      </div>

      {/* Main Grid: Left (Metrics + Console), Right (Targets + Incidents Timeline) */}
      <div className="grid-main">
        
        {/* Left Side: Server Analytics */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {selectedServer ? (
            <div className="glass-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <h1 style={{ fontSize: '1.5rem', fontWeight: 800 }}>{selectedServer.name}</h1>
                    {selectedServer.isMock && <span className="logo-badge">SIMULATED</span>}
                  </div>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '4px' }}>
                    SSH Monitored Target: <code style={{ color: 'var(--accent-cyan)' }}>{selectedServer.username}@{selectedServer.host}:{selectedServer.port}</code>
                  </p>
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <span className={`status-pill status-${selectedServer.status}`}>
                    {selectedServer.status}
                  </span>
                </div>
              </div>

              {/* Resource meters */}
              <div className="grid-cols-3">
                <div className="glass-card" style={{ background: 'rgba(255, 255, 255, 0.02)', padding: '1.25rem' }}>
                  <div className="metric-row">
                    <div className="metric-header">
                      <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Cpu size={16} color="var(--accent-cyan)" /> CPU Load
                      </span>
                      <span className="metric-value" style={{ color: getStatusColor(currentCpu) }}>{currentCpu}%</span>
                    </div>
                    <div className="metric-bar-container">
                      <div 
                        className={`metric-bar-fill ${getMetricFillClass(currentCpu)}`} 
                        style={{ width: `${currentCpu}%` }}
                      ></div>
                    </div>
                  </div>
                  {renderSparkline('cpu', 'var(--accent-cyan)')}
                </div>

                <div className="glass-card" style={{ background: 'rgba(255, 255, 255, 0.02)', padding: '1.25rem' }}>
                  <div className="metric-row">
                    <div className="metric-header">
                      <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Database size={16} color="var(--accent-purple)" /> RAM Usage
                      </span>
                      <span className="metric-value" style={{ color: getStatusColor(currentRam) }}>{currentRam}%</span>
                    </div>
                    <div className="metric-bar-container">
                      <div 
                        className={`metric-bar-fill ${getMetricFillClass(currentRam)}`} 
                        style={{ width: `${currentRam}%` }}
                      ></div>
                    </div>
                  </div>
                  {renderSparkline('ram', 'var(--accent-purple)')}
                </div>

                <div className="glass-card" style={{ background: 'rgba(255, 255, 255, 0.02)', padding: '1.25rem' }}>
                  <div className="metric-row">
                    <div className="metric-header">
                      <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <HardDrive size={16} color="var(--accent-magenta)" /> Disk storage
                      </span>
                      <span className="metric-value" style={{ color: getStatusColor(currentDisk, 85, 95) }}>{currentDisk}%</span>
                    </div>
                    <div className="metric-bar-container">
                      <div 
                        className={`metric-bar-fill ${getMetricFillClass(currentDisk, 85, 95)}`} 
                        style={{ width: `${currentDisk}%` }}
                      ></div>
                    </div>
                  </div>
                  {renderSparkline('disk', 'var(--accent-magenta)')}
                </div>
              </div>
            </div>
          ) : (
            <div className="glass-card" style={{ textAlign: 'center', padding: '3rem' }}>
              <ServerIcon size={40} style={{ opacity: 0.3, marginBottom: '1rem' }} />
              <h3>No Monitored Server Selected</h3>
              <p style={{ color: 'var(--text-secondary)', marginTop: '0.5rem' }}>Register a server or select an existing target from the right sidebar.</p>
            </div>
          )}

          {/* Console Log Stream */}
          <div className="glass-card">
            <h2 className="section-title title-glow">
              <Terminal size={18} /> Live Syslog stream
            </h2>

            <div className="console-container">
              <div className="console-header">
                <div className="console-dots">
                  <span className="console-dot red"></span>
                  <span className="console-dot yellow"></span>
                  <span className="console-dot green"></span>
                </div>
                <div className="console-title">SYSLOG CONSOLE • {selectedServer ? selectedServer.name : 'NO SERVER'}</div>
                <div style={{ width: '30px' }}></div>
              </div>

              <div className="console-body">
                {serverLogs.length === 0 ? (
                  <div style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: '50px' }}>
                    Waiting for log stream data...
                  </div>
                ) : (
                  serverLogs.map((log) => (
                    <div className="console-line" key={log.id}>
                      <span className="console-time">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                      <span className={`console-level level-${log.level}`}>{log.level}</span>
                      <span className="console-source">[{log.source}]</span>
                      <span className="console-message">{log.message}</span>
                    </div>
                  ))
                )}
                <div ref={consoleEndRef} />
              </div>
            </div>
          </div>
        </div>

        {/* Right Side: Targets, Incidents, Simulator controls */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* Targets Panel */}
          <div className="glass-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h2 className="section-title" style={{ margin: 0, border: 'none', padding: 0 }}>
                <ServerIcon size={18} /> Targets Catalog
              </h2>
              <button className="btn btn-primary btn-sm" onClick={() => setIsAddServerOpen(true)}>
                <Plus size={14} /> Add Target
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {servers.map((s) => (
                <div 
                  key={s.id}
                  onClick={() => setSelectedServerId(s.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 14px',
                    background: selectedServerId === s.id ? 'rgba(0, 242, 254, 0.08)' : 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid',
                    borderColor: selectedServerId === s.id ? 'var(--accent-cyan)' : 'var(--border-color)',
                    borderRadius: '10px',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span className={`active-pulse-dot ${s.status === 'online' ? 'success' : 'danger'}`}></span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{s.name}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                        {s.host}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    {s.isMock && <span className="logo-badge" style={{ fontSize: '0.6rem' }}>MOCK</span>}
                    <button 
                      className="btn btn-danger btn-sm"
                      style={{ padding: '4px', borderRadius: '6px' }}
                      onClick={(e) => confirmDeleteServer(s.id, s.name, e)}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Anomaly Simulator Controls */}
          {selectedServer && (
            <div className="glass-card" style={{ border: '1px dashed rgba(161, 140, 209, 0.4)', background: 'rgba(161, 140, 209, 0.02)' }}>
              <h2 className="section-title" style={{ borderBottomColor: 'rgba(161, 140, 209, 0.15)' }}>
                <Zap size={18} color="var(--accent-purple)" /> Python Anomaly Trigger Deck
              </h2>

              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                Trigger actual anomalies in the Python App to test organic SSH diagnostics and AI Root Cause generation.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <button 
                  className={`btn btn-sm ${simulatingType === 'cpu' ? 'btn-purple' : ''}`}
                  onClick={() => handleTriggerAnomaly('cpu')}
                  disabled={!!simulatingType}
                >
                  <Play size={12} /> Resource: High CPU Spike
                </button>
                <button 
                  className={`btn btn-sm ${simulatingType === 'ram' ? 'btn-purple' : ''}`}
                  onClick={() => handleTriggerAnomaly('ram')}
                  disabled={!!simulatingType}
                >
                  <Play size={12} /> Resource: Memory Leak Crash
                </button>
                <button 
                  className={`btn btn-sm ${simulatingType === 'disk' ? 'btn-purple' : ''}`}
                  onClick={() => handleTriggerAnomaly('disk')}
                  disabled={!!simulatingType}
                >
                  <Play size={12} /> Resource: Disk Exhaustion
                </button>
                
                <hr style={{ border: 0, borderTop: '1px solid rgba(255,255,255,0.05)', margin: '4px 0' }} />
                
                <button 
                  className={`btn btn-sm ${simulatingType === 'db_error' ? 'btn-purple' : ''}`}
                  onClick={() => handleTriggerAnomaly('db_error')}
                >
                  <Play size={12} /> Log: DB Connection Limit
                </button>
                <button 
                  className={`btn btn-sm ${simulatingType === 'auth_error' ? 'btn-purple' : ''}`}
                  onClick={() => handleTriggerAnomaly('auth_error')}
                >
                  <Play size={12} /> Log: Auth/Token Failure
                </button>
                <button 
                  className={`btn btn-sm ${simulatingType === 'app_crash' ? 'btn-purple' : ''}`}
                  onClick={() => handleTriggerAnomaly('app_crash')}
                >
                  <Play size={12} /> Log: Java App Crash (NPE)
                </button>

                {simulatingType && (
                  <button 
                    className="btn btn-danger btn-sm" 
                    style={{ marginTop: '6px' }}
                    onClick={handleClearAnomaly}
                  >
                    <X size={12} /> Halt Active Simulation
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Incidents Feed */}
          <div className="glass-card">
            <h2 className="section-title">
              <AlertTriangle size={18} color="var(--color-danger)" /> SRE Alerts History
            </h2>

            {incidents.length === 0 ? (
              <div style={{ padding: '2rem 1rem', textShadow: 'none', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                No incident alerts recorded yet. Everything is healthy.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {incidents.map((incident) => (
                  <div 
                    key={incident.id} 
                    className={`incident-item ${incident.status === 'ACTIVE' ? 'status-active' : 'status-resolved'}`}
                    onClick={() => {
                      if (incident.status === 'RESOLVED') {
                        setSelectedIncident(incident);
                      }
                    }}
                    style={{
                      cursor: incident.status === 'RESOLVED' ? 'pointer' : 'default',
                      background: selectedIncident?.id === incident.id ? 'rgba(255, 255, 255, 0.03)' : 'transparent',
                      padding: selectedIncident?.id === incident.id ? '8px 12px 8px 1.25rem' : '0px 0px 0px 1.25rem',
                      borderRadius: selectedIncident?.id === incident.id ? '8px' : '0px',
                      transition: 'background 0.2s'
                    }}
                  >
                    <div className="incident-time">{new Date(incident.createdAt).toLocaleTimeString()}</div>
                    <div className="incident-title" style={{ fontSize: '0.9rem', color: incident.status === 'ACTIVE' ? 'var(--color-danger)' : 'var(--text-primary)' }}>
                      {incident.title}
                    </div>
                    <div className="incident-meta">
                      <span>[{incident.severity}]</span>
                      <span>•</span>
                      <span style={{ textTransform: 'lowercase', color: incident.status === 'ACTIVE' ? 'var(--color-warning)' : 'var(--color-success)' }}>
                        {incident.status === 'ACTIVE' ? 'Investigating (SSH)...' : 'AI Resolved ✓'}
                      </span>
                    </div>

                    {incident.status === 'RESOLVED' && selectedIncident?.id !== incident.id && (
                      <span style={{ fontSize: '0.75rem', color: 'var(--accent-purple)', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                        <Sparkles size={11} /> View AI RCA
                      </span>
                    )}

                    {incident.status === 'ACTIVE' && (
                      <div className="incident-diag-runs">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--accent-cyan)' }}>
                          <span className="active-pulse-dot danger"></span> SSH Diagnostic Commands executing...
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          
        </div>
      </div>

      {/* AI RCA Report Modal Panel */}
      {selectedIncident && selectedIncident.rcaReport && (
        <div className="modal-overlay" onClick={() => setSelectedIncident(null)}>
          <div className="modal-content" style={{ maxWidth: '850px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Sparkles size={18} color="var(--accent-purple)" />
                <h3 style={{ fontSize: '1.2rem', fontWeight: 800 }}>AI Root Cause Investigation</h3>
                <span className="rca-badge">RCA INC-{selectedIncident.id.substring(9, 13)}</span>
              </div>
              <button 
                onClick={() => setSelectedIncident(null)} 
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto', display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '1.5rem' }}>
              {/* SRE AI Summary details */}
              <div>
                <h2 className="rca-title-glow" style={{ fontSize: '1.3rem', marginBottom: '8px' }}>
                  {selectedIncident.title}
                </h2>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                  Triggered by: <code style={{ color: 'var(--color-danger)' }}>{selectedIncident.triggeredBy}</code>
                </p>

                <div className="rca-section-label">Incident Summary</div>
                <p style={{ fontSize: '0.9rem', lineHeight: '1.45', color: '#e2e8f0' }}>
                  {selectedIncident.rcaReport.summary}
                </p>

                <div className="rca-section-label" style={{ color: 'var(--color-danger)' }}>Technical Root Cause</div>
                <p style={{ fontSize: '0.9rem', lineHeight: '1.45', color: '#fca5a5', fontWeight: 500 }}>
                  {selectedIncident.rcaReport.rootCause}
                </p>

                <div className="rca-section-label">Impact Assessment</div>
                <p style={{ fontSize: '0.9rem', lineHeight: '1.45', color: '#e2e8f0' }}>
                  {selectedIncident.rcaReport.impact}
                </p>

                <div className="rca-section-label">Correlated SRE Analysis</div>
                <p style={{ fontSize: '0.85rem', lineHeight: '1.45', color: 'var(--text-secondary)', whiteSpace: 'pre-line' }}>
                  {selectedIncident.rcaReport.technicalAnalysis}
                </p>
              </div>

              {/* Diagnostics & Remediation checklists */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {/* Remediation Checklists */}
                <div className="glass-card" style={{ background: 'rgba(16, 185, 129, 0.03)', borderColor: 'rgba(16, 185, 129, 0.15)', padding: '1rem' }}>
                  <h4 style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--color-success)', fontSize: '0.9rem', fontWeight: 800 }}>
                    <CheckCircle size={15} /> Actionable Remediation steps
                  </h4>
                  <div style={{ marginTop: '0.5rem' }}>
                    {selectedIncident.rcaReport.remediationSteps.map((step, idx) => (
                      <div className="rca-remediation-step" key={idx}>
                        <span className="rca-step-num">{idx + 1}.</span>
                        <span className="rca-step-text" dangerouslySetInnerHTML={{ 
                          __html: step.replace(/`([^`]+)`/g, '<code>$1</code>') 
                        }}></span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* SSH Command Execution details */}
                <div>
                  <h4 style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
                    <Terminal size={14} color="var(--accent-cyan)" /> Automated Diagnostic Terminal Runs
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '250px', overflowY: 'auto' }}>
                    {(selectedIncident.diagnosticCommandsRun || []).map((run, i) => (
                      <details 
                        key={i} 
                        style={{ 
                          background: 'rgba(0,0,0,0.3)', 
                          border: '1px solid rgba(255,255,255,0.03)', 
                          borderRadius: '6px',
                          fontSize: '0.75rem',
                          padding: '6px'
                        }}
                      >
                        <summary style={{ cursor: 'pointer', color: 'var(--text-secondary)', fontWeight: 600 }}>
                          $ {run.command}
                        </summary>
                        <pre style={{ 
                          marginTop: '6px', 
                          padding: '6px', 
                          background: '#02050a', 
                          color: '#34d399', 
                          borderRadius: '4px', 
                          fontFamily: 'var(--font-mono)',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-all'
                        }}>{run.output}</pre>
                      </details>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="modal-footer" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                Generated using {selectedIncident.rcaReport.aiModel} at {new Date(selectedIncident.rcaReport.generatedAt).toLocaleTimeString()}
              </span>
              <button className="btn btn-primary btn-sm" onClick={() => setSelectedIncident(null)}>
                Dismiss Incident
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Server Modal Dialog */}
      {isAddServerOpen && (
        <div className="modal-overlay" onClick={() => setIsAddServerOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ fontWeight: 800 }}>Add Target Server Monitor</h3>
              <button 
                onClick={() => setIsAddServerOpen(false)} 
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleAddServerSubmit}>
              <div className="modal-body">
                <div className="form-group">
                  <label>Server Identifier / Name</label>
                  <input 
                    type="text" 
                    className="form-control" 
                    placeholder="e.g. Production Web Instance"
                    value={newServer.name}
                    onChange={e => setNewServer({...newServer, name: e.target.value})}
                    required
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>IP Address / Host</label>
                    <input 
                      type="text" 
                      className="form-control" 
                      placeholder="e.g. 192.168.1.100"
                      value={newServer.host}
                      onChange={e => setNewServer({...newServer, host: e.target.value})}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>SSH Port</label>
                    <input 
                      type="number" 
                      className="form-control" 
                      value={newServer.port}
                      onChange={e => setNewServer({...newServer, port: e.target.value})}
                      required
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label>SSH Username</label>
                  <input 
                    type="text" 
                    className="form-control" 
                    placeholder="e.g. ubuntu"
                    value={newServer.username}
                    onChange={e => setNewServer({...newServer, username: e.target.value})}
                    required
                  />
                </div>

                <div className="form-group" style={{ display: 'flex', gap: '1.5rem', margin: '15px 0' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                    <input 
                      type="radio" 
                      name="authType" 
                      checked={newServer.authType === 'password'}
                      onChange={() => setNewServer({...newServer, authType: 'password'})} 
                    />
                    SSH Password
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                    <input 
                      type="radio" 
                      name="authType" 
                      checked={newServer.authType === 'key'}
                      onChange={() => setNewServer({...newServer, authType: 'key'})} 
                    />
                    SSH Private Key
                  </label>
                </div>

                {newServer.authType === 'password' ? (
                  <div className="form-group">
                    <label>SSH Password</label>
                    <input 
                      type="password" 
                      className="form-control" 
                      placeholder="••••••••"
                      value={newServer.password}
                      onChange={e => setNewServer({...newServer, password: e.target.value})}
                      required={!newServer.isMock}
                    />
                  </div>
                ) : (
                  <div className="form-group">
                    <label>SSH Private Key</label>
                    <textarea 
                      className="form-control" 
                      rows={4}
                      style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}
                      placeholder="-----BEGIN OPENSSH PRIVATE KEY-----..."
                      value={newServer.privateKey}
                      onChange={e => setNewServer({...newServer, privateKey: e.target.value})}
                      required={!newServer.isMock}
                    />
                  </div>
                )}

                <div className="form-group" style={{ marginTop: '1.25rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 700, color: 'var(--accent-purple)' }}>
                    <input 
                      type="checkbox" 
                      checked={newServer.isMock}
                      onChange={e => setNewServer({...newServer, isMock: e.target.checked})}
                    />
                    Enable Simulated Target (Local testing without SSH)
                  </label>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px', marginLeft: '22px' }}>
                    Simulated servers collect realistic synthetic metrics and support targeted fault injections from the control deck.
                  </p>
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn" onClick={() => setIsAddServerOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Begin Monitoring
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Delete Server Modal */}
      {serverToDelete && (
        <div className="modal-overlay" onClick={() => setServerToDelete(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '400px' }}>
            <div className="modal-header">
              <h3 style={{ fontWeight: 800 }}>Confirm Deletion</h3>
              <button 
                onClick={() => setServerToDelete(null)} 
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>
            <div className="modal-body" style={{ padding: '20px' }}>
              <p>Are you sure you want to stop monitoring <strong style={{ color: 'var(--accent-cyan)' }}>{serverToDelete.name}</strong>?</p>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '10px' }}>
                This will permanently delete the target and halt all telemetry collection.
              </p>
            </div>
            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setServerToDelete(null)}>
                Cancel
              </button>
              <button className="btn btn-danger btn-sm" onClick={handleDeleteServer}>
                Delete Target
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
