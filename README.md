# Aura SRE

Aura SRE is a Next.js monitoring dashboard with a Python simulator for resource anomalies, logs, incidents, and RCA diagnostics.

## Requirements

- Node.js 20 or newer
- npm
- Python 3.10 or newer
- Docker Desktop, only if you want the SSH target-server container

## Install

From the project root:

```powershell
npm install
```

The Python simulator creates `.venv` and installs `simulator/requirements.txt` automatically when it is first needed. To install it manually:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r simulator\requirements.txt
```

## Run the dashboard

Start the Next.js application:

```powershell
npm run dev -- --hostname 127.0.0.1 --port 3000
```

Open <http://127.0.0.1:3000>.

The dashboard starts the Python simulator automatically when an anomaly trigger requires it. The simulator listens on port `5050`.

Check the simulator manually:

```powershell
Invoke-WebRequest http://127.0.0.1:5050/
```

## Optional Docker target server

The Docker target exposes SSH on port `2222` and the simulator API on port `5050`:

```powershell
cd simulator
docker compose up --build -d
cd ..
```

Stop only the Docker target server with:

```powershell
cd simulator
docker compose down
cd ..
```

## Useful commands

```powershell
npm run build   # production build check
npm run start   # serve the production build
npm run lint    # run ESLint
```

## Safe shutdown

1. In the terminal running `npm run dev`, press `Ctrl+C` once and wait for the prompt to return.
2. If the Python simulator was started separately in a terminal, press `Ctrl+C` in that terminal as well.
3. If Docker was used, run `docker compose down` from the `simulator` directory.
4. Do not use a broad `taskkill /F /IM node.exe` command because it can close unrelated Node.js applications.

If the dashboard was started in the background and the original terminal is unavailable, identify the process that owns port `3000` before stopping it:

```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen | Select-Object OwningProcess
Stop-Process -Id <PID>
```

To stop the simulator process, identify the process that owns port `5050` first:

```powershell
Get-NetTCPConnection -LocalPort 5050 -State Listen | Select-Object OwningProcess
Stop-Process -Id <PID>
```

## Data

Runtime server, metric, log, and incident data is stored in `db.json`. The application keeps the remaining mock database server available and removes the retired production mock automatically if an older database still contains it.
