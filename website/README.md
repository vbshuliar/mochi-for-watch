# Mochi for Watch website

The public landing page is **https://mochi-for-watch.fly.dev/**. It uses Apple-style system typography, grouped surfaces and blue controls.

## Edit and preview

Edit `dist/index.html`, `dist/style.css`, and `dist/agent.md`. There is no frontend build or dependency installation. Mochi's artwork comes from `docs/design/mascot-head-v3.png` in the parent repository.

From this directory:

```sh
python3 -m http.server 4175 --bind 127.0.0.1 --directory dist
```

Open http://127.0.0.1:4175. The backend also serves the page at `/` when running normally.

## Deploy on Fly

From `website/`:

```sh
fly config validate
fly deploy --remote-only --ha=false
fly checks list
```

The public website runs at **https://mochi-for-watch.fly.dev/** in a separate 256 MB static-server machine. It starts on demand and stops when idle; this adds Fly compute/storage/traffic usage. No volume, app credentials, or provider keys are copied into it.

The Watch backend remains at `https://muse-for-watch-vlad.fly.dev/`, so installed apps and OAuth callbacks do not need changing. Its original landing page remains available; to update that copy, stage and deploy from `backend/` as documented in `docs/private-deployment.md`.

The earlier owner-private Sites preview is separate. `.openai/hosting.json` records its identity; Fly is now the primary website, and Fly deployments do not update that preview.

The hero uses the native Mochi face plate with SVG eyes at the coordinates from `MochiView.swift`. `dist/mouse-gaze.js` animates the eyes, blinks and head, eases the confused reaction in and out, and shows the visitor’s local time. Motion respects reduced-motion preferences. The display shows the idle caption and page indicators; hardware is the generated transparent `dist/assets/watch-3d.png` image. Generation details are in `IMAGE-PROMPT.md`.

The fixed Human / Agent control switches between the website and an embedded Markdown view. `/agent.md` remains the downloadable reference for users and coding agents. The `.md` file is served as UTF-8 plain text so browsers show the source directly. Keep its setup commands and architecture notes aligned with the repository.

After editing `dist/agent.md`, run `node scripts/sync-agent.mjs` from `website/` before deploying. Backend website staging also syncs this embedded copy automatically.

After each commit, deploy this website and verify the public page and its JavaScript. Include `mouse-gaze.js` in both the Docker copy list and `.dockerignore` allowlist.

## Previous website address

After the new website is healthy, deploy `Dockerfile.redirect` to the previous static-site app. It redirects page paths and former portrait URLs to the new domain. Keep the private backend's origin and OAuth callbacks stable. This redirect contains no app credentials or legacy character assets.
