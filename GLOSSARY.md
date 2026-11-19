# WAHA Downloader

A WhatsApp-driven media downloader that accepts download commands over WhatsApp, retrieves media with per-requester cookies, archives the output to object storage, and replies to the requester.

## Language

**Requester**:
The WhatsApp user (identified by their normalized phone number) who issues a download command and owns their own scoped cookies.
_Avoid_: User, client, sender, nomor

**Download Request**:
A WhatsApp message starting with the `/dl` command (or containing target media URLs when Auto-Download Setting is active for the Requester) containing one or more target media URLs.
_Avoid_: Job, task, message, order

**Auto-Download Setting**:
A per-Requester preference that automatically processes target media URLs sent in WhatsApp messages without requiring an explicit `/dl` command prefix.
_Avoid_: Auto mode, bot toggle, auto-downloader

**Cookie Profile**:
A Netscape-format HTTP cookie file scoped to a single Requester and a normalized target domain.
_Avoid_: Session, credentials, cookie jar

**Media Archive**:
The remote S3-compatible object storage where downloaded media files are uploaded and referenced by URL.
_Avoid_: Bucket, CDN, storage
