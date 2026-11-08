# Local theme packs

PROJECT ZERO imports private themes from a local directory into its Application Support sandbox. Imported files are never copied into the repository, diagnostics, settings exports, or public builds.

Each pack contains an exact `manifest.json` plus only the assets referenced by it. The manifest accepts `schemaVersion`, `id`, `name`, `author`, `colors`, `background`, `portrait`, and `audio`. Images may be PNG, JPEG, or WebP; audio may be WAV, MP3, or M4A. URLs, HTML, SVG, CSS, JavaScript, symbolic links, path traversal, and undeclared files are rejected.

Example:

```json
{
  "schemaVersion": 1,
  "id": "my-local-theme",
  "name": "My Local Theme",
  "author": "Local user",
  "colors": {"accent": "#55a5b8", "surface": "#edf6f7"},
  "background": "background.webp",
  "portrait": "portrait.png",
  "audio": null
}
```

Only import assets you are entitled to use. Sharing the application or logging into the same Codex account does not synchronize private theme files to another Mac.
