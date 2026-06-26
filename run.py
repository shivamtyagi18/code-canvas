#!/usr/bin/env python3
import os
import sys
import subprocess
import webbrowser
import time
import argparse
import socket
from threading import Thread

def is_port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(('127.0.0.1', port)) == 0

def run_backend(port: int):
    print(f"[*] Starting code-canvas backend on port {port}...")
    try:
        # Run uvicorn server
        subprocess.run(
            [sys.executable, "-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1", "--port", str(port), "--log-level", "info"],
            check=True
        )
    except KeyboardInterrupt:
        pass
    except Exception as e:
        print(f"[!] Backend failed to start: {e}", file=sys.stderr)

def run_frontend_dev(port: int, backend_port: int):
    print(f"[*] Starting frontend dev server on port {port}...")
    try:
        # Set environment variable so Vite knows where the API is, if needed
        env = os.environ.copy()
        env["VITE_API_URL"] = f"http://127.0.0.1:{backend_port}"
        subprocess.run(
            ["npm", "run", "dev", "--", "--port", str(port)],
            cwd=os.path.join(os.path.dirname(__file__), "frontend"),
            env=env,
            check=True
        )
    except KeyboardInterrupt:
        pass
    except Exception as e:
        print(f"[!] Frontend dev server failed: {e}", file=sys.stderr)

def build_frontend():
    print("[*] Building frontend assets...")
    frontend_dir = os.path.join(os.path.dirname(__file__), "frontend")
    if not os.path.exists(os.path.join(frontend_dir, "node_modules")):
        print("[*] node_modules not found. Running npm install...")
        subprocess.run(["npm", "install"], cwd=frontend_dir, check=True)
    subprocess.run(["npm", "run", "build"], cwd=frontend_dir, check=True)
    print("[+] Frontend build completed successfully!")

def main():
    parser = argparse.ArgumentParser(description="code-canvas: Visual Token-Budget Context Packager")
    parser.add_argument("--port", type=int, default=8000, help="Port to run the backend server (default: 8000)")
    parser.add_argument("--dev", action="store_true", help="Run in frontend development mode (runs Vite dev server on port 5173)")
    parser.add_argument("--build", action="store_true", help="Force build the frontend static assets")
    args = parser.parse_args()

    # Change to root directory of project
    project_root = os.path.dirname(os.path.abspath(__file__))
    os.chdir(project_root)

    # 1. Install check for python packages
    try:
        import fastapi
        import uvicorn
        import tiktoken
    except ImportError:
        print("[!] Missing required Python libraries. Please run:")
        print(f"    pip3 install -r backend/requirements.txt")
        sys.exit(1)

    # 2. Handle build mode
    frontend_dist = os.path.join(project_root, "frontend", "dist")
    if args.build or (not args.dev and not os.path.exists(frontend_dist)):
        try:
            build_frontend()
        except Exception as e:
            print(f"[!] Failed to build frontend: {e}", file=sys.stderr)
            print("[*] Falling back to Dev mode. Starting dev server instead...")
            args.dev = True

    # Check ports
    backend_port = args.port
    if is_port_in_use(backend_port):
        print(f"[!] Port {backend_port} is already in use. Please select a different port using --port.")
        sys.exit(1)

    # 3. Startup logic
    threads = []
    
    # Start Backend Thread
    backend_thread = Thread(target=run_backend, args=(backend_port,), daemon=True)
    backend_thread.start()
    threads.append(backend_thread)

    # Give backend a moment to spin up
    time.sleep(1.5)

    if args.dev:
        # Start Frontend Dev Server
        dev_port = 5173
        if is_port_in_use(dev_port):
            dev_port = 5174 # fallback
            
        frontend_thread = Thread(target=run_frontend_dev, args=(dev_port, backend_port), daemon=True)
        frontend_thread.start()
        threads.append(frontend_thread)
        
        # Open browser to Vite server
        time.sleep(2)
        url = f"http://127.0.0.1:{dev_port}"
        print(f"[+] Opening code-canvas UI in development mode: {url}")
        webbrowser.open(url)
    else:
        # Open browser to FastAPI server which serves the built SPA
        url = f"http://127.0.0.1:{backend_port}"
        print(f"[+] Opening code-canvas UI: {url}")
        webbrowser.open(url)

    # Keep main thread alive
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n[*] Shutting down code-canvas...")

if __name__ == "__main__":
    main()
