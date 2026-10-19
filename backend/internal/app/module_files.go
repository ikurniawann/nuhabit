package app

import "nuhabit/backend/internal/modules/files"

// files: GET /api/files/{bucket}/{path...} over the upload tree shared with
// Next (public buckets, member-owned photos, staff-only buckets).
func init() { Register(files.Name, files.New) }
