package gymscheduling

import (
	"context"

	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// Class types (session templates) and coaches. Port of catalog-server.ts.

func (s *Service) ListClassTypes(ctx context.Context) ([]*Row, error) {
	return s.repo.ListClassTypes(ctx, s.db)
}

func (s *Service) CreateClassType(ctx context.Context, in ClassTypeInput) (string, error) {
	id, err := s.repo.InsertClassType(ctx, s.db, in)
	if err == nil && id == "" {
		err = httpx.Conflict("Nama jenis kelas sudah dipakai")
	}
	return id, err
}

// UpdateClassType changes the template; sessions already created keep their values.
func (s *Service) UpdateClassType(ctx context.Context, id string, in ClassTypePatch) error {
	found, err := s.repo.UpdateClassType(ctx, s.db, id, in)
	switch {
	case database.IsUniqueViolation(err):
		return httpx.Conflict("Nama jenis kelas sudah dipakai")
	case err != nil:
		return err
	case found == "":
		return httpx.NotFound("Jenis kelas tidak ditemukan")
	}
	return nil
}

// ArchiveClassType archives; old sessions still point at the template.
func (s *Service) ArchiveClassType(ctx context.Context, id string) error {
	ok, err := s.repo.ArchiveClassType(ctx, s.db, id)
	if err == nil && !ok {
		err = httpx.NotFound("Jenis kelas tidak ditemukan")
	}
	return err
}

func (s *Service) ListCoaches(ctx context.Context) ([]*Row, error) {
	return s.repo.ListCoaches(ctx, s.db)
}

func (s *Service) CreateCoach(ctx context.Context, in CoachInput) (string, error) {
	id, err := s.repo.InsertCoach(ctx, s.db, in)
	if err == nil && id == "" {
		err = httpx.Conflict("Nama coach sudah dipakai")
	}
	return id, err
}

func (s *Service) UpdateCoach(ctx context.Context, id string, in CoachPatch) error {
	found, err := s.repo.UpdateCoach(ctx, s.db, id, in)
	if err == nil && found == "" {
		err = httpx.NotFound("Coach tidak ditemukan")
	}
	return err
}
