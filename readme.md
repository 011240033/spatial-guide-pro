# Spatial Guide

Spatial Guide is a small web app for making a visual, navigable guide to a
building or other indoor space. A person can add panoramic photos or a walk
video, let the app suggest room names and connections, review the results, and
then explore the space as an interactive tour. On a supported phone, the app
can also use the camera and compass to help someone find a room.

This guide is written for someone new to the project. It explains what the app
does, how its main parts work together, and what each file is for.

## What the app can do

- Create a tour from panoramic photos, a guided camera sweep, or video.
- Use in-browser AI to suggest room names and connect nearby spots.
- Let the tour creator review room names and links before saving.
- Browse a tour as a collection of interactive panoramic views.
- Search for a room by typing or, in supported browsers, speaking.
- Show camera-based directions, WebXR paths on supported devices, and compass
  screen-arrow guidance with room-sign/QR re-checkpoints on other phones.
- Save tours on the current device, export and import `.sgtour` files, and
  optionally upload tours to create a shareable link and QR code.
- Cache the app shell as a progressive web app (PWA), so it can reopen when
  offline. AI models and shared tours still need the network when they have not
  already been downloaded.

## How to use it

1. Open Spatial Guide in a modern browser. On a phone, use a secure website
   (HTTPS) or `localhost` so the browser can grant camera and motion access.
2. Select **Create a tour** and give the space a name. Add a floor number when
   the space has multiple floors.
3. Choose a capture method: a guided sweep, a quick 180-degree sweep, existing
   panoramas, recording a walk, or uploading a video.
4. Select **Build my tour**. The app examines the images or extracted video
   frames, suggests room names, and works out which spots connect.
5. Review the suggested names and connections. Correct names if needed, preview
   the tour, and save it.
6. Open a saved tour to explore its panoramas. Choose a room, search, or use
   **AR directions** on a phone to navigate.
7. Keep the tour on this device, export it as a `.sgtour` file, or use **Share
   link** to upload it and make a link/QR code for others.

Tours are saved in the browser's local IndexedDB storage, not in a user account.
Clearing browser/site data can remove local tours, so export a backup if one is
important. Imported or shared tours are also saved locally after they are
opened.

## How the pieces fit together

`index.html` defines the screens, buttons, inputs, and places where the tour,
camera, and AR overlays appear. It loads the stylesheet, third-party viewer and
QR libraries, and then starts `js/app.js`.

The JavaScript is split into browser modules. `app.js` connects the home screen
to the builder, tour viewer, and AR directions. The builder uses `capture.js`
to obtain images or video frames, and `ai.js` to analyze them and build a
connected set of tour spots. `db.js` saves tours in the browser. `viewer.js`
displays them, while `ar.js` and `xr.js` provide different kinds of directions.
`share.js` handles optional online sharing. `ui.js` and `voice.js` provide
small shared helpers.

## Project files

### Top-level files

- **`index.html`** — The app's page and interface. It contains the home screen,
  tour builder, camera capture screens, panoramic tour viewer, and AR screen.
  Its element IDs are used by the JavaScript modules to find and update the
  right controls. It also loads Pannellum for panoramas, QRCode for QR images,
  the app stylesheet, and `js/app.js`.
- **`manifest.webmanifest`** — PWA information used when installing the app:
  its name, launch location, display style, theme colors, and icon files.
- **`sw.js`** — The service worker. It caches the app's local HTML, CSS, and
  JavaScript files so the app shell can load again without a network
  connection. It removes older app-shell caches during updates and caches
  successful GET responses when appropriate. It deliberately does not
  intercept non-GET requests or requests to Hugging Face and Supabase.
- **`readme.md`** — This project and usage guide.

### `css/`

- **`css/style.css`** — The app's visual design and layout: colors, buttons,
  forms, tour cards, panorama area, camera screens, AR overlay, and responsive
  spacing. It also accounts for phone safe areas around the screen edges.

### `icons/`

- **`icons/icon-192.png`** — The 192-pixel app icon referenced by the PWA
  manifest and as the Apple touch icon.
- **`icons/icon-512.png`** — The larger app icon referenced by the PWA
  manifest.

### `js/`

- **`js/app.js`** — The starting point for the app. It loads the saved tour
  list, handles creating, deleting, and importing tours, registers the service
  worker, and opens a shared tour when the page URL contains a share code.
- **`js/ui.js`** — Two small interface helpers: `$` finds an element by its
  HTML ID, and `show` displays one app screen while hiding the others.
- **`js/db.js`** — Local persistence and tour files. It creates the IndexedDB
  database named `spatial-guide`, stores tours and unfinished builder drafts,
  and converts tour images to and from data URLs when exporting or importing
  `.sgtour` files.
- **`js/config.js`** — The Supabase project URL and publishable client key used
  by online sharing. This is browser-side configuration, not a private
  server-side secret. Sharing also depends on the Supabase storage endpoint and
  its access policies being set up to allow the operations used by the app.
- **`js/builder.js`** — The tour-creation workflow. It accepts capture results,
  keeps photo drafts between visits, extracts frames from video, calls the AI
  analysis, connects spots, suggests names, and shows a review screen. From the
  review screen, the creator can preview, save, or save a floor and start
  another.
- **`js/capture.js`** — Camera and video input. It creates a panorama by
  stitching together camera slices as the phone turns, can record a walk while
  periodically showing AI room-name guesses, and extracts usable frames from
  uploaded video by filtering dark, blurry, and near-duplicate frames.
- **`js/ai.js`** — The image-analysis and navigation logic. It loads
  Transformers.js models in the browser to compare scenes, suggest room names,
  recognize objects and signs, estimate open space, and locate a camera view
  within a tour. It also builds links between spots, finds a room from a text
  query, and calculates routes through the links. Large per-image matching
  data is discarded after it is no longer needed.
- **`js/viewer.js`** — The interactive tour display. It gives each panorama to
  Pannellum, adds clickable direction arrows, switches between rooms and
  floors, supports search and voice input, and provides arrow editing, export,
  share, and QR actions.
- **`js/ar.js`** — Phone-camera directions. It uses the camera to identify the
  visitor's current tour spot, reads compass/motion direction, finds a route
  through the tour, and draws a moving path on the camera view. It can hand off
  to the WebXR path when available. A temporary Diagnostics panel on the
  “Where am I?” screen shows model/camera activity, scene-match scores, and
  errors while testing; it can be removed after debugging is complete. Scene
  matching can use a confident room-content label (such as Bedroom) to break a
  close visual tie between similarly located spots.
- **`js/xr.js`** — The optional WebXR immersive-AR path. It checks floor
  surfaces using the device's hit-test feature and places directional markers
  in the camera-based AR view.
- **`js/voice.js`** — Shared browser speech helpers. It starts speech
  recognition for spoken searches and uses speech synthesis to read
  directions. Browser support varies.
- **`js/graph.js`** and **`js/route.js`** — The mapped navigation graph,
  checkpoint metadata, route planning, and route-following logic.
- **`js/mapper.js`** and **`js/navigate.js`** — AR map recording and map-based
  navigation. Maps can include printable QR checkpoints for compass-based
  screen-arrow guidance on phones without WebXR floor tracking. If the browser
  grants WebXR raw camera access, the mapper captures only at marked rooms and
  checkpoints, then runs CLIP after the AR session ends to avoid slowing tracking.
- **`js/share.js`** — Online tour sharing. It uploads tour images and JSON
  metadata to Supabase Storage, creates the share URL, and downloads and saves
  a shared tour when someone opens that URL.

## Data, privacy, and network use

- **Local tours:** Tour data and images are stored in the browser's IndexedDB.
  They remain on that browser/device unless the user exports or shares them.
- **AI:** Analysis runs in the browser using Transformers.js and models
  downloaded from the Xenova/Hugging Face model host. OCR uses Tesseract.js
  loaded from a CDN. Model downloads can be large and the first analysis may
  take time. These model and library downloads need an internet connection;
  the service worker excludes Hugging Face model requests from its fetch
  handling.
- **Sharing:** Sharing uploads the tour images and metadata to the configured
  Supabase Storage project. Anyone with the resulting link can retrieve the
  shared tour if the storage setup permits public reads. Do not share sensitive
  images or locations unless that is intended.
- **Device features:** Camera capture and AR need camera permission. Guided
  sweeps and AR directions also use device orientation/motion where available.
  Immersive AR requires a browser and device that support WebXR hit testing.
  Voice input depends on browser speech-recognition support.
- **External libraries:** `index.html` loads Pannellum and QRCode from jsDelivr.
  `js/ai.js` loads Transformers.js from jsDelivr and Tesseract.js when OCR is
  needed. `js/navigate.js` loads jsQR only if native QR scanning is unavailable.
  `js/xr.js` loads Three.js from jsDelivr.

## Running the project

There is no package manifest or build step in this project. Serve the project
folder with any static web server and open its URL in a browser. Do not open
`index.html` directly as a `file://` URL: JavaScript modules, service workers,
camera access, and device motion require a web origin, and camera/sensor
features generally require HTTPS except on `localhost`.

For example, if Python is installed, open a terminal in the project folder and
run:

```text
python -m http.server 8000
```

Then visit `http://localhost:8000`. This is enough to load the page, but the
camera and AR behavior still depends on browser/device permissions and
capabilities. Online sharing additionally depends on the Supabase configuration
in `js/config.js`.

## Current limitations to keep in mind

- AI suggestions are guesses. Always review room names and connections before
  relying on a tour for navigation.
- A panorama import needs wide panoramic images; the analyzer rejects images
  that are not wide enough. A tour needs at least two usable spots.
- Camera, compass, voice, and WebXR features are not supported uniformly by
  all browsers and devices.
- Offline mode covers the app shell and data already saved locally. It does
  not guarantee that AI models or a not-yet-downloaded shared tour are
  available offline.
## Design system

The look follows the "true-black flat" style from the taste-skill app-screen chapter (sheet saved in
`.taste-skill/app-sheet.md`). The tokens live at the top of `css/style.css`.

- Elevation is a lightness step: `--ground` #000, `--surface` #111, `--raised` #2a2a2a. No card borders or shadows.
- The one filled button on a screen is the primary action, white with a black label. `.ghost` is the outlined secondary.
- `--accent` (#4da3ff, the arrow in the icon) is the only hue, used on the arrow mark and route glyphs only.
- Inter is self-hosted in `fonts/` so the app shell works offline (it is in the service-worker cache).
- Always keep `[hidden]{display:none!important}`: the app toggles the `hidden` attribute on buttons.
- Unused controls kept hidden in `index.html`: `#arStart`, `#arFloor`, `#arScan` (nothing in `js/` uses them yet).

## Navigate (the FESTU.Navigator-style flow)

Scan a room sign, confirm the number, pick a destination, then follow AR or screen-arrow guidance.

1. **Map a space** (Navigate tab). Recording needs WebXR: Chrome on an ARCore-supported Android phone, Google Play Services for AR,
   and HTTPS. Stand facing a sign, tap *Mark room*, type the number on the keypad. Walk the corridor and mark each room you pass.
   At each junction, tap *Add QR checkpoint*. The app downloads a QR image: print it and place it at that junction, facing the
   corridor. Breadcrumbs every 1.2 m become the graph; walking back over old ground snaps onto existing nodes, so branches and
   loops form on their own. When supported, snapshots from marked spots are labeled after the AR walk using CLIP; these are
   suggestions, not room identifiers. *Finish* saves. Unsupported phones can still open maps and preview or simulate routes.
2. **Scan a sign**. Tesseract.js reads the room number (loaded on first use). Confirm it, or choose *Type the number*.
3. **Pick a destination** from the searchable list, preview the route on the map, or *Simulate the walk* (works on any device).
4. **Start AR or arrow guidance**. On a WebXR phone, stand where you scanned the sign, facing it. The route is A* over the graph,
   smoothed (Chaikin) and resampled every 0.5 m. 14 chevrons show ahead; leaving the route by 3 m for 1.5 s re-routes.
   On phones without WebXR, compass guidance shows a screen arrow toward the next marked room or QR checkpoint. Scan the sign or
   QR at junctions to re-anchor. This fallback does not track walking progress between scans, so mark QR codes at turns and
   follow posted building signs if the arrow is unclear.

Files: `graph.js` (map model, recorder, import validation), `route.js` (A*, smoothing, alignment, walker), `minimap.js`,
`ocr.js`, `xrkit.js` (WebXR + three.js), `navigate.js`, `mapper.js`. Maps export and import as `.sgmap` JSON.

Heading convention: yaw 0 faces -z, positive yaw turns left. Entry nodes store the heading you faced when marking.

### Tests

`node tests/logic.test.mjs` covers the graph, A*, smoothing, alignment, walker, recorder and map import (15 tests).
The AR layer (`xrkit.js`) has no automated test: it needs a real WebXR device.

### Known limits

- The AR heading comes from how you face the sign, so it is only as good as how squarely you stand to it. Recalibrate at
  the next sign if arrows drift. Corridors are matched by position only, with no visual re-localisation.
- A map is one floor of one building. Routes between floors or buildings are not supported.
- Screen-arrow guidance needs a usable device compass and camera permissions. It cannot track walking progress between scanned
  signs/checkpoints, and depends on QR codes being printed and placed correctly.
- CLIP sample capture during mapping depends on the browser's optional WebXR `camera-access` support. If unavailable, AR mapping
  still works, but no CLIP suggestions are produced. Mapping diagnostics report AR update rate and map-step processing time.
- iOS has no WebXR, so map recording is Android-only. Route preview and the simulator work everywhere; screen-arrow guidance
  works on other phones only when their browser exposes a compass.
