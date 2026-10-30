# One host PC, separate player PCs

This is one central HTTP/WebSocket server, not a server on each player machine:

```text
Host PC: built Node server (port 8080) → private MongoDB Atlas database
  ├─ Player PC 1: browser → http://HOST-LAN-IP:8080/ → account 1
  ├─ Player PC 2: browser → http://HOST-LAN-IP:8080/ → account 2
  └─ Up to 40 operators: separate accounts, same host URL
```

The host serves the frontend, artwork, API and socket on the same origin. Players need only a modern browser, not Node, Git, a database or a copy of this repository. `localhost` on a player's machine refers to **that player's machine**, not the host.

## 1. Prepare the host

Use an SSD and wired Ethernet if available. Connect all PCs to the same trusted LAN; disable guest/client isolation on the lab network through the network administrator if it prevents PC-to-PC access. Do not switch off the firewall.

Install Git and a supported Node runtime (project minimum 22.19.0), then open PowerShell:

```powershell
git clone https://github.com/advay1608/the-heist-2.0.git C:\Projects\The-Heist-2.0
Set-Location C:\Projects\The-Heist-2.0
node --version
npm ci
npm run build
```

Copy `.env.example` to the root `.env` and fill in the private Atlas URI and database name. The host needs internet access to Atlas, and its outbound public IP must be allowed. For a fresh world, run `npx tsx tools/provision-admins.mts --create-four-staff-accounts` once and retain the private credentials file. For existing SQLite data, follow [the offline migration guide](MONGODB_AND_ADMINS.md) first; do not provision staff before migration.

For an existing checkout, stop its server before updating, back up its databases, then `git pull --ff-only`, `npm ci`, and `npm run build`. Preserve local changes: do not force-reset them. Native packages may need the compiler toolchain requested by npm if no prebuilt binary is available. Do not use `--ignore-scripts`.

## 2. Run the isolated tests before event day

From the repository root, on the **actual hosting PC/VM**:

```powershell
npm run bots:hosting -- --profile=smoke
npm run bots:hosting -- --profile=lab
# Reserve several hours; one 40-player crowded soak for 10,800 seconds:
npm run bots:hosting -- --profile=soak
```

Each command launches its own built server with disk-backed disposable databases and random private credentials. It does not use the real saved event. Reports go to `bot-runs/hosting-*/report.md` and `summary.json`. Exit code 0 means all gates passed; a failed/incomplete run exits 1. Read [the test guide](BOT_TESTING.md) for two-PC generation and limitations. **Do not load-test the prize event while people are playing.**

## 3. Start the real host

```powershell
Set-Location C:\Projects\The-Heist-2.0
& .\tools\host-lab.ps1
```

The script defaults to MongoDB and reads the private root `.env`; a legacy organizer token is not required in Mongo mode. Sign in with the super-admin account and use the right-side control button. The launcher does not change the firewall, start/reset the prize clock or delete data. Keep the terminal running. Ctrl+C stops the server.

If your organization's execution policy blocks the script, use the manual production environment commands in the README; follow your administrator's script policy, not a machine-wide bypass.

Defaults: 40 player network slots plus four staff slots, 20 Hz ticks, original authoritative movement settings, four hashing workers, a 1 GiB JS heap ceiling and debug routes disabled. The heap ceiling does not cap all native/Argon2/process memory. The script fixes normal cadence/rate limits instead of inheriting experimental shell overrides. It serves the built client: no Vite, tsx watcher or bots are needed during the event.

For a **separate rehearsal** without touching existing accounts or ledger:

```powershell
& .\tools\host-lab.ps1 -DatabaseBackend sqlite -DataDirectory 'C:\HeistData\Rehearsal-Oct14' -Port 8081
```

An existing database resumes its existing event. A fresh explicitly named directory starts in lobby. Do not delete databases to reset. Stop any development process using the chosen port first.

## 4. Find the host's LAN IPv4 address

On the host:

```powershell
Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
  Select-Object InterfaceAlias, IPAddress
```

Choose the Ethernet/Wi-Fi address attached to the player LAN, not a VPN, loopback or virtual adapter. Example: if it is `192.168.1.50`, the player URL is **http://192.168.1.50:8080/**. The example address is not automatically your address. Reserve that address in the router/DHCP configuration with the network administrator so it does not change during the event.

For a VM, use a bridged/external virtual switch so it has a reachable lab address; NAT needs an explicit port forward. The VM also needs outbound Atlas access. Keep SQLite rehearsal files/backups on local SSD, not a shared network folder. Test the actual VM address from a player PC.

## 5. Permit only the intended LAN port

Ask the lab administrator to allow inbound TCP 8080 on the host's trusted network. On a correctly classified **Private** network, an elevated PowerShell example is:

```powershell
New-NetFirewallRule -DisplayName 'Heist Lab TCP 8080' `
  -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8080 `
  -Profile Private -RemoteAddress LocalSubnet
```

Run this only on the host, once, with administrator authorization. If the managed lab uses the Domain profile or routed subnets, the administrator must choose the right profile/subnets; do not broaden it to all networks just to get it working. `LocalSubnet` may not cover routed VLANs.

No router internet port forwarding is needed for LAN play. Restrict `/admin.html` and `/metrics` through network/reverse-proxy rules as appropriate; metrics are not authenticated by the application. Organizer writes require a super-admin session or the optional legacy token; Reset requires a super-admin session. The bot fixture port is separate and not needed during an event.

## 6. Verify from host and player PC

Host browser: `http://localhost:8080/`. Host API: `http://localhost:8080/health`.

From a player PC, replacing the example with the real host IP:

```powershell
Test-NetConnection 192.168.1.50 -Port 8080
```

Open `http://192.168.1.50:8080/health`, then the game root. A successful health response alone does not test gameplay: register two separate accounts and verify movement, visible operators, a terminal, M atlas, and an unpaid practice challenge from two PCs.

If the port test fails: check host terminal, correct IP/profile/firewall rule, VPN routing, guest isolation, VM network mode and VLAN rules. If health works but the page is missing, rebuild the client. Do not open 5173 or disable the firewall as a shortcut.

## 7. Every player gets a separate account

Each player opens the **same host URL**, registers a unique username and password, then logs in. Do not give everyone one shared account: the game permits one active socket per account, and another login replaces the older session. A refresh can resume within the 30-second ghost window.

Use at most 40 participating accounts for this event. Network capacity and event enrollment are separate; raising `MAX_PLAYERS` does not raise the approved 40-player economy cap. Spectators/bot accounts should not occupy event slots. Registration is enabled by the launcher; after account preparation, an administrator may restart with `ALLOW_REGISTER=false` using the manual configuration. Existing logins remain available. A restart does not reset the clock or roster.

## 8. Organizer starts the clock once

On the host, sign in as `heist_superadmin`, open **SUPER ADMIN / CONTROL** and inspect the roster/audit. Only when everyone is ready select **Start Great Reset**. Lobby exploration/training does not start the prize event. The optional legacy `admin.html` remains available for token-based history inspection.

Keep organizer credentials off player PCs. Do not repeatedly press Start, delete databases, or rewrite ledger rows. Verify balanced pools; if an audit freezes the event, preserve logs/data and investigate. Withdrawals, fees, raids, minute-150 Checkout and final settlement retain their current server rules.

## 9. During and after the event

- Keep the host/VM awake and plugged in; schedule OS updates outside the event. Close video rendering, games, dev watchers and bot generators. Do not turn off security updates permanently.
- Reserve host resources. For a VM on a 16 GiB PC, start with **4 vCPU and 4 GiB RAM**, local SSD storage and enough host OS headroom. This is a starting allocation to measure, not a guarantee; increase it if reports show pressure. A native host is simpler.
- Prefer wired networking for the server. The artwork renders on player browsers; it is not encoded as a server-side video stream. Initial image downloads can still congest Wi-Fi, so preload player browsers before starting the clock.
- Monitor local `/health` and `/metrics`; meaningful gates and CPU definitions are in the testing guide. Monitor OS/VM RAM, SSD latency and NIC utilization too.
- After play, stop cleanly with Ctrl+C. Retain MongoDB event archives/history and arrange database backups, with logs and staff audit records. For SQLite rehearsals, back up both files while stopped or use consistent backup facilities. Keep credentials private.
- Real payouts require organizer action; the recorded allocation is not an automatic payment transfer.

HTTP is suitable only on a trusted isolated rehearsal LAN; passwords and organizer secrets are not encrypted in transit. Before use on an untrusted network or the internet, configure HTTPS/WSS, a domain/reverse proxy and appropriate access controls. This guide does not create a publicly exposed “universal internet server”; all lab players share one reachable LAN host.
