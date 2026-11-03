# Background topic recaps

After the selected student's authorized notes and memories load, the browser prepares populated recap topics, one background request at a time. The last viewed divider has priority. Opening a different divider can start one foreground request alongside existing background work, so reading does not wait behind an unrelated topic. Foreground and background requests for the same recap share one result.

Prepared recaps are held in memory for the mounted binder session. Changed source revisions invalidate the affected topic. Changing student, family scope, account, or language clears this cache and cancels pending work. Logout and privacy changes clear it too. No recap text is stored in browser storage. The server still reauthorizes sources and checks for changes before returning generated recaps. Failed background loads do not retry automatically; the open recap offers **Try again**, and original notes remain available.

No additional worker or migration is needed. At most four populated topics are prepared per settled source version; the existing hourly generation limit still applies. Reloading the page starts a new browser cache; the existing short-lived server cache may reuse a result after rechecking sources.

## Timing logs

In browser developer tools, filter the Console for **`[Origen recap]`**. Events are `topic_recap.started`, `topic_recap.finished`, and `topic_recap.reused`.

- `queueMs`: time from enqueueing until the request starts, including idle delay.
- `durationMs`: token acquisition, network, server work, response parsing, and validation.
- `totalMs`: queue wait plus request duration.
- `mode`: whether the request started as background preparation or foreground reading.
- `outcome`: completed, failed, or cancelled. A cancellation can be expected when switching students, changing notes, or signing out.
- `cache: hit`: a previously prepared recap was reused without a request; duration is zero because no load occurred.

In API logs, filter for **`recap.load.finished`**:

- `durationMs`: total server handling time for this recap, excluding browser queue/network time.
- `sourceMs`: authorization and source-read time, including the final freshness check.
- `generationMs`: provider request and response-read time; zero on a cache hit or coalesced request.
- `recapCache`: generated, hit, coalesced, empty, or none.
- `recapMode`: the caller's background/foreground hint, not a permission or identity claim.

These logs include only approved topic/language labels, timings, cache state, and outcome. Private note text, student names, account identifiers, and tokens are excluded. This adds console and API log events, not a new admin dashboard screen.
