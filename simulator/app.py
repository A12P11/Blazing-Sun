import time
import logging
import threading
import multiprocessing
import os
import sys
import socket
import subprocess
import urllib.request
from pathlib import Path

SIMULATOR_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SIMULATOR_DIR.parent
LOG_FILE = SIMULATOR_DIR / 'simulator.log'


def bootstrap_simulator_environment():
    try:
        from flask import Flask, request, jsonify
        return Flask, request, jsonify
    except ModuleNotFoundError:
        venv_dir = PROJECT_ROOT / '.venv'
        venv_python = venv_dir / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
        requirements_file = SIMULATOR_DIR / 'requirements.txt'

        if not venv_python.exists():
            subprocess.check_call([sys.executable, '-m', 'venv', str(venv_dir)])

        subprocess.check_call([str(venv_python), '-m', 'pip', 'install', '-r', str(requirements_file)])
        os.execv(str(venv_python), [str(venv_python), str(Path(__file__).resolve())])


Flask, request, jsonify = bootstrap_simulator_environment()


def configure_logging():
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger('simulator')
    logger.setLevel(logging.INFO)
    logger.handlers.clear()

    formatter = logging.Formatter(
        '[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s',
        datefmt='%Y-%m-%dT%H:%M:%S%z'
    )

    file_handler = logging.FileHandler(LOG_FILE, mode='a', encoding='utf-8')
    file_handler.setFormatter(formatter)

    stream_handler = logging.StreamHandler(sys.stdout)
    stream_handler.setFormatter(formatter)

    logger.addHandler(file_handler)
    logger.addHandler(stream_handler)
    return logger


logger = configure_logging()

app = Flask(__name__)


def ensure_runtime_dependencies():
    requirements_file = SIMULATOR_DIR / 'requirements.txt'
    if requirements_file.exists():
        try:
            import flask  # noqa: F401
        except ImportError:
            logger.warning('Flask dependency missing; installing simulator requirements.')
            subprocess.check_call([sys.executable, '-m', 'pip', 'install', '-r', str(requirements_file)])

    package_json = PROJECT_ROOT / 'package.json'
    if package_json.exists() and not (PROJECT_ROOT / 'node_modules').exists():
        logger.warning('Node dependencies missing; installing project dependencies.')
        subprocess.check_call(['npm', 'install'], cwd=str(PROJECT_ROOT), stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)


def is_port_open(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.5)
        return sock.connect_ex((host, port)) == 0


def is_simulator_running(port: int) -> bool:
    try:
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/', timeout=1) as response:
            return response.status == 200
    except (OSError, ValueError):
        return False


def launch_web_app():
    if is_port_open('127.0.0.1', 3000):
        logger.info('Next.js app is already running on port 3000; skipping startup.')
        return

    logger.info('Starting Next.js app from project root...')
    subprocess.Popen(
        ['npm', 'run', 'dev', '--', '--hostname', '0.0.0.0', '--port', '3000'],
        cwd=str(PROJECT_ROOT),
        stdout=open(LOG_FILE, 'a', encoding='utf-8'),
        stderr=subprocess.STDOUT,
        start_new_session=True,
        text=True,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0,
    )

    logger.info('Web app launch command sent to background.')

# Global variables for holding leaked memory and disk files
leaked_memory = []
disk_files = []
cpu_processes = []

def cpu_hog():
    """Function to burn CPU."""
    logger.warning("CPU hog thread started.")
    while True:
        _ = [x**2 for x in range(10000)]

@app.route('/')
def index():
    return jsonify({"status": "running", "message": "Aura SRE Python Simulator is active."})

@app.route('/trigger', methods=['POST'])
def trigger_anomaly():
    global leaked_memory, disk_files, cpu_processes
    data = request.json
    anomaly_type = data.get('type')
    logger.info(f"Received request to trigger anomaly: {anomaly_type}")

    if anomaly_type == 'cpu':
        # Start a few processes to peg CPU cores
        for _ in range(multiprocessing.cpu_count()):
            p = multiprocessing.Process(target=cpu_hog)
            p.start()
            cpu_processes.append(p)
        logger.error("High CPU load generated: Spawning calculation threads.")
        return jsonify({"status": "success", "message": "CPU anomaly triggered."})

    elif anomaly_type == 'ram':
        logger.warning("Memory leak simulated: Allocating large arrays.")
        # Allocate roughly ~100MB per chunk, do it 5 times
        try:
            for _ in range(5):
                leaked_memory.append(bytearray(100 * 1024 * 1024))
            logger.error("FATAL: OutOfMemoryError: Python process heap limit exceeded.")
        except MemoryError:
            logger.error("FATAL: OutOfMemoryError: Python process heap limit exceeded.")
        return jsonify({"status": "success", "message": "RAM anomaly triggered."})

    elif anomaly_type == 'disk':
        logger.warning("Storage warning: Simulating runaway log writes.")
        try:
            # Write a large dummy file (e.g. 500MB)
            filename = f"/tmp/dummy_large_file_{len(disk_files)}.dat"
            with open(filename, "wb") as f:
                f.write(os.urandom(100 * 1024 * 1024)) # 100MB
            disk_files.append(filename)
            logger.error("CRITICAL: Disk write failed: No space left on device.")
        except Exception as e:
            logger.error(f"CRITICAL: Disk write failed: No space left on device. {str(e)}")
        return jsonify({"status": "success", "message": "Disk anomaly triggered."})

    elif anomaly_type == 'db_error':
        logger.error("FATAL: connection pool limit exceeded. client rejected.")
        logger.error("OperationalError: FATAL: remaining connection slots are reserved for non-replication superuser connections")
        return jsonify({"status": "success", "message": "DB errors generated."})
        
    elif anomaly_type == 'auth_error':
        logger.warning("AuthFailure: Invalid token signature.")
        logger.error("CRITICAL: Unauthorized access attempt detected from IP 192.168.1.104")
        return jsonify({"status": "success", "message": "Auth errors generated."})
        
    elif anomaly_type == 'app_crash':
        logger.error("Exception in thread \"main\" java.lang.NullPointerException")
        logger.error("    at com.aura.backend.UserService.getUser(UserService.java:42)")
        logger.error("    at com.aura.backend.App.main(App.java:18)")
        return jsonify({"status": "success", "message": "Crash errors generated."})
    
    elif anomaly_type == 'clear':
        # Stop CPU processes
        for p in cpu_processes:
            p.terminate()
        cpu_processes.clear()
        
        # Clear memory
        leaked_memory = []
        
        # Clear disk
        for f in disk_files:
            try:
                os.remove(f)
            except OSError:
                pass
        disk_files.clear()
        
        logger.info("Cleared all active anomalies. System returning to normal.")
        return jsonify({"status": "success", "message": "All anomalies cleared."})

    return jsonify({"error": "Unknown anomaly type."}), 400

def background_noise():
    """Periodically write normal info logs to simulate normal traffic."""
    while True:
        time.sleep(10)
        logger.info("Processed standard health check request from load balancer.")

if __name__ == '__main__':
    ensure_runtime_dependencies()
    launch_web_app()

    # The Next.js API forwards anomaly requests to localhost:5050.
    simulator_port = int(os.getenv('SIMULATOR_PORT', '5050'))
    if is_port_open('0.0.0.0', simulator_port):
        if is_simulator_running(simulator_port):
            logger.info('Simulator is already running on port %s; reusing it.', simulator_port)
            logger.info('Project is running at http://localhost:3000.')
            threading.Event().wait()
        logger.error(
            'Port %s is occupied by another service. Stop that service or set SIMULATOR_PORT to a free port.',
            simulator_port,
        )
        sys.exit(1)

    # Start background noise generator
    t = threading.Thread(target=background_noise, daemon=True)
    t.start()

    logger.info('Starting Python Simulator API on port %s...', simulator_port)
    app.run(host='0.0.0.0', port=simulator_port, debug=False, use_reloader=False)
