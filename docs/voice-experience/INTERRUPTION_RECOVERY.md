# Interrupted audio recovery

Generation completion and audible playback completion are different events. A response may be marked completed while buffered audio is still playing. Voice detection can mistake background noise for an interruption and clear that audio without cancelling generation again.

The reply controller now recognizes interruptions during both generation and buffered playback. A cleared conversational output with no understandable new speech queues one recovery, waiting for transcription or its existing timeout. A genuine new question receives an ordinary reply. Research progress audio, natural playback completion and hangup never trigger this recovery. Repeated noise cannot generate an unlimited recovery loop.

Regression tests exercise both transcription/clear event orders, missing transcription, genuine interruptions, normal drains, progress audio and repeated noise. These fixes address reproducible client-state bugs, not a diagnosis of a specific production session. Transport failures, phone backgrounding and provider failures remain separate possible causes.
