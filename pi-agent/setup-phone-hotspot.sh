#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: sudo ./setup-phone-hotspot.sh 'SSID' 'password'"
  exit 1
fi

SSID="$1"
PASSWORD="$2"
NAME="Donut Phone Hotspot"

# Store a fallback wlan0 profile without interrupting the current connection.
nmcli connection delete "$NAME" >/dev/null 2>&1 || true
nmcli connection add type wifi ifname wlan0 con-name "$NAME" ssid "$SSID"
nmcli connection modify "$NAME" \
  wifi-sec.key-mgmt wpa-psk \
  wifi-sec.psk "$PASSWORD" \
  connection.autoconnect yes \
  connection.autoconnect-priority -20 \
  ipv4.method auto ipv6.method auto

systemctl enable --now tailscaled
echo "Phone hotspot saved. Home WiFi remains preferred; Donut will use this profile when needed."
