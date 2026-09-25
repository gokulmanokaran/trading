"""
monitoring/service.py
Background Worker Supervisor for Signal Desk.

Runs continuously 24/7 on Render Background Worker.
Supervises and auto-restarts the strategy engine and call monitor process on crashes.
Monitors:
- NIFTY during NSE market hours (9:15 - 15:30 IST)
- CRUDEOIL during MCX market hours (9:00 - 23:30 IST)
- Upstox live data -> Strategy Engine -> Supabase -> Signal Page
"""

import os
import sys
import time
import signal
import subprocess
import json
from datetime import datetime, timezone
from pathlib import Path

# Resolve root repository directory
BASE_DIR = Path(__file__).resolve().parent.parent
WORKER_SCRIPT = BASE_DIR / "backend" / "worker.js"

running = True
current_process = None


def log_event(event: str, **kwargs):
    payload = {
        "event": event,
        "supervisor": "monitoring/service.py",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        **kwargs
    }
    print(json.dumps(payload), flush=True)


def handle_signal(sig_num, frame):
    global running, current_process
    sig_name = "SIGTERM" if sig_num == signal.SIGTERM else "SIGINT"
    log_event("supervisor_signal_received", signal=sig_name)
    running = False
    if current_process and current_process.poll() is None:
        try:
            current_process.terminate()
            current_process.wait(timeout=10)
        except Exception as e:
            log_event("supervisor_kill_forced", error=str(e))
            current_process.kill()
    sys.exit(0)


def check_environment():
    env_file = BASE_DIR / ".env"
    if env_file.exists():
        try:
            with open(env_file, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        k = k.strip()
                        v = v.strip().strip("'\"")
                        if k and k not in os.environ:
                            os.environ[k] = v
        except Exception:
            pass

    missing = []
    if not os.getenv("UPSTOX_ACCESS_TOKEN"):
        missing.append("UPSTOX_ACCESS_TOKEN")
    if not os.getenv("SUPABASE_URL"):
        missing.append("SUPABASE_URL")
    if not os.getenv("SUPABASE_SERVICE_ROLE_KEY"):
        missing.append("SUPABASE_SERVICE_ROLE_KEY")

    if missing:
        log_event(
            "env_warning",
            message=f"Missing recommended environment variables: {', '.join(missing)}. "
                    "Ensure these are set in your Render Background Worker environment."
        )


def run_worker_supervisor():
    global current_process, running
    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    log_event(
        "supervisor_started",
        worker_script=str(WORKER_SCRIPT),
        python_version=sys.version.split()[0],
        cwd=str(BASE_DIR)
    )

    check_environment()

    restart_count = 0
    backoff_delay = 5  # seconds

    while running:
        if not WORKER_SCRIPT.exists():
            log_event("fatal_error", error=f"Worker script not found at {WORKER_SCRIPT}")
            time.sleep(10)
            continue

        try:
            restart_count += 1
            log_event("launching_worker", attempt=restart_count)

            # Find node binary
            node_cmd = "node"
            current_process = subprocess.Popen(
                [node_cmd, str(WORKER_SCRIPT)],
                cwd=str(BASE_DIR),
                stdout=sys.stdout,
                stderr=sys.stderr,
                env=os.environ.copy()
            )

            # Wait for worker process to exit or crash
            exit_code = current_process.wait()

            if not running:
                break

            log_event(
                "worker_exited",
                exit_code=exit_code,
                will_restart=True,
                cooldown_seconds=backoff_delay
            )
            time.sleep(backoff_delay)

        except FileNotFoundError:
            log_event("fatal_error", error="Node.js executable ('node') was not found in PATH.")
            time.sleep(15)
        except Exception as ex:
            log_event("supervisor_exception", error=str(ex))
            time.sleep(backoff_delay)


if __name__ == "__main__":
    run_worker_supervisor()
