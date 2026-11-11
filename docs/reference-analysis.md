# Boot reference analysis

## Reference priority

The supplied EVA startup recording is the sole primary reference for the boot
presentation's icon inventory, composition, mark position, color relationships,
Chinese and Japanese technical labels, typography hierarchy, pacing, progress
motion, scan motion, and sound timing. When another reference disagrees with it,
the EVA recording wins.

The public Windows project
[`Iris-change/eva-codex-workbench`](https://github.com/Iris-change/eva-codex-workbench)
at the inspected `origin/main` commit
`9733eb192e8ef97d3e7469ede544cad2a6186519` is an engineering reference only.
Its MIT-licensed structure, timing algorithms, and motion code inform this
implementation. The public history at that commit is only the red and black Asuka
presentation; it is not a source for a light-blue EVANGELION-00 presentation.
That EVANGELION-00 source remains private and is not published upstream.

The supplied Kamen Rider recording is a secondary motion reference only. It
contributes four interaction observations: readable node cascades, a short
authorization flash, progress-linked peripheral activity, and a continuous
completion handoff. It does not contribute branding, characters, palette,
wording, sound, or media. Those observations cannot add a new stage or override
the primary recording.

## Public and private media boundary

The public renderer draws an original `PROJECT ZERO / SYSTEM 00` fallback mark
from Canvas paths and text. A separately validated private mark may be injected
as an already loaded browser image object. If that draw fails, the same original
public mark is drawn, so the visual anchor never becomes blank.

The public source boundary is explicit: MIT covers only the inspected code
structure, timing algorithms, and motion code; `unit02-mincho-black.woff2` is
OFL material with its separate notice. NERV branding, Rei character material,
and the reference soundtrack are private-only and are not MIT. The light-blue
EVANGELION-00 source is private, not published upstream, and cannot be inferred
from the public red and black Asuka history.

This document intentionally contains only written analysis. It embeds no video
frames, extracted sound, or identifying social metadata.
