#!/bin/sh
set -eu

# Install as /etc/letsencrypt/renewal-hooks/deploy/tidelab-public.
# Certbot calls deploy hooks only after a certificate was renewed successfully.
/usr/sbin/nginx -t -c /etc/tidelab/public-http.nginx.conf
/usr/bin/systemctl reload tidelab-public-http.service
