# Test with a friend over the internet

1. Start the normal built game server on port 8080 and leave it running. This
   tunnel does not start/reset an event or change MongoDB data.
2. Put `NGROK_AUTHTOKEN=your-token` in the root `.env` (ignored by Git). Never
   share that file or put the token in frontend configuration.
3. From the repository root, run `npm run tunnel` in a second terminal.
4. Share the printed `GAME_PUBLIC_URL` HTTPS address with your friend. Both
   players use that same address, with different player accounts. If ngrok
   displays its standard informational welcome page, choose **Visit Site**.
5. Sign in through **Enter City**, or use **New Operator** to register if
   registration is enabled. Admission still follows the current live event's
   roster/capacity rules; a tunnel does not bypass them. An organizer can manage
   the event locally at `http://localhost:8080/`.
6. Keep the host PC awake, its internet connected, and both terminals running.
   Ctrl+C in the tunnel terminal ends internet access without stopping the game.
   Run `npm run tunnel` again to reconnect and use its newly printed address.

The existing frontend uses same-origin HTTP APIs and selects `wss://` for the
multiplayer socket when the page uses HTTPS; no separate WebSocket URL or Vite
tunnel is needed. The public endpoint allows the player login/register/map/event/
account APIs, `/ws`, and built game assets only. It returns 404 for metrics,
debugging, staff HTTP tools, the map painter, and all other paths. Local organizer
access is unchanged. Keep this player-only restriction when extending routes.

The URL is public, not invitation-only. Share it privately and use strong player
passwords. Treat this as a short playtest; account-specific ngrok bandwidth,
request and endpoint limits apply. Large city artwork can use substantial
transfer. Rotate an authtoken if it has been shared in a chat or screenshot.

This uses the [official ngrok Node SDK](https://github.com/ngrok/ngrok-javascript)
and its [Traffic Policy custom-response action](https://ngrok.com/docs/gateway/traffic-policy/actions/custom-response).
