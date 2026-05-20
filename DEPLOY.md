# Polyblast Arena Online Deployment

The project has two deployable parts:

- Static Phaser game site: `index.html`, `phaser.js`, `src/`, `assets/`
- Multiplayer WebSocket server: `server/multiplayer-server.js`

## 1. Deploy The Multiplayer Server

Use Render or Railway as a Node.js web service.

### Render

1. Push this folder to a GitHub repo.
2. In Render, create a new **Web Service** from the repo.
3. Use these settings:
   - Runtime: `Node`
   - Build command: leave empty or use `npm install`
   - Start command: `npm start`
4. Deploy.
5. Copy the service URL. It will look like:
   `https://polyblast-server.onrender.com`
6. Your WebSocket URL is the same host with `wss`:
   `wss://polyblast-server.onrender.com`

### Railway

1. Push this folder to GitHub.
2. Create a Railway project from the repo.
3. Railway should detect Node.
4. Use start command:
   `npm start`
5. Copy the public service URL and convert it to `wss://...`.

## 2. Point The Game To The Online Server

Open:

`src/onlineConfig.js`

Set:

```js
export const onlineConfig = {
    multiplayerServerUrl: 'wss://your-server-url'
};
```

For local/LAN testing, leave it blank.

## 3. Deploy The Phaser Game Site

You can use Netlify, Vercel, Firebase Hosting, Render Static Site, or any static web host.

Upload/deploy these files and folders:

- `index.html`
- `phaser.js`
- `src/`
- `assets/`
- `_headers` if using Netlify

Do not deploy only `index.html`; the game needs the scripts and sprite sheets too.

## 4. Update Firebase Auth

If you use Google login, add your hosted game domain to Firebase:

Firebase Console -> Authentication -> Settings -> Authorized domains

Add your site domain, for example:

`polyblast-arena.netlify.app`

## 5. Quick Online Test

1. Open the hosted game site.
2. Enter the same room code on two devices.
3. Click `Multiplayer`.
4. Both players should appear in the same shared room.

## Notes

The current multiplayer server stores rooms in memory. That is okay for a small test, but rooms reset when the service restarts. For larger online play, add persistent/shared state such as Redis and a more formal matchmaking/lobby layer.
