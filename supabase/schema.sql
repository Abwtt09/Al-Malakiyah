-- ============================================================
-- Almalakiyah Real Estate — Supabase Postgres Schema
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- ── Extensions ────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Helper functions for RBAC ─────────────────────────────────────────────────
-- These mirror the logic in the Firestore security rules.

CREATE OR REPLACE FUNCTION public.get_user_role(user_id UUID)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT role FROM public.profiles WHERE id = user_id;
$$;

CREATE OR REPLACE FUNCTION public.is_user_disabled(user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(disabled, false) FROM public.profiles WHERE id = user_id;
$$;

CREATE OR REPLACE FUNCTION public.current_role_name()
RETURNS TEXT
LANGUAGE sql STABLE AS $$
  SELECT public.get_user_role(auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.is_owner()  RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT NOT public.is_user_disabled(auth.uid())
      AND public.current_role_name() IN ('admin_owner', 'admin');
$$;
CREATE OR REPLACE FUNCTION public.is_manager() RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT NOT public.is_user_disabled(auth.uid())
      AND public.current_role_name() IN ('manager', 'admin_owner', 'admin');
$$;
CREATE OR REPLACE FUNCTION public.is_editor()  RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT NOT public.is_user_disabled(auth.uid())
      AND public.current_role_name() IN ('editor', 'manager', 'admin_owner', 'admin');
$$;
CREATE OR REPLACE FUNCTION public.is_staff()   RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT NOT public.is_user_disabled(auth.uid())
      AND public.current_role_name() IN ('viewer', 'editor', 'manager', 'admin_owner', 'admin');
$$;

-- ── Table: profiles (replaces Firestore users/{uid}) ─────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
  id                UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username          TEXT        UNIQUE,
  name              TEXT,
  phone             TEXT,
  email             TEXT,
  role              TEXT        NOT NULL DEFAULT 'viewer'
                                CHECK (role IN ('admin_owner', 'manager', 'editor', 'viewer', 'admin')),
  disabled          BOOLEAN     NOT NULL DEFAULT FALSE,
  is_setup_complete BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at        BIGINT      DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Users can read their own profile; owners/admins can read all (using get_user_role helper to avoid recursion)
CREATE POLICY "profiles_select" ON public.profiles FOR SELECT
  USING (auth.uid() = id OR public.get_user_role(auth.uid()) IN ('admin_owner', 'admin'));

-- Bootstrap: new auth users can create their own profile row (viewer only)
CREATE POLICY "profiles_insert_self" ON public.profiles FOR INSERT
  WITH CHECK (
    (auth.uid() = id AND role = 'viewer')
    OR public.get_user_role(auth.uid()) IN ('admin_owner', 'admin')
  );

-- Users can update their own profile (cannot change their role); owners/admins can update anything
CREATE POLICY "profiles_update" ON public.profiles FOR UPDATE
  USING (auth.uid() = id OR public.get_user_role(auth.uid()) IN ('admin_owner', 'admin'))
  WITH CHECK (
    (auth.uid() = id AND role = public.get_user_role(id))
    OR public.get_user_role(auth.uid()) IN ('admin_owner', 'admin')
  );

-- Only owners/admins can delete (and cannot delete themselves)
CREATE POLICY "profiles_delete" ON public.profiles FOR DELETE
  USING (public.get_user_role(auth.uid()) IN ('admin_owner', 'admin') AND id <> auth.uid());

-- ── Table: properties ─────────────────────────────────────────────────────────
-- Common query fields are proper columns; all other Firestore fields go in `data` JSONB.
CREATE TABLE IF NOT EXISTS public.properties (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      BIGINT  DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
  updated_at      BIGINT,
  created_by      UUID    REFERENCES auth.users(id) ON DELETE SET NULL,
  status          TEXT,
  category        TEXT,
  featured        BOOLEAN DEFAULT FALSE,
  boundary        JSONB,
  boundary_source TEXT,
  coordinates     JSONB,   -- { lat, lng }
  data            JSONB    DEFAULT '{}'::JSONB   -- all other property fields
);

CREATE INDEX IF NOT EXISTS properties_status_idx   ON public.properties (status);
CREATE INDEX IF NOT EXISTS properties_category_idx ON public.properties (category);
CREATE INDEX IF NOT EXISTS properties_featured_idx ON public.properties (featured);
CREATE INDEX IF NOT EXISTS properties_created_idx  ON public.properties (created_at DESC);

ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;

-- Public read for approved & unarchived; staff can read all approved (even archived); owners and creators can read all (including unapproved)
CREATE POLICY "properties_select" ON public.properties FOR SELECT USING (
  (approved = TRUE AND public.is_staff()) OR
  (approved = TRUE AND archived = FALSE) OR
  public.is_owner() OR
  (auth.uid() = created_by)
);
CREATE POLICY "properties_insert" ON public.properties FOR INSERT WITH CHECK (public.is_editor());
CREATE POLICY "properties_update" ON public.properties FOR UPDATE USING (public.is_editor());
CREATE POLICY "properties_delete" ON public.properties FOR DELETE USING (public.is_owner());

-- ── Table: property_docs ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.property_docs (
  id           UUID   PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id  UUID   REFERENCES public.properties(id) ON DELETE CASCADE,
  title        TEXT,
  doc_type     TEXT,   -- 'deed' | 'plan' | 'other'
  file_url     TEXT,
  file_name    TEXT,
  file_size    BIGINT,
  extracted    JSONB,  -- { parcelNo, ownerName, area, lat, lng, location }
  created_at   BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
  created_by   UUID   REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS property_docs_prop_idx ON public.property_docs (property_id);

ALTER TABLE public.property_docs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "property_docs_select" ON public.property_docs FOR SELECT USING (public.is_staff());
CREATE POLICY "property_docs_insert" ON public.property_docs FOR INSERT
  WITH CHECK (public.is_editor() AND property_id IS NOT NULL);
CREATE POLICY "property_docs_update" ON public.property_docs FOR UPDATE USING (public.is_editor());
CREATE POLICY "property_docs_delete" ON public.property_docs FOR DELETE USING (public.is_manager());

-- ── Table: projects ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.projects (
  id         UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
  created_by UUID  REFERENCES auth.users(id) ON DELETE SET NULL,
  data       JSONB DEFAULT '{}'::JSONB
);

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "projects_select" ON public.projects FOR SELECT USING (public.is_staff());
CREATE POLICY "projects_insert" ON public.projects FOR INSERT WITH CHECK (public.is_editor());
CREATE POLICY "projects_update" ON public.projects FOR UPDATE USING (public.is_editor());
CREATE POLICY "projects_delete" ON public.projects FOR DELETE USING (public.is_manager());

-- ── Table: attachments ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.attachments (
  id         UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
  created_by UUID  REFERENCES auth.users(id) ON DELETE SET NULL,
  data       JSONB DEFAULT '{}'::JSONB  -- title, fileUrl, fileName, fileSize, docType, etc.
);

ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "attachments_select" ON public.attachments FOR SELECT USING (public.is_staff());
CREATE POLICY "attachments_insert" ON public.attachments FOR INSERT WITH CHECK (public.is_editor());
CREATE POLICY "attachments_update" ON public.attachments FOR UPDATE USING (public.is_editor());
CREATE POLICY "attachments_delete" ON public.attachments FOR DELETE USING (public.is_owner());

-- ── Table: messages ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.messages (
  id                 UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  from_uid           UUID     REFERENCES auth.users(id) ON DELETE SET NULL,
  from_name          TEXT,
  subject            TEXT,
  body               TEXT,
  to_uids            UUID[]   DEFAULT '{}',  -- direct recipients
  to_all             BOOLEAN  DEFAULT FALSE,  -- broadcast flag
  channels           JSONB    DEFAULT '{}'::JSONB,  -- { email, sms }
  recipients_summary TEXT,
  read_by            JSONB    DEFAULT '{}'::JSONB,  -- { uid: timestamp }
  created_at         BIGINT   DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
);

CREATE INDEX IF NOT EXISTS messages_from_idx  ON public.messages (from_uid);
CREATE INDEX IF NOT EXISTS messages_to_all_idx ON public.messages (to_all) WHERE to_all = TRUE;
CREATE INDEX IF NOT EXISTS messages_to_uids_idx ON public.messages USING GIN (to_uids);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "messages_insert" ON public.messages FOR INSERT
  WITH CHECK (public.is_staff() AND from_uid = auth.uid());

CREATE POLICY "messages_select" ON public.messages FOR SELECT
  USING (
    public.is_staff() AND (
      to_all = TRUE
      OR from_uid = auth.uid()
      OR auth.uid() = ANY(to_uids)
    )
  );

CREATE POLICY "messages_update_readby" ON public.messages FOR UPDATE
  USING (public.is_staff());

CREATE POLICY "messages_delete" ON public.messages FOR DELETE
  USING (public.is_owner() OR (public.is_staff() AND from_uid = auth.uid()));

-- ── Table: logs ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.logs (
  id          UUID   PRIMARY KEY DEFAULT gen_random_uuid(),
  action      TEXT,
  target_type TEXT,
  target_id   TEXT,
  user_id     UUID   REFERENCES auth.users(id) ON DELETE SET NULL,
  meta        JSONB,
  timestamp   BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
);

CREATE INDEX IF NOT EXISTS logs_timestamp_idx ON public.logs (timestamp DESC);

ALTER TABLE public.logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "logs_select" ON public.logs FOR SELECT USING (public.is_staff());
CREATE POLICY "logs_insert" ON public.logs FOR INSERT WITH CHECK (public.is_staff());
-- logs are append-only: no update or delete

-- ── Table: databases (custom database builder schemas) ────────────────────────
CREATE TABLE IF NOT EXISTS public.databases (
  id          UUID   PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT   NOT NULL,
  description TEXT   DEFAULT '',
  category    TEXT   DEFAULT '',
  icon        TEXT   DEFAULT 'database',
  fields      JSONB  DEFAULT '[]'::JSONB,  -- array of field definition objects
  created_at  BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
  updated_at  BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
  created_by  UUID   REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.databases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "databases_select" ON public.databases FOR SELECT USING (public.is_staff());
CREATE POLICY "databases_insert" ON public.databases FOR INSERT WITH CHECK (public.is_editor());
CREATE POLICY "databases_update" ON public.databases FOR UPDATE USING (public.is_editor());
CREATE POLICY "databases_delete" ON public.databases FOR DELETE USING (public.is_manager());

-- ── Table: database_records ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.database_records (
  id          UUID   PRIMARY KEY DEFAULT gen_random_uuid(),
  db_id       UUID   REFERENCES public.databases(id) ON DELETE CASCADE,
  data        JSONB  DEFAULT '{}'::JSONB,
  _created_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
  _updated_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
  _created_by UUID   REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS db_records_db_id_idx ON public.database_records (db_id);

ALTER TABLE public.database_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "db_records_select" ON public.database_records FOR SELECT USING (public.is_staff());
CREATE POLICY "db_records_insert" ON public.database_records FOR INSERT WITH CHECK (public.is_editor());
CREATE POLICY "db_records_update" ON public.database_records FOR UPDATE USING (public.is_editor());
CREATE POLICY "db_records_delete" ON public.database_records FOR DELETE USING (public.is_editor());

-- ── Table: taxonomy ───────────────────────────────────────────────────────────
-- Unified table replacing 5 Firestore collections: locations, features,
-- amenities, types, categories.
CREATE TABLE IF NOT EXISTS public.taxonomy (
  type TEXT NOT NULL CHECK (type IN ('locations','features','amenities','types','categories')),
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY (type, slug)
);

ALTER TABLE public.taxonomy ENABLE ROW LEVEL SECURITY;

-- Public read (taxonomy is used by public-facing property pages)
CREATE POLICY "taxonomy_select" ON public.taxonomy FOR SELECT USING (true);
CREATE POLICY "taxonomy_insert" ON public.taxonomy FOR INSERT WITH CHECK (public.is_manager());
CREATE POLICY "taxonomy_update" ON public.taxonomy FOR UPDATE USING (public.is_manager());
CREATE POLICY "taxonomy_delete" ON public.taxonomy FOR DELETE USING (public.is_manager());

-- ── Storage Buckets ───────────────────────────────────────────────────────────
-- Run these in the Supabase Dashboard → Storage, or via the API.
-- land-images: public read, authenticated write
-- deed-images: staff-only read/write

-- INSERT INTO storage.buckets (id, name, public) VALUES ('land-images', 'land-images', true);
-- INSERT INTO storage.buckets (id, name, public) VALUES ('deed-images', 'deed-images', false);

-- Storage RLS (land-images — public read):
-- CREATE POLICY "land_images_select" ON storage.objects FOR SELECT USING (bucket_id = 'land-images');
-- CREATE POLICY "land_images_insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'land-images' AND public.is_editor());
-- CREATE POLICY "land_images_delete" ON storage.objects FOR DELETE USING (bucket_id = 'land-images' AND public.is_manager());

-- Storage RLS (deed-images — staff only):
-- CREATE POLICY "deed_images_select" ON storage.objects FOR SELECT USING (bucket_id = 'deed-images' AND public.is_staff());
-- CREATE POLICY "deed_images_insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'deed-images' AND public.is_editor());
-- CREATE POLICY "deed_images_delete" ON storage.objects FOR DELETE USING (bucket_id = 'deed-images' AND public.is_manager());

-- ── Trigger: auto-create profile row on new auth user ─────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, role, disabled, created_at)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'role', 'viewer'),
    false,
    (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── RPC: lookup email by username ──────────────────────────────────────────────
-- Allowed for public (unauthenticated) calls during the login process.
CREATE OR REPLACE FUNCTION public.get_email_by_username(p_username TEXT)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_email TEXT;
BEGIN
  SELECT email INTO v_email FROM public.profiles WHERE LOWER(username) = LOWER(p_username);
  RETURN v_email;
END;
$$;

-- ── Property Approval & Archiving Schema Modifications ────────────────────────
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS approved BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE;

-- Trigger: Enforce unapproved status for non-owners on property INSERT
CREATE OR REPLACE FUNCTION public.handle_property_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- If user is NOT owner and auth.uid() is not null, override approved to FALSE
  IF auth.uid() IS NOT NULL AND NOT public.is_owner() THEN
    NEW.approved := FALSE;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_property_insert ON public.properties;
CREATE TRIGGER on_property_insert
  BEFORE INSERT ON public.properties
  FOR EACH ROW EXECUTE FUNCTION public.handle_property_insert();

-- Trigger: Prevent non-owners from approving a property on UPDATE
CREATE OR REPLACE FUNCTION public.handle_property_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- If user is NOT owner, override approved to OLD value (non-owners cannot approve)
  IF auth.uid() IS NOT NULL AND NOT public.is_owner() THEN
    NEW.approved := OLD.approved;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_property_update ON public.properties;
CREATE TRIGGER on_property_update
  BEFORE UPDATE ON public.properties
  FOR EACH ROW EXECUTE FUNCTION public.handle_property_update();

