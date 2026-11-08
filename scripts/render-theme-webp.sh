#!/bin/sh

set -eu

minimum_cwebp_version='1.3.2'

case "$0" in
  /*) script_path=$0 ;;
  *) script_path=$PWD/$0 ;;
esac
script_directory=${script_path%/*}
project_root=$(CDPATH= cd -- "$script_directory/.." && pwd)
source_directory=${1:-"$project_root/assets/themes/project-zero/source"}
output_directory=${2:-"$project_root/renderer/boot/assets"}

if ! cwebp_binary=$(command -v cwebp 2>/dev/null); then
  echo "cwebp is required to render the public theme. On macOS, run: brew install webp" >&2
  exit 127
fi

cwebp_version=$($cwebp_binary -version 2>&1 | awk 'NR == 1 {print $1}')
if ! awk -v current="$cwebp_version" -v minimum="$minimum_cwebp_version" '
  function version_number(value, parts, count, position, total) {
    count = split(value, parts, ".")
    if (count != 3) return -1
    total = 0
    for (position = 1; position <= 3; position += 1) {
      if (parts[position] !~ /^[0-9]+$/) return -1
      total = (total * 1000) + parts[position]
    }
    return total
  }
  BEGIN { exit !(version_number(current) >= version_number(minimum)) }
'; then
  echo "cwebp $minimum_cwebp_version or newer is required; found: $cwebp_version" >&2
  echo "On macOS, run: brew install webp" >&2
  exit 1
fi

for source_file in scene-a-sync.png scene-b-awakening.png scene-c-online.png; do
  if [ ! -f "$source_directory/$source_file" ]; then
    echo "Missing public theme source: $source_directory/$source_file" >&2
    exit 1
  fi
done

mkdir -p "$output_directory"

render_scene() {
  input_file=$1
  output_file=$2
  "$cwebp_binary" -quiet -q 90 -metadata none \
    "$source_directory/$input_file" -o "$output_directory/$output_file"
}

render_scene scene-a-sync.png scene-a-sync.webp
render_scene scene-b-awakening.png scene-b-awakening.webp
render_scene scene-c-online.png scene-c-online.webp
