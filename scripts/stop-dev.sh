#!/usr/bin/env bash
# Stop typical RexAlgo dev listeners (Next 3000, Vite 8080, alternate Vite 5173).
set -euo pipefail
stop_port() {
  local p="$1"
  local pids
  pids="$(lsof -ti ":$p" 2>/dev/null || true)"
  if [ -n "${pids}" ]; then
    echo "Stopping PID(s) on port ${p}: ${pids}"
    kill -9 ${pids} 2>/dev/null || true
  else
    echo "Nothing listening on port ${p}"
  fi
}
stop_port 3000
stop_port 8080
stop_port 5173
echo "Done."
