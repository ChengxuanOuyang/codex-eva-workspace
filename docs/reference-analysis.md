# Boot reference analysis

## Reference priority

The supplied EVA startup recording is the sole primary reference for the boot
presentation's icon inventory, composition, mark position, color relationships,
Chinese and Japanese technical labels, typography hierarchy, pacing, progress
motion, scan motion, and sound timing. When another reference disagrees with it,
the EVA recording wins.

The public Windows project
[`Iris-change/eva-codex-workbench`](https://github.com/Iris-change/eva-codex-workbench)
at commit `b12753e063d6b8752b4e0994e851d5cc0950f85b` is an engineering reference only.
Its MIT-licensed continuous-stage, symmetric-node, and central-anchor structures
inform this implementation. Its visual identity, marks, character media, audio,
fonts, and other media do not define this product and are not included by that
code reuse notice.

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

This document intentionally contains only written analysis. It embeds no video
frames, extracted sound, or identifying social metadata.
