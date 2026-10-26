# Local design playground

A dependency-free HTML/CSS/JavaScript alternative to the Figma review file. No build, login or Figma quota required.

From the repository root:

```sh
python3 -m http.server 4173 --bind 127.0.0.1
```

Open http://127.0.0.1:4173/preview/. Alternatively open `index.html` directly in a modern browser; assets use relative paths.

## Included

- Figma-inspired canvas, layer selection, inspector on wide screens and zoom controls.
- Nine watch states using the saved transparent plush head assets.
- Repeating breathing, listening waveform, thinking tilt, speech pulse, success bounce and error reaction.
- Connected simulated Calendar flow, explicit approval/cancel, restart, interrupt-speaking and failure injection.
- Motion toggle, intensity control, expression lab link, reduced-motion support and background-tab animation pause.

Controls and all account data are mockups. The page does not record audio, play speech or contact Calendar. Pip is a visual preview only. Preview canvas success repeats its gesture for comparison; the interactive demo plays the success bounce once.

This is design/prototyping work, not the native watchOS app. Still validate size, readability, battery use and real state-driven animation on the Watch SE 2.

## Character animation lab

Open http://127.0.0.1:4173/preview/animation/ for a continuously blended SVG facial rig on static plush artwork. See [lab notes](animation/README.md). The old full-image blink is disabled to prevent dark flashes.
