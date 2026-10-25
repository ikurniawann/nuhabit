# Data Room as the company document platform

Audit of `backend/internal/modules/dataroom` and `frontend/src/features/dataroom`
against what replacing Google Drive needs (MOM item 14), then the build log.

## What existed before 20261027130000

Storage model: `dataroom.nodes` (folder or file, tree by `parent_id`, files on
disk under `storage/private/dataroom/YYYY/MM/<random>.<ext>`), department
access per folder (`dataroom.folder_departments`, inherited down the tree,
super admin sees everything), share links (`dataroom.shares`: public or email
verified, PIN, expiry 1 to 365 days, watermark, recipient sessions, access
log), one 50 GB quota and a 100 MB per-file cap from env.

| Area | Status before |
| --- | --- |
| Nested folders, breadcrumbs | Present (`GET /api/dataroom/nodes?parent=`, `ancestors`). |
| Upload | One file per multipart request, max 100 MB, drag and drop of files only; dropping a folder failed. |
| Rename, move | Present (PATCH), move by drag between folders and onto breadcrumbs. |
| Copy | Missing. |
| Delete | Hard delete with cascade; no trash. |
| Star, recent, shared with me | Missing. |
| Search | Client-side name filter inside the open folder only. |
| Tags, descriptions | Missing. |
| Versions | Missing; a re-upload made a second file. |
| Quota in UI | Present (header bar). |
| Preview | Images and PDF inline. Office, video, audio and text fell back to download. |
| Access | Department per folder only. No per-user or per-role grants, no owner concept beyond `created_by`. |
| Link sharing | Public or email, PIN, expiry, watermark. No download toggle. |
| Audit log | Share access log per link. No view of who did what inside the dashboard. |
| Comments, mentions | Missing. |
| Edit lock, activity feed | Missing. |
| Notification on share | Email on email links only. Nothing in the staff inbox. |
| Integration hook for other modules | Missing. |
| UI | Grid and list toggle, multi-select with move and delete, context menu. No column sort, no keyboard navigation, no sidebar views. |
| Office conversion | `backend/Dockerfile` has no LibreOffice (only tesseract for OCR), so no PDF conversion of DOCX, XLSX or PPTX. |
| Text extraction | `internal/platform/extract` already reads PDF (ledongthuc/pdf), DOCX (zip and XML), XLSX (platform/xlsx) and plain text. Unused by the Data Room. |

## What this change adds

Migration `20261027130000_dataroom_drive.sql`.

### Core file operations

- Trash: `DELETE /api/dataroom/nodes/{id}` now moves the subtree to the trash
  (`trashed_at`, `trashed_root`). `POST /nodes/{id}/restore` brings it back
  (its own parent when that still exists, otherwise root).
  `DELETE /nodes/{id}/purge` deletes now. The hourly job
  `dataroom.housekeeping` purges trash older than 30 days and drops expired
  upload sessions.
- Copy: `POST /nodes/{id}/copy {parent_id}` copies a file (bytes duplicated,
  quota checked) or a folder subtree.
- Star: `PUT`/`DELETE /nodes/{id}/star`. Recent: every preview or download
  records `dataroom.recent_opens`. Views: `GET /api/dataroom/nodes?view=
  starred|recent|shared|trash`.
- Search: `GET /api/dataroom/search?q=&tag=` over a `tsvector` of name,
  description, tags and extracted text (PDF, DOCX, XLSX, CSV, TXT, MD, JSON
  up to 10 MB through `platform/extract`; larger or other files index name,
  description and tags only). Results carry their folder path.
- Tags and description: `PATCH /nodes/{id} {description, tags}`.
- Versions: `POST /nodes/{id}/versions` (multipart) stores the current file
  as a version row and replaces the live bytes; `GET /nodes/{id}/versions`,
  `GET /nodes/{id}/versions/{versionId}/download`,
  `POST /nodes/{id}/versions/{versionId}/restore` (the current file becomes a
  version first, so nothing is lost).
- Chunked and resumable upload for files above the multipart cap:
  `POST /api/dataroom/uploads` (name, size, parent_id, optional
  `replace_node_id` for a new version) returns a session, `PUT
  /uploads/{id}/chunk` appends bytes at the offset the session expects
  (`X-Upload-Offset`, 8 MB per request), `GET /uploads/{id}` reports the
  received size to resume, `POST /uploads/{id}/complete` sniffs the MIME,
  moves the file into place and creates the node or version. Sessions live
  24 hours. Cap `DATAROOM_MAX_CHUNKED_MB` (default 2048); the 100 MB
  multipart path stays for small files.
- Folder upload: the browser walks dropped directories (`webkitGetAsEntry`)
  or `webkitdirectory` picks, creates the folder chain first, then queues the
  files.

### Preview

Images and PDF stay as before. Video and audio stream inline with Range
support, text, markdown, CSV and JSON render in the dialog (served as
`text/plain`). DOCX and XLSX show their extracted text with a note that no PDF
conversion is available because LibreOffice is not in the container; the
download button stays. HTML, SVG, XML and scripts always download.

### Sharing and access

- Per-user and per-role grants (`dataroom.permissions`: viewer, commenter,
  editor, owner) on folders and files, inherited down the tree. The nearest
  grant on the path wins, so a lower grant on a subfolder overrides a higher
  one above it. A user grant beats a role grant at the same node. Without a
  grant the previous rule applies: department access plus the IAM menu
  actions (read gives viewer, create or update gives editor). `created_by`
  and super admin are owners. `GET`/`PUT /nodes/{id}/permissions` (owner).
  A `restricted` folder ignores the department baseline and opens only to
  grants, the creator and super admin; the filing port uses it.
- Shared with me: nodes with a direct grant for me or my role that I did not
  create.
- Link sharing gains `allow_download` (download toggle); PIN, expiry and
  email verification are unchanged.
- Audit: `dataroom.activity_logs` records create, upload, version, rename,
  move, copy, trash, restore, purge, view, download, share, permission,
  comment and lock events. `GET /nodes/{id}/activity` (root:
  `GET /api/dataroom/activity`) feeds the activity tab; view and download
  rows are shown to owners only.
- Comments: `GET`/`POST /nodes/{id}/comments` with `parent_id` for threads
  and `mention_user_ids`; each mention writes a `public.notifications` row
  for that user. `DELETE /api/dataroom/comments/{id}` by the author or an
  owner.
- Notification on share: a grant writes a `public.notifications` row and
  sends an email through the Resend mailer when the user has an email
  (best effort). WhatsApp is not wired: staff accounts carry no phone
  number in `configuration.users`.

### Collaboration

- Lock: `PUT`/`DELETE /nodes/{id}/lock`. A locked file refuses rename, move,
  trash and new versions from anyone but the holder (owners may unlock). The
  UI shows "Sedang diedit oleh <nama>".
- Activity feed per folder (see audit above).

### Integration port

`dataroom.Filer.FileDocument(ctx, ownerUserID, folderPath, name,
contentType, reader, tags)` creates the folder chain (the first folder it
creates is `restricted`, so only the owner, explicit grants and super admin
see it), stores the file, indexes it and logs the activity. Wired into
payroll: `POST /api/hris/payslips/notify` files the emailed PDF under
`Payroll/Slip Gaji/<tahun>/<periode>` owned by the HR user who sent it, with
tags `slip-gaji` and the period. Failures are logged and never fail the
email. HRIS employee documents and investor updates can call the same port
through `payroll.DocumentFiler`-style interfaces in their `Ports`.

### UI

Sidebar views (Drive, Dibagikan, Berbintang, Terbaru, Sampah), server search
with tag filter, grid and list toggle, sortable columns, arrow-key and
Enter/Space navigation with Shift and Ctrl selection, bulk bar (pindahkan,
salin, bintang, hapus), details panel with tabs (Detail with description and
tags, Versi, Komentar, Aktivitas), permissions dialog, lock badge, chunked
upload progress. Indonesian copy throughout.

## Still missing

- Office preview as PDF: needs LibreOffice in `backend/Dockerfile` (about
  400 MB) plus a conversion cache; today the dialog shows extracted text.
- Full-text indexing of files above 10 MB, PPTX and OCR of scanned PDFs
  (the extract package can OCR, but the request-time cost is too high; a
  background indexing job would fit `app.RegisterJob`).
- Company-level quota: the quota is one number per instance
  (`DATAROOM_QUOTA_GB`); the UI shows it, but there is no per-company split.
- WhatsApp notifications for grants and mentions (no staff phone source).
- Real-time co-editing or online editors; the lock is advisory.
- Offline sync client.
