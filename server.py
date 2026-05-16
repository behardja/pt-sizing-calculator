"""PT Sizing Calculator — Dev Server Launcher

Starts both the FastAPI backend (uvicorn :8000) and the Vite dev server (:5173)
bound to 0.0.0.0 so they're reachable from outside the GCP VM. Prints the
external IP for the Vite URL — that's the URL to open in your laptop browser.
Vite proxies /api → backend.

Usage from the repo root:
    python server.py            # production-ish (no reload)
    python server.py --dev      # uvicorn --reload, vite watches normally
"""

from __future__ import annotations

import argparse
import os
import signal
import subprocess
import sys
import threading
import time
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
FRONTEND = os.path.join(ROOT, "frontend")
VITE_PORT = 5173
API_PORT = 8000

PINK = "\033[38;5;205m"
AMBER = "\033[38;5;215m"
GRAY = "\033[2m"
BOLD = "\033[1m"
RESET = "\033[0m"


def get_external_ip():
    try:
        req = urllib.request.Request(
            "http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip",
            headers={"Metadata-Flavor": "Google"},
        )
        with urllib.request.urlopen(req, timeout=2) as resp:
            return resp.read().decode().strip()
    except Exception:
        return None


def stream(proc, prefix, color):
    for line in iter(proc.stdout.readline, b""):
        text = line.decode("utf-8", errors="replace").rstrip()
        if text:
            print(f"{color}{prefix}{RESET} {text}")
    proc.stdout.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dev", action="store_true", help="Enable uvicorn --reload")
    args = ap.parse_args()

    if not os.environ.get("GEMINI_API_KEY"):
        print(f"{AMBER}[warn]{RESET} GEMINI_API_KEY not set — /api/count-tokens will fail until exported.")

    api_proc = None
    vite_proc = None
    try:
        # ── Start FastAPI backend ──
        api_cmd = [
            sys.executable, "-m", "uvicorn", "backend.main:app",
            "--host", "0.0.0.0", "--port", str(API_PORT),
        ]
        if args.dev:
            api_cmd.append("--reload")
        print(f"{AMBER}[api]  {RESET} Starting on :{API_PORT}...")
        api_proc = subprocess.Popen(
            api_cmd, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        )
        threading.Thread(target=stream, args=(api_proc, "[api] ", AMBER), daemon=True).start()

        # ── Start Vite ──
        print(f"{PINK}[vite] {RESET} Starting on :{VITE_PORT}...")
        vite_proc = subprocess.Popen(
            ["npx", "vite", "--host", "--port", str(VITE_PORT), "--strictPort"],
            cwd=FRONTEND, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        )
        threading.Thread(target=stream, args=(vite_proc, "[vite]", PINK), daemon=True).start()

        # Give both a moment to come up before printing the URL block
        time.sleep(2.0)

        external_ip = get_external_ip()
        print()
        print(f"  {BOLD}PT Sizing Calculator{RESET} {GRAY}— ready{RESET}")
        print(f"  {GRAY}Local:    {RESET}http://localhost:{VITE_PORT}")
        if external_ip:
            print(f"  {GRAY}External: {RESET}{BOLD}http://{external_ip}:{VITE_PORT}{RESET}")
            print(f"  {GRAY}          (open this URL from your laptop's browser){RESET}")
        else:
            print(f"  {GRAY}External: {RESET}(could not reach metadata server — not on GCP?)")
        print(f"  {GRAY}API:      {RESET}http://localhost:{API_PORT}/docs (proxied at /api/*)")
        print()

        # Block until either subprocess exits
        while True:
            if api_proc.poll() is not None:
                print(f"{AMBER}[api]  {RESET} exited with code {api_proc.returncode}")
                raise SystemExit(api_proc.returncode or 1)
            if vite_proc.poll() is not None:
                print(f"{PINK}[vite] {RESET} exited with code {vite_proc.returncode}")
                raise SystemExit(vite_proc.returncode or 1)
            time.sleep(0.5)

    except (KeyboardInterrupt, SystemExit):
        print(f"\n{GRAY}Shutting down...{RESET}")
        for proc, name in ((api_proc, "api"), (vite_proc, "vite")):
            if proc and proc.poll() is None:
                proc.send_signal(signal.SIGTERM)
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()


if __name__ == "__main__":
    main()
