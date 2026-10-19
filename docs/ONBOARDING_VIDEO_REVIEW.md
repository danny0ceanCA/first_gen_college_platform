# Landing video review

The `#college-guidance` section keeps “College questions? Let’s talk them
through” as its overarching heading and presents three content/video rows:

1. Share goals and questions, beside the approved onboarding video.
2. Explain unfamiliar college and financial-aid terms, beside a future questions-demo placeholder.
3. Revisit binder notes and next steps, beside a future binder-walkthrough placeholder.

The two future-video spaces say “Video coming soon.” They contain no button,
link, video element, or media source. All three media columns are 440px on
desktop and stack after their own copy on tablet/phone layouts. The original
reassurance and account CTA follow the rows. English and Spanish copy is
included, and the former duplicate video insertion in `#how` is absent.

## Media and loading

`public/videos/origen-onboarding.mp4` contains the approved, unchanged media:

- Size: 4,727,859 bytes.
- SHA-256: `e6fc1263334c39381cd29e05a12a0ccc5c70f61a5ae60d5d253ce7977c096fec`.
- 1280x720 AVC (`avc1`) video and `mp4a` audio; duration 180.466667 seconds.
- No text tracks were detected. No captions, translations, music, or overlays were added.

Only the branded SVG poster and native activation button exist initially.
Activating the button mounts the native player, transfers keyboard focus, and
requests playback. Native controls and inline playback remain available if the
browser declines the play request. The player has no autoplay attribute.
A direct-file link appears after activation, with a translated media-error alert.

## Validation

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

Native fullscreen did not visibly expand through the browser automation, so it
remains unverified. Audible narration was not assessed through screenshot-based
browser tools. Verify the production host's media MIME/range behavior as part of
a separately approved rollout. This change does not authorize merge or deployment.
