# Direct Azure VM deployment preparation — 15 October 2026

Prepared an Ubuntu/systemd/**Nginx + Certbot** deployment without ngrok, preserving the
Windows lab launcher and original artwork/shared protocol. This is a local
configuration/verification task: no Azure resource was created, no public DNS or
firewall changed, no Atlas account/event reset, and no existing game was restarted.

## Changes

- `HOST` config, defaulting to existing `0.0.0.0` LAN behavior; VM service binds
  only to `127.0.0.1:8080` behind HTTPS.
- Nginx templates: ACME-only HTTP bootstrap; then HTTPS with HTTP redirect and
  a retained renewal path. Explicit WebSocket headers/timeouts, player/API/asset
  routing, 16-KB body limit, and 404 for private routes/unsafe asset names. No
  virtual-host access/error request log is configured because session tokens
  occur in WebSocket query strings. Global startup errors remain available.
- Certbot webroot issuance/automatic renewal plus an Nginx config-check/reload
  deploy hook. DNS renderer rejects placeholders, IPs and directive injection.
  Caddy templates were superseded/removed following the user's Nginx choice;
  no Caddy or ngrok process is needed on the VM.
- Non-root systemd game service, private external environment file, build/env
  preflight, crash restart, graceful stop, read-only system protection and memory
  limits. The public hostname is rendered separately, never from the private DB file.
- Admin provisioning supports an explicit private `HEIST_ENV_FILE` outside the
  checkout. Existing usernames still cannot be replaced or publicly promoted.
- README prioritizes Azure, with a complete first-install, DNS/NSG, Atlas,
  service, certificate, SSH-forwarded organizer, update and cleanup guide.
  Ngrok remains an optional legacy local-PC tool, not part of VM deployment.

## Verification

- Server compilation and all **125 server tests passed**, including two new
  listener-configuration checks. The isolated 40-player regression had zero tick
  overruns; this short test is not an Azure capacity or soak certification.
- VM preflight unit checks passed (including absent ngrok, unsafe bind/debug/mode,
  malformed/placeholding URIs, and redaction). No real secret is printed.
- All **14** VM preflight + Nginx renderer tests passed, including hostname
  validation, bootstrap denial and preserving native Nginx request variables.
- Actual Nginx **1.30.6 for Windows**, downloaded from nginx.org into ignored
  `bot-runs`, passed `nginx -t` and the isolated proxy smoke using the production
  templates/snippets (only ports, paths and fixture upstream adapted). Checked:
  ACME proof delivery, no plaintext login/WS, HTTP redirect, HTTPS HTML/JS/CSS/art,
  map/event API, actual fixture login/account, authenticated WSS
  WELCOME/PING/PONG/event-state, 413 oversized login and 404 private/encoded
  traversals. TLS verification remained enabled with an explicitly trusted
  disposable local self-signed certificate; no real certificate/private key was
  used. Owned game/proxy processes were stopped; no production endpoint or Atlas
  was targeted. Ubuntu's packaged Nginx runtime still needs VM verification.
- Earlier Caddy-only validation is superseded, not evidence for Nginx deployment.
- systemd parsed the unit under the available Ubuntu/WSL environment, but full
  verification reported missing `/usr/bin/node` (not installed in that QA distro).
  Windows-mounted file-mode warnings do not apply to the guide's root-owned 0644
  installed unit. Actual Linux service startup, sandbox/permission behavior and
  restart/shutdown remain to be verified on the provisioned VM with Node installed.

## Remaining deployment gates

The user's actual VM public IP/DNS hostname, subscription/size approval, valid
public certificate issuance/renewal, Azure NSG routing, Atlas outbound-IP allowlisting,
real Linux service startup and two remote player sessions are not yet verified.
The old local server must release its MongoDB lease before the VM takes over the
same world. Staff HTTP routes stay private through SSH forwarding; publishing
the raw Node port is not an acceptable shortcut. No production-ready or
40-player-on-Azure guarantee is claimed by these local tests.
