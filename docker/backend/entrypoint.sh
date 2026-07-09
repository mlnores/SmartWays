#!/usr/bin/env sh
set -eu

if [ -z "${GDAL_LIBRARY_PATH:-}" ]; then
  GDAL_LIBRARY_PATH="$(find /usr/lib -name 'libgdal.so*' -type f 2>/dev/null | sort | head -n 1 || true)"
  if [ -n "$GDAL_LIBRARY_PATH" ]; then
    export GDAL_LIBRARY_PATH
  fi
fi

if [ -z "${SPATIALITE_LIBRARY_PATH:-}" ]; then
  SPATIALITE_LIBRARY_PATH="$(find /usr/lib -name 'mod_spatialite.so*' -type f 2>/dev/null | sort | head -n 1 || true)"
  if [ -n "$SPATIALITE_LIBRARY_PATH" ]; then
    export SPATIALITE_LIBRARY_PATH
  fi
fi

if [ "${DATABASE_ENGINE:-}" = "postgis" ]; then
  python - <<'PY'
import os
import socket
import time

host = os.environ.get("POSTGRES_HOST", "db")
port = int(os.environ.get("POSTGRES_PORT", "5432"))
deadline = time.time() + 60

while True:
    try:
        with socket.create_connection((host, port), timeout=2):
            break
    except OSError:
        if time.time() > deadline:
            raise SystemExit(f"Timed out waiting for PostgreSQL at {host}:{port}")
        time.sleep(1)
PY
fi

python manage.py migrate --noinput
python manage.py collectstatic --noinput

exec "$@"
