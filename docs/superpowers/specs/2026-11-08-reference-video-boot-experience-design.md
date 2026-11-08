# Reference-Video Boot Experience Design

Date: 2026-11-08  
Status: User-approved design, pending written-spec review  
Product: PROJECT ZERO — REI PRIVATE THEME

## Objective

Replace the current generic EVA-inspired boot page with a high-fidelity, usable recreation of the startup sequence shown in the user-supplied reference recording. High fidelity applies to the complete visible and audible inventory: icons, mark placement, hexagonal node geometry, labels, typography hierarchy, colors, scan motion, progress motion, authorization card, sound cues, cue timing, and final transition. The result must behave as a real application startup rather than a decorative video: it plays full-screen, synchronizes its visuals to the reference soundtrack, waits for the actual Codex backend, accepts pilot confirmation, and then reveals the functional PROJECT ZERO workbench.

The sequence must retain a visible skip action. Skipping compresses the presentation but never fabricates backend readiness.

## Reference and Success Criteria

The supplied reference is a 28.067-second, 592×1280 H.264/AAC mobile recording containing a landscape startup sequence. The useful startup section is approximately 2.0–22.5 seconds. It establishes these required beats:

1. A pale ice-blue NERV system-wake screen with a central mark and symmetric hexagonal status nodes.
2. An orange scan field rising through the screen and receding.
3. A circular synchronization display progressing to 99.2%, with status nodes activating around it.
4. Pilot authorization followed by 100% completion.
5. A connection state that transitions into a real workbench.

Success requires all five beats, the complete scene-detail inventory, synchronized sound, a full-screen-to-window transition, a working skip path, a real 99.2% readiness gate, and an operational workbench after completion. A static background, generic science-fiction cockpit, abstract helmet, approximate icon set, substituted system labels, unsynchronized sound effects, or continuously spinning progress circle does not satisfy the design.

## Selected Approach

Use a hybrid high-fidelity recreation:

- Rebuild the visible interface with a Retina-scaled Canvas 2D scene plus local DOM/CSS/SVG controls so it remains crisp and can reflect real application state. The canvas owns the continuous NERV mark, scan field, status-node, ring, label, and handoff animation; accessible pilot confirmation, skip, retry, live diagnostics, and workbench controls remain DOM.
- Use the soundtrack extracted from the useful startup section of the supplied recording as the animation's master clock. The selected private build preserves the sounds already present in that section, including any speech or compression artifacts.
- Keep the NERV-derived mark, Rei artwork, and extracted soundtrack in a local private theme package. They must not be committed to or published from the public repository.
- Publish the complete animation engine, timeline format, tests, documentation, and freely redistributable placeholders.

Direct playback of the mobile recording is rejected because cropping its embedded landscape content would be visibly low-resolution, would retain phone/social UI, and could not represent actual readiness. A fully independent recreation with newly designed audio is rejected because the user explicitly selected the reference soundtrack.

## Windows Workbench Reference and Code Reuse

The user also selected the public Windows reference repository at `https://github.com/Iris-change/eva-codex-workbench`, reviewed at commit `b12753e063d6b8752b4e0994e851d5cc0950f85b`. Its useful implementation patterns are:

- `unified-sequence.js`: one continuous Canvas 2D stage rather than disconnected cards;
- `sequence-timing.js`: a single approximately 20-second shared timeline;
- `sequence-audio.js`: decode one complete local track and expose stable playback/seek time;
- `motion-v12.js`: deterministic easing, loop, ping-pong, and scan-position functions;
- `boot-atmosphere.js`: symmetric, time-stable peripheral hexagonal lamps;
- `stage-layout.js`: a persistent central anchor and responsive ring geometry;
- `intro-cg.js`: high-DPI buffer sizing and a clean handoff from boot scene to workbench.

The implementation may adapt those MIT-licensed code structures and algorithms with explicit notice and source attribution. It must not copy the Windows theme's UNIT-02/Asuka identity or dark red visual direction. It must also not assume that media included by the upstream repository is MIT: its NERV-derived mark is separately attributed, and its voice recording has repository-specific authorization. This project therefore keeps its selected NERV/Rei media and reference soundtrack in the local private package and does not redistribute the upstream media.

## Secondary Motion Reference

The user supplied a second 27.433-second, 592×1280 H.264/AAC mobile recording of a Kamen Rider-themed workbench solely as an interaction and motion reference. It contributes these engineering observations:

- side status nodes activate in a legible cascade rather than all at once;
- a compact system-information check can establish state before authorization;
- a short full-field authorization flash clearly separates phases;
- progress-ring motion and peripheral node activity share the same timeline;
- the completion flash, title return, access-granted state, and workbench reveal form one continuous handoff;
- a small persistent character identity can connect the startup sequence to the final workbench without covering controls.

This recording is secondary. The EVA reference remains the visual, iconographic, color, label, timing, and audio baseline whenever the references differ. No Kamen Rider logo, character, lime-green palette, wording, sound, or extracted media enters the product. Effects observed only in the secondary reference may be used only when they reinforce an existing EVA beat; they must not add a sixth stage or change the approved 20.5-second sequence.

## User Experience

### Normal startup

1. Launch into a borderless full-screen presentation on the current display.
2. Play the startup timeline and private reference soundtrack together.
3. Reach 99.2% and present `REI AYANAMI / PILOT 00` authorization.
4. Permit authorization only when the local Codex backend reports exact `READY` state. If presentation reaches 99.2% first, hold there without looping.
5. After authorization, advance to 100%, show the connection phase for approximately five seconds, and perform a 180 ms fade-through-black.
6. Exit full-screen, restore a normal resizable workbench window, and reveal the already-mounted functional PROJECT ZERO workbench.

### Skip behavior

- A subdued `SKIP / 跳过` control remains visible in the top-right corner throughout the presentation.
- `Escape` invokes the same action.
- Skip fades the soundtrack over 150 ms, cancels decorative timeline work, and advances the presentation to its 99.2% gate.
- If the backend is already ready, skip proceeds to pilot authorization. If it is not ready, the application remains at 99.2% with a safe readiness status and retry action.
- Retry does not replay the full presentation.

### Reduced motion

When macOS reduced-motion preference is active, retain the same semantic stages but replace large scan and orbit movement with short cross-fades. Sound remains controlled by the user's existing audio setting. Skip and readiness behavior remain identical.

## Timeline

The implementation timeline is relative to the cropped startup soundtrack rather than the original mobile file:

| Relative time | Stage | Required visuals |
| --- | --- | --- |
| 0.0–3.5 s | Wake | NERV mark fade-in, system-wake text, symmetric hex nodes appear in sequence |
| 3.5–8.5 s | Scan | Orange field rises and recedes; system-check labels and node states change |
| 8.5–15.5 s | Synchronize | Circular display grows from 0 to 99.2%; left/right status nodes activate |
| 15.5 s | Authorization gate | Hold at 99.2%; show Rei / Pilot 00 authorization and wait for real readiness plus user confirmation |
| Confirmation + 0–5 s | Connect | Reach 100%; show workbench connection state and waiting indicator |
| Completion | Transition | 180 ms fade-through-black, leave full-screen, reveal workbench |

All visual cues live in a declarative timeline manifest containing start/end times, scene identifiers, text keys, icon states, node states, progress values, scan positions, and transition parameters. Presentation code interprets this manifest; it does not contain separate ad hoc timeouts for each effect. Canvas geometry and animation helpers adapted from the Windows reference remain pure functions of viewport and timeline time, so every captured keyframe is deterministic.

## Visual System

### Boot presentation

- Base surface: pale ice blue and cool white.
- Primary status color: desaturated cyan-blue.
- Scan and alert accent: restrained EVA orange.
- Completion accent: muted green.
- Composition: central mark or synchronization ring, symmetric vertical hexagonal status banks, narrow technical labels, and generous empty space.
- Typography: a local system-safe serif for prominent system headings, system sans-serif for status text, and monospace for codes and percentages.
- Motion: staged fades, node activation, a bottom-up scan field, circular progress, and final whole-surface transition. Avoid parallax, neon bloom, generic cockpit framing, and helmet abstractions.
- Phase punctuation may use a brief bounded full-field flash, and node activation should cascade with the central ring, as learned from the secondary motion reference. The flash color and density remain EVA ice/orange rather than lime green.

### Rei identity

- The boot sequence identifies the pilot as `REI AYANAMI / PILOT 00`.
- The normal workbench uses the approved side-profile half-body Rei artwork as a private, low-interference theme layer.
- Rei remains supporting visual identity rather than obscuring conversation, terminal, Git, plugin, or settings controls.
- Public builds replace Rei and NERV-derived artwork with original placeholder assets while preserving the exact layout and theme hooks.

## Architecture

### `BootDirector`

Owns the presentation state machine and interprets the declarative timeline. It exposes start, authorize, skip, retry, and destroy operations. It is the only component allowed to advance visible presentation stages.

### `AudioClock`

Loads the private soundtrack through the existing authenticated loopback service. During normal playback, `HTMLAudioElement.currentTime` is the authoritative presentation time. If playback is unavailable or the file fails validation, it switches once to a monotonic silent clock, exposes a non-sensitive muted state, and allows the visual sequence to continue.

The local soundtrack is decoded once through Web Audio, following the reviewed Windows reference's no-range playback pattern. `AudioClock` exposes the decoded track's stable position as presentation time and supports pause, seek, segment start/end, fade, and close. The private soundtrack manifest records its media type, byte length, selected duration range, and SHA-256 digest. The server serves only the selected theme's declared file, with bounded size and fixed MIME handling.

### `BootCanvas`

Owns the high-DPI Canvas 2D presentation. It uses a fixed logical design space, clamps device pixel ratio to 2, and resizes backing buffers without changing timeline time. A single centered anchor persists from NERV wake mark to synchronization ring, matching the reference sequence. The orange scan layer, its wave edge, status-node pulses, thin system grid, icon states, and final connection frame are derived only from the sampled timeline snapshot. DOM controls are composited above the canvas and never rendered into it.

### `ReadinessGate`

Consumes the existing redacted health snapshot. Presentation time may approach but never pass 99.2% until health is exactly `{ready: true, code: "READY"}` and the user authorizes. Stale health requests cannot restore readiness after disconnect or retry.

### `WindowDirector`

Enters borderless full-screen before showing the boot surface and restores a normal resizable window only after the completion fade begins. It stores safe normal bounds, rejects navigation away from the local origin, and prevents white flashes by keeping an opaque transition layer mounted until the workbench is painted.

### Private theme provider

The local private package declares boot mark, Rei portrait, workbench background, and reference soundtrack. Import and packaging retain the existing path, type, size, digest, symlink, and traversal checks. The public tree cannot discover or copy these bytes.

### Existing workbench

Conversation, terminal, Git, plugins, themes, diagnostics, and Codex session lifecycle remain separate from the presentation modules. The redesign must not change their external APIs. The workbench may mount behind the presentation so the final transition reveals an already-ready interface.

## Failure and Cleanup Behavior

- Backend not ready: remain at 99.2%, present a stable redacted code and retry control, and do not replay audio.
- Soundtrack missing, invalid, or blocked: use the monotonic silent clock; diagnostics name only a stable error code.
- Skip: cancel animation frames, fade and pause audio, and continue through the readiness gate.
- Retry: invalidate stale health work, perform one serialized reinitialization, and resume at the gate.
- Application close: stop audio, animation frames, timers, network polling, terminals, and the Codex child. Do not release ownership records until each owned process or listener confirms exit; retain the existing bounded forced-exit fallback.
- Full-screen transition failure: keep the workbench usable in the current window mode and expose a stable local diagnostic rather than failing startup.

## Validation

### Timeline and visual tests

- Unit-test manifest ordering, overlap policy, duration bounds, progress monotonicity, required semantic stages, and the exact 99.2% gate.
- Capture deterministic frames at relative times 0, 1.5, 3.5, 5.5, 8.5, 10.5, 12.5, 15.5 seconds, immediately after authorization, and immediately before completion.
- Review normalized landscape crops of those frames beside the reference for the complete inventory: icon count and shape, mark size and location, scan position and edge, node activation, ring progress, label text and placement, type hierarchy, authorization-card geometry, color relationships, and transition state. A scene is not accepted while any listed element is absent or replaced with a generic substitute.
- Treat the Windows reference implementation as an engineering reference, not the visual baseline. Its UNIT-02/Asuka colors, labels, warning density, and armor perimeter must not leak into the Rei/video visual result.
- Treat the Kamen Rider recording as a motion-reference checklist only. Verify node cascade, phase separation, continuous handoff, and persistent pilot identity, while rejecting its logo, character, lime palette, text, sound, and media.
- Exercise 1440×900 and 2560×1600-equivalent Retina layouts with no white border, page scrollbar, or visibly scaled raster UI.

### Audio tests

- Verify the private file's digest, duration, declared type, and bounded size before packaging.
- Verify timeline cue alignment against audio time with a target maximum error of 80 ms.
- Verify a 150 ms skip fade, terminal pause, no double playback, and silent-clock fallback.

### End-to-end tests

- Complete normal playback through authorization into a usable workbench.
- Hold at 99.2% while backend readiness is unavailable.
- Complete after delayed readiness without replaying earlier stages.
- Skip using both the visible control and `Escape`.
- Retry after a backend failure.
- Close and reopen without `startup failed`, lingering listener, audio, terminal, or Codex child.
- Confirm that the resulting workbench can send a Codex turn and open a terminal.

### Public/private boundary tests

- Fail the public verification if tracked files, package output, documentation examples, or diagnostics contain private soundtrack bytes, NERV-derived files, Rei artwork, private absolute paths, or private package identifiers.
- Build the public placeholder application and private local application in isolated staging directories.
- Confirm the installed private ASAR matches the freshly built private artifact.

## Release and Rollback

1. Implement with unit tests and deterministic timeline fixtures.
2. Run visual frame capture and full end-to-end flows.
3. Build the local private package.
4. Move the currently installed application to a uniquely named Trash backup.
5. Install the new package at the existing application path.
6. Perform one real full playback and one skip playback, confirm exact `READY`, and verify the workbench.
7. Push only the public tree and documentation to GitHub.

If the installed application cannot reach `READY`, cannot play or safely fall back from audio, cannot leave full-screen, or cannot expose a usable workbench, restore the previous application. Installation must not modify user projects, official Codex account data, or existing persisted workbench state.

## Deliverables

- A locally installed REI private application with the high-fidelity startup sequence and functional PROJECT ZERO workbench.
- A public repository containing the animation engine, placeholder assets, tests, build workflow, theme contract, and installation/recovery documentation.
- A private local theme package containing the user-selected NERV/Rei assets and extracted reference soundtrack, excluded from version control and public artifacts.
- A third-party notice identifying the reused Windows repository commit and the exact adapted source modules, without claiming its separately licensed media under this project's MIT license.
