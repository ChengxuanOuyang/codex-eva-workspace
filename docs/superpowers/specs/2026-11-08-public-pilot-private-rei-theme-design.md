# PROJECT ZERO public pilot and private local theme design

Date: 2026-11-08
Status: approved in conversation; pending written-spec review

## Goal

Publish an open-source PROJECT ZERO workbench whose tracked theme is an original,
non-REI anonymous pilot, while preserving the existing Rei-inspired artwork only as an
untracked local theme that the owner can package privately and share directly with their
girlfriend.

The public release must not claim that third-party character or trademark rights are cleared.
The public and private package paths must be technically and operationally separated.

## Public visual identity

The tracked public product is named:

- macOS product: `PROJECT ZERO — PILOT CODEX WORKBENCH`
- in-app display: `PROJECT ZERO // PILOT CODEX WORKBENCH`
- pilot designation: `PILOT-00 / VOIDGLASS`

The public pilot is shown in side-profile half-body compositions. The pilot wears a fully
sealed graphite helmet with a completely opaque black visor, a narrow cyan life-status line,
a cold-grey segmented neck ring, layered shoulder armour, and restrained orange mechanical
locks. The artwork must show no hair, eyes, face, white skin-tight pilot suit, amber immersion
liquid, or EVA/NERV marks or vocabulary.

The rendering style is polished semi-realistic science-fiction concept illustration: credible
helmet construction and materials, slightly animation-influenced proportions, cinematic light,
and a restrained editorial composition. It is not a geometric CSS silhouette or a final UI
mock-up.

### Three scenes

The existing B → A → C sequence remains:

1. **Scene B — Awakening:** a cold-white maintenance bay; the sealed helmet powers on and the
   cyan status line appears.
2. **Scene A — Synchronization:** the primary side-profile half-body composition; the black
   visor reflects the synchronization ring while the application pauses at 99.2%.
3. **Scene C — Online:** a dark aerospace cockpit; the cyan status line stabilizes and the
   orange ring completes to 100%.

All three 16:9 images must depict the same anonymous pilot, helmet geometry, armour system,
palette, and visual world. `PROJECT ZERO 00` remains the original in-product system mark.

## Public/private boundary

### Public repository

Git tracks only:

- the three original VOIDGLASS public scenes;
- their source/runtime variants, checksums, provenance, and public art notice;
- the generic local-theme packaging mechanism;
- tests and workflow documentation.

The public codebase and packaged public ASAR must not contain REI, Rei, 绫波丽, Evangelion,
EVA, or NERV product/character branding, nor the private scene files. The existing repository
URL may remain unchanged as a historical slug, but README text must not present it as a rights
claim or official affiliation.

### Private local theme

Before replacing tracked public artwork, copy the existing Rei-inspired PNG masters into the
ignored local directory `private-themes/rei/source/`. Put only the packable WebP files, theme
manifest, asset manifest, and notice into `private-themes/rei/package/`. These files remain
outside Git and outside the public ASAR.

The private theme manifest may use the in-app label
`PROJECT ZERO // PRIVATE THEME`. It must state that it is unofficial fan material, is for
private local use, does not convey third-party character or trademark rights, and is not part
of the open-source distribution.

## Local theme packaging architecture

Add an explicit private-package command that receives the exact package directory (for the
owner theme, `private-themes/rei/package/`). The default public `pack` command never reads
private themes, the sibling PNG source directory, or implicit user directories.

The private packer must:

1. resolve the explicitly supplied directory to a canonical path;
2. reject missing files, directories, symbolic links, path escape, unexpected manifest fields,
   unsupported MIME/type/size values, and checksum mismatches;
3. accept only an exact allowlist: a theme manifest, three WebP runtime scenes, an asset
   manifest, and an art notice;
4. create an isolated staging tree outside tracked source files;
5. overlay the validated local theme and approved display label only inside staging;
6. invoke the fixed local Electron Builder executable without a shell;
7. write to a dedicated private output directory such as `dist-private/`;
8. remove staging data on success or failure without modifying tracked public assets.

The public and private build paths may not overwrite each other's output. The packaged
application remains unsigned and unnotarized unless the user later supplies an Apple Developer
ID workflow; it must be described as a local preview rather than a publicly trusted binary.

## Licensing and release language

The code remains MIT licensed. Public original artwork has a separate notice that grants only
rights the contributors actually own and does not clear third-party rights. The new public
artwork must be described as an original anonymous aerospace pilot, not as a renamed version of
a third-party character.

Private fan artwork is not distributed under the public repository's art terms. Its local
notice must explicitly say that no commercial-use guarantee or third-party rights grant is
provided.

## Failure handling

The private packer fails closed before Electron Builder starts when any theme validation fails.
Errors expose stable reason codes and relative allowlisted filenames, not arbitrary absolute
user paths or manifest payloads. Partial private output is removed or kept in an unmistakably
failed staging location; it is never presented as a completed application.

Public packaging remains deterministic and independent of whether `private-themes/` exists.

## Verification

Implementation follows test-driven development. Required evidence:

- product metadata and visible copy contain the approved PILOT naming and no public REI/EVA/NERV
  identity;
- three public runtime files match their manifest checksums and are visually inspected for
  subject consistency, absence of forbidden identifiers, composition, and legibility;
- default packaging does not read or include ignored private files;
- private theme validation rejects symlinks, path escape, missing/extra files, bad checksums,
  malformed metadata, and public/private output collision;
- private packaging stages without modifying tracked files and produces a separate ASAR with
  the local display label and exact validated theme assets;
- source E2E, packaged public smoke, private package smoke, full Node verification, and
  `git diff --check` pass;
- fresh public ASAR scanning finds no credentials, private assets, user paths, tests, fixtures,
  or REI/EVA/NERV product identity;
- fresh private ASAR scanning confirms only the explicitly selected local theme entered the
  private artifact;
- macOS public and private local previews both start and cleanly close on the owner machine.

## Out of scope

- obtaining or claiming legal permission for third-party characters or trademarks;
- publishing an unsigned/private `.app`, DMG, or ZIP as a trusted public release;
- renaming the GitHub repository slug in this implementation;
- adding remote theme downloads, a theme marketplace, or runtime network asset loading;
- changing Phase 2 workbench functionality beyond theme identity and packaging boundaries.
