ALTER TABLE "submissions" ADD COLUMN "topic_slugs" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "programme_id" integer;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "moderator_note" text;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_programme_id_programmes_id_fk" FOREIGN KEY ("programme_id") REFERENCES "public"."programmes"("id") ON DELETE set null ON UPDATE no action;