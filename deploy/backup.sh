#!/bin/sh
# Nightly PostgreSQL backup (custom format, restorable with pg_restore). Runs in the
# "backup" container; KEEP_DAYS controls local retention. Copy /backups off the server.
set -eu

while true; do
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  file="/backups/townow-$stamp.dump"
  if pg_dump --format=custom --file="$file.partial"; then
    mv "$file.partial" "$file"
    echo "backup ok: $file"
  else
    rm -f "$file.partial"
    echo "backup FAILED at $stamp" >&2
  fi
  find /backups -name 'townow-*.dump' -mtime +"$KEEP_DAYS" -delete
  sleep 86400
done
