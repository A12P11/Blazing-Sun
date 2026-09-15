import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SIMULATOR_URL = 'http://127.0.0.1:5050';

function getPythonExecutable(): string {
  const venvPython = path.join(
    process.cwd(),
    '.venv',
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'
  );

  if (fs.existsSync(venvPython)) {
    return venvPython;
  }

  return process.platform === 'win32' ? 'python.exe' : 'python3';
}

export async function ensureSimulatorRunning(): Promise<boolean> {
  try {
    const response = await fetch(`${SIMULATOR_URL}/`, { signal: AbortSignal.timeout(1500) });
    if (response.ok) return true;
  } catch {
    // Simulator not reachable yet; attempt to start it.
  }

  const simulatorScript = path.join(process.cwd(), 'simulator', 'app.py');
  const pythonExecutable = getPythonExecutable();

  if (!fs.existsSync(simulatorScript)) {
    return false;
  }

  const child = spawn(pythonExecutable, [simulatorScript], {
    cwd: process.cwd(),
    stdio: 'ignore',
    detached: true,
    windowsHide: true,
  });

  child.unref();

  for (let attempt = 0; attempt < 25; attempt += 1) {
    try {
      const response = await fetch(`${SIMULATOR_URL}/`, { signal: AbortSignal.timeout(1200) });
      if (response.ok) return true;
    } catch {
      // retry until the simulator is ready
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  return false;
}
