# Copy Cookie Profiles to per-job temp files for yt-dlp

`yt-dlp` writes updated cookies back to the file passed via `--cookies` and can error if that file is read-only. Rather than passing a Requester's stored Cookie Profile directly (which risks corruption and race conditions across concurrent downloads), each download job copies the matching Cookie Profile to a temporary file for `yt-dlp` and deletes the copy afterward.
