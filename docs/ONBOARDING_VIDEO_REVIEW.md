# Landing video review

The `#college-guidance` section keeps “College questions? Let’s talk them
through” as its overarching heading and presents three content/video rows:

1. Share goals and questions, beside the approved onboarding video.
2. Explain unfamiliar college and financial-aid terms, beside the approved college-costs video.
3. Revisit binder notes and next steps, beside the approved binder-preview video.

All three media columns are 440px on
desktop and stack after their own copy on tablet/phone layouts. The original
reassurance and account CTA follow the rows. English and Spanish copy is
included, and the former duplicate video insertion in `#how` is absent.

## Media and loading

`public/videos/origen-onboarding.mp4` contains the approved, unchanged media:

- Size: 4,727,859 bytes.
- SHA-256: `e6fc1263334c39381cd29e05a12a0ccc5c70f61a5ae60d5d253ce7977c096fec`.
- 1280x720 AVC (`avc1`) video and `mp4a` audio; duration 180.466667 seconds.
- No text tracks were detected. No captions, translations, music, or overlays were added.

`public/videos/origen-college-costs.mp4` is the unchanged approved second video:

- Original filename: `Origen_College_Costs_Branded.mp4`.
- Size: 4,289,714 bytes; duration: 184.9 seconds.
- SHA-256: `a6914083ea9e07ddd612a860cd1b2a100fba44171eedbaa484c7e498ce3f3221`.
- English/Spanish interface labels do not claim translated audio.

`public/videos/origen-binder-preview.mp4` is the unchanged approved third video:

- Original filename: `Origen_Binder_Preview.mp4`.
- Library file: `libfile_146295edd1b48191815f7c2981048421`.
- Size: 2,576,231 bytes; duration: 82.5 seconds; 1280x720 decoded video.
- SHA-256: `ff82a8f455bca7a5f376f7521cd661819f1cac26e9a157a5cf0766b9156ae703`.
- The English and Spanish interfaces both explicitly identify English audio.
- The compact poster shows a rounded 1:23 duration.

Each player has independent activation state, a media source, and unique title
and description IDs. Activating one leaves the others unloaded. All reuse the
same poster, 440px layout, native controls, inline playback, and direct-file fallback.

Only the branded SVG poster and native activation button exist initially.
Activating the button mounts the native player, transfers keyboard focus, and
requests playback. Native controls and inline playback remain available if the
browser declines the play request. The player has no autoplay attribute.
A direct-file link appears after activation, with a translated media-error alert.

## Third-video validation

- Started from current `origin/main` at `b652418` on local branch
  `codex/origen-binder-video`; preserved existing untracked QA artifacts.
- `npm run build`, script syntax check, and `git diff --check` passed.
- English desktop and Spanish 390px phone previews initially contained three
  poster buttons, six unique accessibility IDs, and no video/source elements.
  The preview request log showed no MP4 request until activation.
- Enter activation on desktop and a visible poster click on phone loaded only
  the binder player. Both decoded 1280x720 video, advanced playback, reported
  82.5 seconds, and exposed native controls, inline playback, focus, and no autoplay.
- Native Space pause and ArrowRight seeking passed; sought frames decoded.
- All three desktop media columns measured 440px. Phone columns measured 283px,
  stacked beneath their own copy, with no horizontal overflow.
- Native phone fullscreen visibly expanded the video and exposed its controls.
- Source/build copies of all three videos match their respective checksums;
  the first two videos and surrounding row copy are unchanged.
- Local binder media returned HTTP 206, `video/mp4`, `Accept-Ranges: bytes`,
  and `Content-Range: bytes 0-1023/2576231`.
- Evidence is saved under `output/playwright/onboarding-video/` as
  `binder-desktop.jpg`, `binder-mobile-poster-es.jpg`,
  `binder-mobile-playback-es.jpg`, and `binder-mobile-fullscreen-es.jpg`.
- The smoke script includes all three players; the expanded CLI matrix was not run.
  No authentication pages or backend settings were inspected during this revision.

## Second-video validation

- `npm run build`, script syntax check, and `git diff --check` passed on current main.
- At 1440px, both players decoded and played in English/Spanish language states,
  with focus, native controls, inline playback, Space pause, and correct durations.
- The new player also decoded and played in the Spanish 390px phone layout,
  with matching 283px media-column widths, no overflow, unique accessibility IDs,
  and the unchanged noninteractive binder placeholder.
- Keyboard activation of the new player left the first player unloaded. Request
  logs recorded no MP4 requests before activation in the desktop cases.
- Native phone seeking changed the second video's playback position.
- Both source/build copies match their respective checksums; the first video is unchanged.
- A broader browser sweep was interrupted by an unexpected authentication-page
  navigation outside the local QA scope. No authentication access or changes
  were needed; phone checks continued in a fresh local-only preview.

At that revision, the smoke script covered both players independently in all ten viewport/language
combinations. The complete updated CLI matrix was not run in this environment.

## Earlier single-player validation

- `npm ci`, `npm run build`, script syntax check, and `git diff --check` passed.
- Ten local Chrome cases passed: English/Spanish at 1440, 1024, 768, 390, and 320px.
- Each case verified three aligned rows, two noninteractive placeholders, one player,
  loaded poster, no overflow, zero MP4 requests and no player/source before activation,
  actual decoded playback, native controls, inline playback, focus, and Space pause.
- Enter activation passed at 1440px; the remaining cases used click activation.
- Native keyboard seeking changed playback position and decoded the sought frame.
- The account CTA opened the existing local sign-in/create-account dialog.
- The source and built MP4 checksums match. The local built-site server returned
  HTTP 206, `video/mp4`, `Accept-Ranges: bytes`, and the correct content range.
- The production build reports existing large-chunk and Auth0 directive warnings.

For repeatable browser checks, serve the production build locally and run
`node scripts/landing-video-smoke.cjs` with Playwright available to Node. Set
`ORIGEN_BROWSER_MODULE_ROOT` to a tooling project containing Playwright when it
is installed separately. `ORIGEN_BROWSER_EXECUTABLE` optionally selects Chrome;
`ORIGEN_PREVIEW_URL` selects the loopback preview (default port 5173). The script
checks all ten language/viewport combinations. Set `ORIGEN_VIDEO_POSTER_ONLY=1`
to simulate unavailable media and check the translated alert and direct link.
The latter simulation passed earlier; it was not rerun during the final row revision.

## Remaining manual checks

Native fullscreen was verified for the binder video during the third-video revision.
Audible narration was not assessed through screenshot-based
browser tools. Verify the production host's media MIME/range behavior as part of
a separately approved rollout. This change does not authorize merge or deployment.
