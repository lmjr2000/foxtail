# Foxtail edge agent

Use this only for a store whose recorder the Foxtail server cannot reach over the internet.

The agent runs on a small always-on computer on the store's network (a mini PC or a Raspberry Pi with
Node 20+ and ffmpeg). Every counting interval, while the store is open and counting is on, it grabs
one picture per counting camera from the recorder and sends it to Foxtail. Counting happens in the
cloud. Nothing is stored on the device, and the recorder password never leaves the store.

## Set up

1. In Foxtail, open **Store → Settings → Recorder & cameras**. Set the connection to **Edge agent**,
   save, add the cameras (recorder channel numbers), then click **Create edge token** and copy it.
2. On the store computer:

   ```sh
   git clone https://github.com/lmjr2000/foxtail && cd foxtail
   npm ci && npm run build -w @foxtail/shared -w @foxtail/edge-agent
   FOXTAIL_URL=https://<foxtail server> \
   EDGE_TOKEN=<token from step 1> \
   RECORDER_HOST=192.168.1.50 RECORDER_USER=admin RECORDER_PASSWORD=... \
   RECORDER_VENDOR=uniview \
   node apps/edge-agent/dist/index.js
   ```

3. Keep it running with a service manager (systemd, pm2, or Windows Task Scheduler).
   **Test connection** in Store settings shows when the agent was last seen.

| Variable | Meaning |
| --- | --- |
| `FOXTAIL_URL` | The Foxtail server address |
| `EDGE_TOKEN` | The store's edge token. Replacing it in Foxtail stops the old one immediately. |
| `RECORDER_HOST`, `RECORDER_PORT` | The recorder on the store network (RTSP port, default 554) |
| `RECORDER_USER`, `RECORDER_PASSWORD` | The recorder login |
| `RECORDER_VENDOR` | `uniview` (default, including EZCloud recorders), `hikvision`, `dahua`, `generic`, or `custom` |
| `RECORDER_PATH` | The stream path for `custom`, for example `/live/{ch}` |
| `RECORDER_STREAM` | `sub` (default) or `main` |
