# Screen wake lock during web voice calls

The physical voice call requests a screen wake lock when the live session becomes ready. In-app navigation and guide changes retain that lock. Normal hangup, the ten-minute limit, transport failure and component unmount all release it through the existing call cleanup.

The helper releases its lock when the document becomes hidden and requests a new one when it becomes visible again. Outstanding requests are versioned so grants arriving after hangup or a visibility change are immediately released. Device-policy revocation does not cause a retry loop.

Unsupported browsers and rejected requests leave the voice call running and show a short English/Spanish reminder in the call controls. Production requires HTTPS. Browsers and device battery settings can decline or revoke a request; the feature does not prevent manual phone locking or guarantee background voice operation.

Automated tests simulate lock ownership, visibility changes, late grants, revocation and refusal. Verify screen dimming on a physical iPhone and Android device after deployment; simulated tests cannot establish device behavior.
