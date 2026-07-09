#!/usr/bin/env sh
set -eu

cat > /usr/share/nginx/html/smartways-config.js <<EOF
window.SMARTWAYS_CONFIG = window.SMARTWAYS_CONFIG || {
  apiBaseUrl: '${SMARTWAYS_API_BASE_URL:-/api}'
};
EOF
