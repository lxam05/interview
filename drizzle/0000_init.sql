CREATE TYPE "public"."brief_version_status" AS ENUM('draft', 'in_review', 'published', 'unpublished', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."claim_status" AS ENUM('extracted', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."claim_type" AS ENUM('topic', 'process_stage', 'format', 'advice', 'official_policy');--> statement-breakpoint
CREATE TYPE "public"."correction_kind" AS ENUM('error', 'outdated', 'removal_request');--> statement-breakpoint
CREATE TYPE "public"."correction_status" AS ENUM('open', 'resolved', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."interview_stage" AS ENUM('application', 'online_assessment', 'phone_screen', 'technical_interview', 'behavioural_interview', 'final_round', 'other');--> statement-breakpoint
CREATE TYPE "public"."region" AS ENUM('ireland', 'international', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."role_level" AS ENUM('intern', 'graduate', 'experienced', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('queued', 'running', 'succeeded', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "public"."source_platform" AS ENUM('github', 'hackernews', 'web', 'official', 'community');--> statement-breakpoint
CREATE TYPE "public"."source_status" AS ENUM('discovered', 'retrieved', 'not_permitted', 'unavailable', 'blocked', 'failed');--> statement-breakpoint
CREATE TYPE "public"."submission_status" AS ENUM('pending', 'approved', 'rejected', 'removed');--> statement-breakpoint
CREATE TABLE "brief_version_claims" (
	"version_id" integer NOT NULL,
	"claim_id" integer NOT NULL,
	CONSTRAINT "brief_version_claims_version_id_claim_id_pk" PRIMARY KEY("version_id","claim_id")
);
--> statement-breakpoint
CREATE TABLE "brief_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"brief_id" integer NOT NULL,
	"version" integer NOT NULL,
	"status" "brief_version_status" DEFAULT 'draft' NOT NULL,
	"content" jsonb NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	"reviewer_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "briefs" (
	"id" serial PRIMARY KEY NOT NULL,
	"programme_id" integer NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"needs_review_reason" text,
	"is_synthetic" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "briefs_programme_id_unique" UNIQUE("programme_id")
);
--> statement-breakpoint
CREATE TABLE "claim_topics" (
	"claim_id" integer NOT NULL,
	"topic_id" integer NOT NULL,
	CONSTRAINT "claim_topics_claim_id_topic_id_pk" PRIMARY KEY("claim_id","topic_id")
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_document_id" integer NOT NULL,
	"programme_id" integer NOT NULL,
	"run_id" integer,
	"type" "claim_type" NOT NULL,
	"statement" text NOT NULL,
	"quote" text NOT NULL,
	"stage" "interview_stage",
	"role_level" "role_level" DEFAULT 'unknown' NOT NULL,
	"region" "region" DEFAULT 'unknown' NOT NULL,
	"firsthand" boolean,
	"interview_year" integer,
	"interview_month" integer,
	"duration_minutes" integer,
	"status" "claim_status" DEFAULT 'extracted' NOT NULL,
	"duplicate_of_claim_id" integer,
	"extractor_version" text NOT NULL,
	"model" text NOT NULL,
	"is_synthetic" boolean DEFAULT false NOT NULL,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"website" text,
	"is_synthetic" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "company_aliases" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"alias" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "corrections" (
	"id" serial PRIMARY KEY NOT NULL,
	"programme_id" integer,
	"kind" "correction_kind" NOT NULL,
	"message" text NOT NULL,
	"contact" text,
	"status" "correction_status" DEFAULT 'open' NOT NULL,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"country" text DEFAULT 'IE' NOT NULL,
	CONSTRAINT "locations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "programmes" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"role_id" integer NOT NULL,
	"location_id" integer,
	"cycle" text,
	"slug" text NOT NULL,
	"is_synthetic" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"id" serial PRIMARY KEY NOT NULL,
	"bucket" text NOT NULL,
	"ip_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_queries" (
	"id" serial PRIMARY KEY NOT NULL,
	"adapter" text NOT NULL,
	"query" text NOT NULL,
	"result_count" integer DEFAULT 0 NOT NULL,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_run_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"stage" text NOT NULL,
	"source_id" integer,
	"outcome" text NOT NULL,
	"error_code" text,
	"message" text,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_run_sources" (
	"run_id" integer NOT NULL,
	"source_id" integer NOT NULL,
	CONSTRAINT "research_run_sources_run_id_source_id_pk" PRIMARY KEY("run_id","source_id")
);
--> statement-breakpoint
CREATE TABLE "research_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"programme_id" integer NOT NULL,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"requested_by" text DEFAULT 'cli' NOT NULL,
	"max_cost_usd" numeric(10, 4),
	"cost_usd" numeric(10, 4) DEFAULT '0' NOT NULL,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"is_synthetic" boolean DEFAULT false NOT NULL,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "resources" (
	"id" serial PRIMARY KEY NOT NULL,
	"topic_id" integer NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" integer NOT NULL,
	"action" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "roles_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "source_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" integer NOT NULL,
	"content_hash" text NOT NULL,
	"text" text NOT NULL,
	"truncated" boolean DEFAULT false NOT NULL,
	"retrieved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"canonical_url" text NOT NULL,
	"platform" "source_platform" NOT NULL,
	"title" text,
	"author" text,
	"published_at" timestamp with time zone,
	"reuse_note" text,
	"status" "source_status" DEFAULT 'discovered' NOT NULL,
	"status_reason" text,
	"is_synthetic" boolean DEFAULT false NOT NULL,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sources_canonical_url_unique" UNIQUE("canonical_url")
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_name" text NOT NULL,
	"role_name" text NOT NULL,
	"location_name" text NOT NULL,
	"interview_year" integer NOT NULL,
	"interview_month" integer,
	"stage" "interview_stage" NOT NULL,
	"format" text NOT NULL,
	"topics" text NOT NULL,
	"difficulty" integer,
	"advice" text,
	"comments" text,
	"display_name" text,
	"consent" boolean NOT NULL,
	"status" "submission_status" DEFAULT 'pending' NOT NULL,
	"idempotency_key" text NOT NULL,
	"ip_hash" text,
	"source_id" integer,
	"is_synthetic" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submissions_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "topics" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "topics_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer,
	"provider" text NOT NULL,
	"kind" text NOT NULL,
	"calls" integer DEFAULT 1 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(10, 6) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brief_version_claims" ADD CONSTRAINT "brief_version_claims_version_id_brief_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."brief_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brief_version_claims" ADD CONSTRAINT "brief_version_claims_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brief_versions" ADD CONSTRAINT "brief_versions_brief_id_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."briefs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_programme_id_programmes_id_fk" FOREIGN KEY ("programme_id") REFERENCES "public"."programmes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_topics" ADD CONSTRAINT "claim_topics_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_topics" ADD CONSTRAINT "claim_topics_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_source_document_id_source_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_programme_id_programmes_id_fk" FOREIGN KEY ("programme_id") REFERENCES "public"."programmes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_aliases" ADD CONSTRAINT "company_aliases_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrections" ADD CONSTRAINT "corrections_programme_id_programmes_id_fk" FOREIGN KEY ("programme_id") REFERENCES "public"."programmes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programmes" ADD CONSTRAINT "programmes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programmes" ADD CONSTRAINT "programmes_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programmes" ADD CONSTRAINT "programmes_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_run_events" ADD CONSTRAINT "research_run_events_run_id_research_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."research_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_run_sources" ADD CONSTRAINT "research_run_sources_run_id_research_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."research_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_run_sources" ADD CONSTRAINT "research_run_sources_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_runs" ADD CONSTRAINT "research_runs_programme_id_programmes_id_fk" FOREIGN KEY ("programme_id") REFERENCES "public"."programmes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_documents" ADD CONSTRAINT "source_documents_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "brief_version_claims_claim" ON "brief_version_claims" USING btree ("claim_id");--> statement-breakpoint
CREATE UNIQUE INDEX "brief_versions_brief_version" ON "brief_versions" USING btree ("brief_id","version");--> statement-breakpoint
CREATE INDEX "brief_versions_brief_status" ON "brief_versions" USING btree ("brief_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "brief_versions_one_published" ON "brief_versions" USING btree ("brief_id") WHERE "brief_versions"."status" = 'published';--> statement-breakpoint
CREATE INDEX "claims_source_document" ON "claims" USING btree ("source_document_id");--> statement-breakpoint
CREATE INDEX "claims_programme_status" ON "claims" USING btree ("programme_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "company_aliases_unique" ON "company_aliases" USING btree ("company_id",lower("alias"));--> statement-breakpoint
CREATE INDEX "corrections_status" ON "corrections" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "programmes_company_slug" ON "programmes" USING btree ("company_id","slug");--> statement-breakpoint
CREATE INDEX "rate_limits_lookup" ON "rate_limits" USING btree ("bucket","ip_hash","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "research_queries_adapter_query" ON "research_queries" USING btree ("adapter","query");--> statement-breakpoint
CREATE INDEX "research_run_events_run" ON "research_run_events" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "research_runs_one_active" ON "research_runs" USING btree ("programme_id") WHERE "research_runs"."status" in ('queued', 'running');--> statement-breakpoint
CREATE UNIQUE INDEX "resources_topic_url" ON "resources" USING btree ("topic_id","url");--> statement-breakpoint
CREATE UNIQUE INDEX "source_documents_source_hash" ON "source_documents" USING btree ("source_id","content_hash");--> statement-breakpoint
CREATE INDEX "submissions_status" ON "submissions" USING btree ("status");