-- Dataroom sebagai pengganti Google Drive (MOM item 14, 2026-10-27):
-- sampah dengan pemulihan dan purge 30 hari, versi file, bintang, riwayat
-- buka, tag dan deskripsi, pencarian teks penuh, hak akses per pengguna
-- dan per peran (viewer/commenter/editor/owner, diwariskan ke bawah dengan
-- override), komentar berutas dengan mention, kunci edit, log aktivitas,
-- sesi unggah berpotongan, dan toggle unduh pada link berbagi.

-- Node: sampah, versi, tag, deskripsi, kunci, indeks pencarian.
ALTER TABLE dataroom.nodes
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS trashed_at timestamptz,
  ADD COLUMN IF NOT EXISTS trashed_root boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS trashed_by uuid,
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS search_text text,
  ADD COLUMN IF NOT EXISTS search_vector tsvector,
  ADD COLUMN IF NOT EXISTS locked_by uuid,
  ADD COLUMN IF NOT EXISTS locked_by_name varchar(120),
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  -- restricted: baseline akses departemen tidak berlaku; hanya pemilik,
  -- grant eksplisit dan super admin (dipakai port pengarsipan modul lain).
  ADD COLUMN IF NOT EXISTS restricted boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION dataroom.nodes_search_vector() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('simple', coalesce(NEW.name, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(array_to_string(NEW.tags, ' '), '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.description, '')), 'B') ||
    setweight(to_tsvector('simple', left(coalesce(NEW.search_text, ''), 200000)), 'C');
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_dataroom_nodes_search ON dataroom.nodes;
CREATE TRIGGER trg_dataroom_nodes_search
  BEFORE INSERT OR UPDATE OF name, tags, description, search_text ON dataroom.nodes
  FOR EACH ROW EXECUTE FUNCTION dataroom.nodes_search_vector();

-- Isi vektor untuk baris lama.
UPDATE dataroom.nodes SET name = name WHERE search_vector IS NULL;

CREATE INDEX IF NOT EXISTS idx_dataroom_nodes_search ON dataroom.nodes USING gin (search_vector);
CREATE INDEX IF NOT EXISTS idx_dataroom_nodes_tags ON dataroom.nodes USING gin (tags);
CREATE INDEX IF NOT EXISTS idx_dataroom_nodes_trash ON dataroom.nodes (trashed_at) WHERE trashed_root;

-- Riwayat versi file: baris = isi lama yang digantikan.
CREATE TABLE IF NOT EXISTS dataroom.node_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id uuid NOT NULL REFERENCES dataroom.nodes(id) ON DELETE CASCADE,
  version integer NOT NULL,
  name varchar(255) NOT NULL,
  mime varchar(150),
  size_bytes bigint NOT NULL DEFAULT 0,
  storage_path text NOT NULL,
  created_by uuid,
  created_by_name varchar(120),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (node_id, version)
);

CREATE TABLE IF NOT EXISTS dataroom.stars (
  user_id uuid NOT NULL,
  node_id uuid NOT NULL REFERENCES dataroom.nodes(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, node_id)
);

CREATE TABLE IF NOT EXISTS dataroom.recent_opens (
  user_id uuid NOT NULL,
  node_id uuid NOT NULL REFERENCES dataroom.nodes(id) ON DELETE CASCADE,
  opened_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, node_id)
);
CREATE INDEX IF NOT EXISTS idx_dataroom_recent_opens_user ON dataroom.recent_opens (user_id, opened_at DESC);

-- Hak akses eksplisit per pengguna atau per peran (kode role IAM).
CREATE TABLE IF NOT EXISTS dataroom.permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id uuid NOT NULL REFERENCES dataroom.nodes(id) ON DELETE CASCADE,
  subject_type varchar(10) NOT NULL CHECK (subject_type IN ('user', 'role')),
  subject_id text NOT NULL,
  role varchar(10) NOT NULL CHECK (role IN ('viewer', 'commenter', 'editor', 'owner')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (node_id, subject_type, subject_id)
);
CREATE INDEX IF NOT EXISTS idx_dataroom_permissions_subject ON dataroom.permissions (subject_type, subject_id);

CREATE TABLE IF NOT EXISTS dataroom.comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id uuid NOT NULL REFERENCES dataroom.nodes(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES dataroom.comments(id) ON DELETE CASCADE,
  body text NOT NULL,
  mentions uuid[] NOT NULL DEFAULT '{}',
  created_by uuid NOT NULL,
  created_by_name varchar(120),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_dataroom_comments_node ON dataroom.comments (node_id, created_at);

-- Log aktivitas di dashboard (log link berbagi tetap di share_access_logs).
CREATE TABLE IF NOT EXISTS dataroom.activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id uuid REFERENCES dataroom.nodes(id) ON DELETE CASCADE,
  parent_id uuid,
  action varchar(30) NOT NULL,
  node_name varchar(255),
  actor_id uuid,
  actor_name varchar(120),
  detail jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dataroom_activity_node ON dataroom.activity_logs (node_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dataroom_activity_parent ON dataroom.activity_logs (parent_id, created_at DESC);

-- Sesi unggah berpotongan (file besar), potongan ditulis ke berkas .part.
CREATE TABLE IF NOT EXISTS dataroom.upload_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid REFERENCES dataroom.nodes(id) ON DELETE CASCADE,
  replace_node_id uuid REFERENCES dataroom.nodes(id) ON DELETE CASCADE,
  name varchar(255) NOT NULL,
  claimed_mime varchar(150),
  size_bytes bigint NOT NULL,
  received_bytes bigint NOT NULL DEFAULT 0,
  storage_path text NOT NULL,
  created_by uuid NOT NULL,
  created_by_name varchar(120),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE dataroom.shares ADD COLUMN IF NOT EXISTS allow_download boolean NOT NULL DEFAULT true;
