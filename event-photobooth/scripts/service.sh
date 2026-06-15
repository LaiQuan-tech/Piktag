#!/bin/bash
# Service controller for the Event Photobooth watcher (macOS launchd).
#
# Usage:
#   ./scripts/service.sh install     install + start (boot-resistant)
#   ./scripts/service.sh uninstall   stop + remove
#   ./scripts/service.sh status      show service state + recent log lines
#   ./scripts/service.sh logs        tail -f the live log
#   ./scripts/service.sh restart     kick the service to restart now

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LABEL="com.piktag.event-photobooth.watcher"
PLIST_SRC="$PROJECT_DIR/launchd/$LABEL.plist.template"
PLIST_DST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"
LOG_DIR="$HOME/PhotoBooth/logs"
LOG_FILE="$LOG_DIR/watcher.log"
ERR_FILE="$LOG_DIR/watcher.err.log"

cmd_install() {
  # Make sure log + LaunchAgents dirs exist
  mkdir -p "$LOG_DIR" "$(dirname "$PLIST_DST")"

  # Kill any orphan watcher processes (e.g. one we ran manually earlier)
  # so they don't fight with the about-to-launch service for the USB
  # printer or inbox events.
  pkill -f "scripts/watch.py" 2>/dev/null || true
  sleep 1

  # Materialize the plist from the template by substituting absolute paths.
  # The result lives in ~/Library/LaunchAgents so it survives reboots.
  sed -e "s|@PROJECT_DIR@|$PROJECT_DIR|g" \
      -e "s|@HOME@|$HOME|g" \
      "$PLIST_SRC" > "$PLIST_DST"

  # Bootstrap = the modern launchctl equivalent of load+enable. If a
  # previous version is loaded, boot it out first (modern launchctl
  # refuses to re-bootstrap an already-loaded service).
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  launchctl bootstrap "$DOMAIN" "$PLIST_DST"

  echo "✓ Installed: $PLIST_DST"
  echo "  Auto-starts at login. Auto-restarts on crash."
  echo "  Logs:   $LOG_FILE"
  echo "  Status: $0 status"
  echo "  Tail:   $0 logs"
}

cmd_uninstall() {
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || echo "  (was not loaded)"
  rm -f "$PLIST_DST"
  echo "✓ Uninstalled."
  echo "  Logs left at $LOG_DIR for reference."
}

cmd_status() {
  echo "=== launchctl ==="
  # `launchctl list <label>` returns 0 + JSON if running, non-zero if not
  if launchctl list "$LABEL" 2>/dev/null | head -20; then
    :
  else
    echo "  (not loaded — run: $0 install)"
  fi
  echo ""
  echo "=== last 25 log lines ==="
  tail -25 "$LOG_FILE" 2>/dev/null || echo "  (no log yet — service may not have started)"
  echo ""
  echo "=== recent errors ==="
  tail -10 "$ERR_FILE" 2>/dev/null || echo "  (no error log)"
}

cmd_logs() {
  if [ ! -f "$LOG_FILE" ]; then
    echo "Log doesn't exist yet at $LOG_FILE — is the service installed?"
    exit 1
  fi
  tail -f "$LOG_FILE"
}

cmd_restart() {
  # kickstart -k = stop running instance, start a fresh one
  launchctl kickstart -k "$DOMAIN/$LABEL"
  echo "✓ Restarted. Recent log:"
  sleep 2
  tail -10 "$LOG_FILE" 2>/dev/null
}

case "${1:-}" in
  install)   cmd_install ;;
  uninstall) cmd_uninstall ;;
  status)    cmd_status ;;
  logs)      cmd_logs ;;
  restart)   cmd_restart ;;
  *)
    echo "Usage: $0 {install|uninstall|status|logs|restart}"
    exit 1
    ;;
esac
