#!/bin/sh
# Certbot deploy hook: only reload after a successful renewal and config check.
set -eu
/usr/sbin/nginx -t
/usr/bin/systemctl reload nginx
