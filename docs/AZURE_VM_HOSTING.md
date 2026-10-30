# Azure Ubuntu hosting — HTTPS, no ngrok

This is the selected internet-hosting setup: one Ubuntu VM runs the built Node
game and Nginx; Certbot manages HTTPS certificates. MongoDB Atlas remains the existing persistent database. Players
use one public HTTPS hostname, with WSS on that same origin. There is no Vite or
ngrok process on the VM. These are deployment instructions/templates, not a claim
that a VM has already been provisioned or certified for 40 players.

## 1. Finish creating the VM

- Ubuntu Server 24.04 LTS **x64**, preferably a non-preview 2-vCPU/8-GiB size.
  Validate the actual subscription quota and remaining credit before Create.
- Standard SSD OS disk, with enough space for the repository, native npm modules
  and builds. A 30–32 GiB OS disk is a reasonable starting point; the portal image
  may require a larger minimum. This is not a guarantee of free-tier coverage.
- Static public IPv4 attached to the VM NIC. Restrict SSH TCP 22 to your current
  administrator public IP, not the whole internet.
- Allow public **TCP 80 and 443** in the Azure network security group. Certbot/Nginx need
  reachability for HTTPS setup/renewal and HTTP-to-HTTPS redirection. Do **not**
  open 8080, 5173, or a database port to the internet. This configuration uses TCP;
  no UDP/HTTP3 rule is required.
- If using an OS firewall, mirror those rules without locking out SSH. This guide
  does not automatically change Azure NSGs or enable/disable the OS firewall.
- Keep your downloaded SSH private key private. Do not send it in chat or Git.

The old ngrok-only advice to leave 80/443 closed does **not** apply to this direct
VM deployment. Don't enable Spot for an event that must not be evicted.

## 2. Give the public IP a DNS hostname

You do not need to buy a domain for a one-day test. In Azure, open the VM's
**Public IP resource → Configuration → DNS name label**, choose an available
label and save. Copy the **exact resulting DNS name** shown by Azure; it may
include a generated suffix. Alternatively, point your own domain's A record at
the static IPv4. Do not publish an AAAA record unless IPv6 is actually configured.

Use that hostname (not a bare IP) for the standard public-certificate path below.
Certbot obtains/renews a publicly trusted certificate after DNS and ports are
correct. Do not click through certificate errors or use `curl -k` as a fix.

## 3. SSH into Ubuntu and install the runtime

From your Windows PC, replace the example key path and `VM_PUBLIC_IP`:

```powershell
ssh -i "$env:USERPROFILE\Downloads\ZeroHour1_key.pem" advay@VM_PUBLIC_IP
```

All remaining commands, until marked otherwise, run **inside Ubuntu over SSH**.
Use a normal sudo-capable administrator for installation/builds, not root npm.
Run each block in order and stop on errors. Enable fail-fast for this setup SSH
shell so a failed validation cannot fall through to an install/reload:

```bash
set -e
sudo apt-get update
sudo apt-get install -y git curl ca-certificates gnupg build-essential python3

# NodeSource's Node 22 repository; download the vendor installer before running it.
curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/heist-node22-setup.sh
sudo bash /tmp/heist-node22-setup.sh
sudo apt-get install -y nodejs
node --version
npm --version
command -v node
```

Node must be **22.19.0 or newer**. The service template expects `/usr/bin/node`;
adjust its ExecStart/ExecStartPre paths if your installation uses another location.
Do not install Ubuntu's older default Node and assume it supports `node:sqlite`.

Install Ubuntu's Nginx package and Certbot's snap (which supplies automatic renewal).
These commands assume no existing Certbot installation; do not mix apt/pip/snap
Certbot installations on an existing host.

```bash
sudo apt-get install -y nginx snapd
sudo snap install --classic certbot
/snap/bin/certbot --version
```

These commands assume a fresh VM, not one already hosting other applications.

## 4. Put the project at the service's expected path

```bash
sudo useradd --system --user-group --create-home --home-dir /var/lib/heist --shell /usr/sbin/nologin heist
sudo install -d -m 755 -o "$(id -un)" -g "$(id -gn)" /srv/the-heist
git clone https://github.com/advay1608/the-heist-2.0.git /srv/the-heist
cd /srv/the-heist
npm ci
npm run build
npx tsc -p apps/client/tsconfig.json --noEmit
```

Skip account creation/clone when those exact resources already exist; do not
delete an existing checkout to make commands succeed. The release must contain
the `deploy/azure` files referenced below. If these changes have not yet been
pushed to GitHub, transfer/review the updated source before following this guide;
cloning an older commit will not include them.

Do not copy Windows `node_modules` or a live database folder to Linux. npm installs
Linux-native modules. Keep development dependencies for the normal full build;
`npm ci --omit=dev` cannot perform this build. The source/build files need to be
readable by the `heist` service user; never make them world-writable.

## 5. Configure Atlas and private service settings

In Atlas Network Access, allow the VM's actual outbound public IPv4 **only**
(normally the directly attached public IPv4, using `/32`). Keep your existing
world database name if continuing the same event. Rotate credentials previously
shared in chat. Do not use `0.0.0.0/0` as an access-list workaround.

```bash
cd /srv/the-heist
sudo install -d -m 700 /etc/heist
# First install only: never overwrite an existing private configuration.
sudo test -e /etc/heist/heist.env || sudo install -m 600 deploy/azure/heist.env.example /etc/heist/heist.env
sudoedit /etc/heist/heist.env
```

Fill in the actual private `MONGODB_URI` and correct `MONGODB_DATABASE`. Leave
`DATABASE_BACKEND=mongodb`, `NODE_ENV=production`, `DEBUG_ENDPOINTS=false`,
`HOST=127.0.0.1`, and `PORT=8080`. No ngrok token is needed. The service manager
loads this root-only file; the application reads its environment. Do **not**
create a second `.env` inside `/srv/the-heist`: the VM preflight rejects duplicate
checkout configuration, avoiding split credentials/settings. A Windows lab
checkout can keep its separate `.env`; that file should not be copied to Git/VM.

For a genuinely empty world with no staff accounts, provision once:

```bash
cd /srv/the-heist
sudo env HEIST_ENV_FILE=/etc/heist/heist.env /usr/bin/node node_modules/tsx/dist/cli.mjs tools/provision-admins.mts --create-four-staff-accounts
```

This prints a private credentials-file path, not passwords. Keep that artifact
private and distribute staff logins securely. **Skip provisioning** when these
accounts already exist in Atlas; the tool refuses to replace/promote them. Do
not rerun SQLite migration on an already migrated Atlas database.

## 6. Stop the old writer, then start the VM game service

**Stop the lab PC's backend before starting the VM against the same world.** The
MongoDB lease deliberately rejects simultaneous hosts. Do not change database
names or delete leases merely to bypass it. After an unclean stop, allow at least
30 seconds for the old lease to expire. Stop any old tunnel when switching over.

On Ubuntu:

```bash
cd /srv/the-heist
sudo install -m 644 deploy/azure/heist.service /etc/systemd/system/heist.service
sudo systemctl daemon-reload
sudo systemctl enable --now heist
sudo systemctl status heist --no-pager
curl --fail http://127.0.0.1:8080/health
sudo ss -ltnp 'sport = :8080'
```

Confirm 8080 listens on **127.0.0.1**, not `0.0.0.0`/`[::]`. Preflight refuses
public binding, enabled debug, non-Mongo mode, missing builds and placeholder
credentials. `systemd` keeps the process running after SSH closes, restarts on
failure, and supplies graceful SIGTERM on stop. Its 1-GiB JS heap/2-GiB process
limits leave OS/proxy headroom; they are safeguards, not a performance guarantee.

## 7. Enable Nginx, HTTPS and WebSockets

No Caddy/ngrok is required. If you already installed and started Caddy solely
for this game, stop/disable that service before starting Nginx; two proxies must
not compete for 80/443. Do not stop an unrelated application's proxy.

Set your exact public DNS hostname in this Ubuntu shell (not a secret):

```bash
cd /srv/the-heist
set -e
read -r -p 'Exact public DNS hostname: ' HEIST_DOMAIN
node tools/render-vm-nginx.mjs --domain="$HEIST_DOMAIN" --stage=bootstrap > /tmp/heist-nginx-bootstrap.conf
```

Use the hostname from step 2, **without** `https://`, a path, or port. The renderer
rejects invalid names and directive injection while preserving Nginx's `$uri`
variables. If rendering fails, stop and correct the hostname before continuing.
The shell variable is needed for the rest of this step; re-enter it if reconnecting.

On a **fresh Nginx installation**, first enable the ACME-only bootstrap server.
This intentionally returns 404 for the game/login: credentials never go over HTTP.
The default Ubuntu site is disabled by moving its symlink to a recoverable backup;
do not use these steps unmodified on a VM with existing websites.

```bash
sudo install -d -m 755 /var/www/heist-acme/.well-known/acme-challenge /etc/nginx/snippets /etc/nginx/heist-backups
sudo install -m 644 deploy/azure/nginx-upgrade.conf /etc/nginx/conf.d/heist-upgrade.conf
sudo install -m 644 deploy/azure/nginx-player.conf /etc/nginx/snippets/heist-player.conf
# Only the first install: never replace an existing working heist site with bootstrap.
sudo test ! -e /etc/nginx/sites-available/heist
sudo install -m 644 /tmp/heist-nginx-bootstrap.conf /etc/nginx/sites-available/heist
sudo ln -s /etc/nginx/sites-available/heist /etc/nginx/sites-enabled/heist
if sudo test -L /etc/nginx/sites-enabled/default; then
  sudo mv -n /etc/nginx/sites-enabled/default /etc/nginx/heist-backups/default
fi
sudo nginx -t
sudo systemctl enable --now nginx
sudo systemctl reload nginx
```

**Stop on any error.** `test ! -e` above must succeed; an existing `heist` site
requires a reviewed update, not a bootstrap overwrite. Confirm DNS points to this
VM and public TCP 80 works before requesting the certificate:

```bash
# Enter your own contact email when Certbot asks; review its terms.
sudo /snap/bin/certbot certonly --webroot -w /var/www/heist-acme --cert-name "$HEIST_DOMAIN" -d "$HEIST_DOMAIN"
sudo /snap/bin/certbot certificates
```

Do not proceed unless the certificate was issued successfully at
`/etc/letsencrypt/live/YOUR_HOSTNAME/`. Bootstrap stays closed if issuance fails;
do not expose port 8080 to work around a certificate error. After success:

```bash
node tools/render-vm-nginx.mjs --domain="$HEIST_DOMAIN" --stage=https > /tmp/heist-nginx-https.conf
sudo cp -a /etc/nginx/sites-available/heist /etc/nginx/heist-backups/heist-before-https
sudo install -m 644 /tmp/heist-nginx-https.conf /etc/nginx/sites-available/heist
sudo nginx -t
# Only reload if nginx -t passes. If it fails, restore the backup and diagnose.
sudo systemctl reload nginx
sudo install -d -m 755 /etc/letsencrypt/renewal-hooks/deploy
sudo install -m 755 deploy/azure/renew-nginx.sh /etc/letsencrypt/renewal-hooks/deploy/heist-nginx
sudo /snap/bin/certbot renew --dry-run
sudo /etc/letsencrypt/renewal-hooks/deploy/heist-nginx
sudo systemctl list-timers --all | grep certbot
sudo systemctl status nginx --no-pager
```

The HTTPS site explicitly forwards WebSocket upgrades and serves players only:
login/register/map/event/account, `/ws`, and safe built assets. All other paths
return 404: staff/admin HTTP tools, metrics, debug, painter, configuration and
arbitrary files. Plain HTTP serves ACME validation and redirects other requests
to the fixed HTTPS hostname. No public game filesystem root or per-site request
access/error log is enabled; WebSocket URLs contain session credentials. Ubuntu's
global startup/configuration error log remains available. This is scoped route protection,
not a claim of a complete penetration test or comprehensive anti-abuse service.

From your own browser, open **`https://YOUR_EXACT_DNS_HOSTNAME/`**. Both players
use this URL and different accounts. No frontend rebuild for a new hostname,
separate socket URL, Vite port, ngrok command, or open public 8080 is required.
Do not distribute a raw `http://VM_IP:8080` login link.

## 8. Organizer access through SSH, not public admin routes

From a **second Windows PowerShell terminal**, keep this command running:

```powershell
ssh -i "$env:USERPROFILE\Downloads\ZeroHour1_key.pem" -N -L 18080:127.0.0.1:8080 advay@VM_PUBLIC_IP
```

Open **http://localhost:18080/** on that Windows PC and sign in as superadmin.
The browser's local HTTP leg is carried to the VM through encrypted SSH. Start,
Freeze/settlement, announcements and confirmation-protected Reset remain behind
the server's normal role checks. Do not add a public admin proxy route to work
around a 404. Existing event phase/progress persist on the move: hosting does not
automatically reset a frozen event or start a new one. Use Reset/Start knowingly.

## 9. Verify before the event

- Public HTTPS login, art and map load with a valid certificate; actual players
  sign in independently and see one another move/reconnect.
- Public `/metrics`, `/admin.html`, `/painter.html`, `/api/admin/event`,
  `/api/staff/challenges`, and `/.env` return 404; 8080 is unreachable externally.
- The SSH-forwarded organizer panel works; Atlas accounts/ledger are unchanged
  unless the organizer deliberately changes the round.
- Keep the host's timezone and auto-shutdown schedule clear; do not schedule VM
  shutdown during the event. Load-test a separate disposable world. Current
  legacy hosting-suite limitations are documented in [BOT_TESTING.md](BOT_TESTING.md).

Useful Ubuntu commands:

```bash
sudo systemctl status heist nginx --no-pager
sudo journalctl -u heist -n 50 --no-pager
sudo journalctl -u nginx -n 50 --no-pager
sudo systemctl stop heist
sudo systemctl start heist
# After planned code updates/rebuilds, during a maintenance window only:
sudo systemctl restart heist
```

Optional deployment checks after the full build, **before the real event**:

```bash
node --test tools/check-vm-env.test.mjs tools/render-vm-nginx.test.mjs
node tools/check-vm-proxy.mjs --nginx=/usr/sbin/nginx --openssl=/usr/bin/openssl
```

The second command starts and stops its own loopback/random-port, in-memory game
and Nginx process. It checks bootstrap denial, HTTPS/WSS with a trusted disposable
local certificate, redirects, real fixture login and the shared binary protocol,
private-path denial and body limits. It never opens the
saved world or starts a public certificate request; **public TLS, Azure networking
and the real systemd service must still be checked separately**.

Logs can contain operational identifiers or session URLs: inspect privately, don't publish raw
output. For updates, stop `heist`, review/pull the intended revision, `npm ci`
only if dependency inputs changed, rebuild, run checks, then start. Do not build
or run bots on the live VM during the real event. No reinstall/provision/reset
is required for routine service restarts.

After the one-day event, gracefully stop the game, preserve required MongoDB
archives/backups and configuration, then deallocate/delete the intended Azure
resources. Deallocation stops compute charges but retained disks/public IPs can
still incur costs. Never delete the shared Atlas world as VM cleanup.

## Official references

- [Azure public-IP DNS labels](https://learn.microsoft.com/en-us/azure/virtual-machines/create-fqdn)
- [NodeSource Node 22 installation](https://github.com/nodesource/distributions)
- [Nginx WebSocket proxying](https://nginx.org/en/docs/http/websocket.html)
- [Certbot installation](https://certbot.eff.org/instructions?ws=nginx&os=snap)
- [Certbot webroot certificates and renewal](https://eff-certbot.readthedocs.io/en/stable/using.html#webroot)
