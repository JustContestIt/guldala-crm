#!/bin/sh
# Daily pg_dump at 03:00 Almaty, 30 days kept (spec §10). `sh /backup.sh now` makes one dump and exits.
dump() {
  f="/backups/guldala-$(date +%F).dump"
  if pg_dump -Fc -f "$f.tmp" && mv "$f.tmp" "$f"; then
    echo "backup: $f"
  else
    rm -f "$f.tmp"
    echo "backup FAILED" >&2
  fi
  find /backups -name 'guldala-*.dump' -mtime +30 -delete
}

[ "$1" = now ] && { dump; exit; }

while :; do
  # seconds until the next 03:00 local time (TZ=Asia/Almaty in the container)
  wait=$(( ($(date -d 03:00 +%s) - $(date +%s) + 86400) % 86400 ))
  sleep "${wait:-86400}"
  dump
  sleep 60 # step past 03:00 so the next wait is a full day
done
