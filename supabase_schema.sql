-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.roles (
  id integer NOT NULL DEFAULT nextval('roles_id_seq'::regclass),
  name text NOT NULL UNIQUE,
  CONSTRAINT roles_pkey PRIMARY KEY (id)
);
CREATE TABLE public.users (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  first_name text NOT NULL,
  last_name text NOT NULL,
  password_hash text NOT NULL,
  role_id integer NOT NULL DEFAULT 1,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT users_pkey PRIMARY KEY (id),
  CONSTRAINT users_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id)
);
CREATE TABLE public.categories (
  id integer NOT NULL DEFAULT nextval('categories_id_seq'::regclass),
  name text NOT NULL,
  description text,
  is_active boolean DEFAULT true,
  sort_order integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT categories_pkey PRIMARY KEY (id)
);
CREATE TABLE public.criteria (
  id integer NOT NULL DEFAULT nextval('criteria_id_seq'::regclass),
  name text NOT NULL,
  description text,
  icon text,
  max_points numeric DEFAULT 5,
  weight numeric DEFAULT 1.0,
  is_active boolean DEFAULT true,
  sort_order integer DEFAULT 0,
  CONSTRAINT criteria_pkey PRIMARY KEY (id)
);
CREATE TABLE public.photos (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL,
  filename text NOT NULL,
  original_name text,
  mime_type text,
  size_bytes integer,
  storage_path text NOT NULL,
  is_submitted boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT photos_pkey PRIMARY KEY (id),
  CONSTRAINT photos_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);
CREATE TABLE public.submissions (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  photo_id uuid NOT NULL,
  user_id uuid NOT NULL,
  category_id integer NOT NULL,
  anonymous_id text NOT NULL UNIQUE,
  display_order integer,
  submitted_at timestamp with time zone DEFAULT now(),
  CONSTRAINT submissions_pkey PRIMARY KEY (id),
  CONSTRAINT submissions_photo_id_fkey FOREIGN KEY (photo_id) REFERENCES public.photos(id),
  CONSTRAINT submissions_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id),
  CONSTRAINT submissions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);
CREATE TABLE public.scores (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  submission_id uuid NOT NULL,
  juror_id uuid NOT NULL,
  criterion_id integer NOT NULL,
  value numeric DEFAULT 0 CHECK (value >= 0::numeric),
  is_validated boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT scores_pkey PRIMARY KEY (id),
  CONSTRAINT scores_criterion_id_fkey FOREIGN KEY (criterion_id) REFERENCES public.criteria(id),
  CONSTRAINT scores_juror_id_fkey FOREIGN KEY (juror_id) REFERENCES public.users(id),
  CONSTRAINT scores_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.submissions(id)
);
CREATE TABLE public.favorites (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  juror_id uuid NOT NULL,
  submission_id uuid NOT NULL,
  category_id integer NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT favorites_pkey PRIMARY KEY (id),
  CONSTRAINT favorites_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id),
  CONSTRAINT favorites_juror_id_fkey FOREIGN KEY (juror_id) REFERENCES public.users(id),
  CONSTRAINT favorites_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.submissions(id)
);
CREATE TABLE public.results (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  category_id integer,
  submission_id uuid,
  rank integer,
  average_score numeric,
  total_score numeric,
  is_published boolean DEFAULT false,
  published_at timestamp with time zone,
  published_by uuid,
  computed_at timestamp with time zone DEFAULT now(),
  jurors_can_view boolean DEFAULT false,
  CONSTRAINT results_pkey PRIMARY KEY (id),
  CONSTRAINT results_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id),
  CONSTRAINT results_published_by_fkey FOREIGN KEY (published_by) REFERENCES public.users(id),
  CONSTRAINT results_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.submissions(id)
);
CREATE TABLE public.jury_validations (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  juror_id uuid NOT NULL,
  submission_id uuid NOT NULL,
  validated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT jury_validations_pkey PRIMARY KEY (id),
  CONSTRAINT jury_validations_juror_id_fkey FOREIGN KEY (juror_id) REFERENCES public.users(id),
  CONSTRAINT jury_validations_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.submissions(id)
);
CREATE TABLE public.audit_log (
  id bigint NOT NULL DEFAULT nextval('audit_log_id_seq'::regclass),
  user_id uuid,
  action text NOT NULL,
  entity text,
  entity_id text,
  details jsonb,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT audit_log_pkey PRIMARY KEY (id),
  CONSTRAINT audit_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);
CREATE TABLE public.notes (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  juror_id uuid NOT NULL,
  submission_id uuid NOT NULL,
  content text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT notes_pkey PRIMARY KEY (id),
  CONSTRAINT notes_juror_id_fkey FOREIGN KEY (juror_id) REFERENCES public.users(id),
  CONSTRAINT notes_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.submissions(id)
);
CREATE TABLE public.deliberation_sessions (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  category_id integer NOT NULL,
  current_photo_id uuid,
  status text DEFAULT 'pending'::text,
  opened_at timestamp with time zone,
  closed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  created_by uuid,
  CONSTRAINT deliberation_sessions_pkey PRIMARY KEY (id),
  CONSTRAINT deliberation_sessions_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id),
  CONSTRAINT deliberation_sessions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id),
  CONSTRAINT deliberation_sessions_current_photo_id_fkey FOREIGN KEY (current_photo_id) REFERENCES public.submissions(id)
);
CREATE TABLE public.eye_prize_selections (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  submission_id uuid NOT NULL UNIQUE,
  selected_by uuid,
  selected_at timestamp with time zone DEFAULT now(),
  juror_votes jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT eye_prize_selections_pkey PRIMARY KEY (id),
  CONSTRAINT eye_prize_selections_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.submissions(id),
  CONSTRAINT eye_prize_selections_selected_by_fkey FOREIGN KEY (selected_by) REFERENCES public.users(id)
);
CREATE TABLE public.eye_prize_votes (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  juror_id uuid NOT NULL,
  submission_id uuid NOT NULL,
  category_id integer,
  voted_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT eye_prize_votes_pkey PRIMARY KEY (id),
  CONSTRAINT eye_prize_votes_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.submissions(id),
  CONSTRAINT eye_prize_votes_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id),
  CONSTRAINT eye_prize_votes_juror_id_fkey FOREIGN KEY (juror_id) REFERENCES public.users(id)
);
CREATE TABLE public.eye_prize_result (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  submission_id uuid NOT NULL,
  total_votes integer DEFAULT 0,
  is_finalized boolean DEFAULT false,
  finalized_at timestamp with time zone,
  finalized_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT eye_prize_result_pkey PRIMARY KEY (id),
  CONSTRAINT eye_prize_result_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.submissions(id),
  CONSTRAINT eye_prize_result_finalized_by_fkey FOREIGN KEY (finalized_by) REFERENCES public.users(id)
);
CREATE TABLE public.eye_prize_state (
  id integer NOT NULL DEFAULT 1 CHECK (id = 1),
  has_tie boolean DEFAULT false,
  resolved_at timestamp with time zone,
  resolved_by uuid,
  winning_submission_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT eye_prize_state_pkey PRIMARY KEY (id),
  CONSTRAINT eye_prize_state_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.users(id),
  CONSTRAINT eye_prize_state_winning_submission_id_fkey FOREIGN KEY (winning_submission_id) REFERENCES public.submissions(id)
);