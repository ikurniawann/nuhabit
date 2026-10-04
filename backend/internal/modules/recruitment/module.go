package recruitment

import (
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
)

// Name is the MODULES key.
const Name = "recruitment"

// Paths under the ported prefixes that stay in TypeScript, because they
// write or read Next's local storage (frontend/storage/private and
// uploads), build PDFs, or run CV/vision AI that needs new dependencies:
//
//	DELETE /api/candidates/{id}                 purges storage/private/psikotes/<session>
//	GET    /api/candidates/{id}/report          PDF (pdf-lib)
//	POST   /api/candidates/cv-extract           OpenAI OCR of an uploaded CV
//	POST|DELETE /api/candidates/{id}/cv-upload  writes storage/uploads
//	GET|POST /api/candidates/{id}/ai-analysis   pdf/docx text extraction + DeepSeek
//	GET    /api/interview/files/{path...}       reads storage/private
//	GET    /api/interview/session/{token}       returns TTS audio read from storage
//	POST   /api/interview/session/{token}/start|answer|recording-chunk|proctor-event
//	GET    /api/interview/sessions/{id}/recordings
//	GET    /api/psikotes/files/{path...}
//	POST   /api/psikotes/session/{token}/proctor-event
//	POST   /api/psikotes/session/{token}/tests/{testId}/upload
//	POST   /api/psikotes/session-tests/{id}/ai-insight

type mod struct{ h *handler }

func (mod) Name() string             { return Name }
func (m mod) Routes() []module.Route { return append(m.h.Routes(), m.h.portalRoutes()...) }

// New builds the module; ports come from internal/app.
func New(deps module.Deps, ports Ports) module.Module {
	return newModule(deps, deps.DB, ports)
}

// newModule lets tests run the module on a rolled-back transaction.
func newModule(deps module.Deps, db database.DB, ports Ports) mod {
	return mod{h: &handler{svc: NewService(db, ports, deps.Now, deps.Log), guard: deps.Auth}}
}
