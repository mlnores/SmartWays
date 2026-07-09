#!/usr/bin/env bash
set -euo pipefail

DATA_DIR="${1:-docker-data}"
POI_FILE_ID="1TqabARuHiM2oyGg37Oo2xUzq6D1BMpTY"
ROUTES_FILE_ID="1udNMTwR4YWqnyDCFjdxCKuQO4Q0lWdjA"
GEOBOUNDARIES_FILE_ID="1OJH8xRf8hmy6Xs5QemrFZUs-mCVYVPnT"

mkdir -p "$DATA_DIR"

download_drive_file() {
  local file_id="$1"
  local output="$2"
  local cookie_file
  local confirm_token
  cookie_file="$(mktemp)"

  curl -L -c "$cookie_file" \
    "https://drive.google.com/uc?export=download&id=${file_id}" \
    -o "${output}.tmp"

  confirm_token="$(awk '/download_warning/ {print $NF}' "$cookie_file" | tail -1)"
  if [ -n "$confirm_token" ]; then
    curl -L -b "$cookie_file" \
      "https://drive.google.com/uc?export=download&confirm=${confirm_token}&id=${file_id}" \
      -o "${output}.tmp"
  fi

  mv "${output}.tmp" "$output"
  rm -f "$cookie_file"
}

prepare_zip() {
  local local_name="$1"
  local file_id="$2"
  local target_zip="$DATA_DIR/$local_name"

  if [ -f "$local_name" ]; then
    echo "Using local $local_name"
    cp "$local_name" "$target_zip"
  elif [ -f "$target_zip" ]; then
    echo "Using existing $target_zip"
  else
    echo "Downloading $local_name"
    download_drive_file "$file_id" "$target_zip"
  fi
}

prepare_file() {
  local local_name="$1"
  local file_id="$2"
  local target_file="$DATA_DIR/$local_name"

  if [ -f "$local_name" ]; then
    echo "Using local $local_name"
    cp "$local_name" "$target_file"
  elif [ -f "$target_file" ]; then
    echo "Using existing $target_file"
  else
    echo "Downloading $local_name"
    download_drive_file "$file_id" "$target_file"
  fi
}

command -v curl >/dev/null 2>&1 || {
  echo "curl is required." >&2
  exit 1
}
command -v unzip >/dev/null 2>&1 || {
  echo "unzip is required." >&2
  exit 1
}

prepare_zip "POI_data.zip" "$POI_FILE_ID"
prepare_zip "routes_data.zip" "$ROUTES_FILE_ID"
prepare_file "geoboundaries_adm0.geojson" "$GEOBOUNDARIES_FILE_ID"

echo "Extracting POI_data.zip"
unzip -q -o "$DATA_DIR/POI_data.zip" -d "$DATA_DIR"

echo "Extracting routes_data.zip"
unzip -q -o "$DATA_DIR/routes_data.zip" -d "$DATA_DIR"

cat <<EOF
Data prepared under $DATA_DIR.

Expected paths after extraction:
  $DATA_DIR/POI_data/
  $DATA_DIR/routes_data/
  $DATA_DIR/geoboundaries_adm0.geojson
EOF
