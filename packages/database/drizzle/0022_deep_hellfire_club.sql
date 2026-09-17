CREATE TYPE "public"."campaign_status" AS ENUM('draft', 'scheduled', 'sending', 'completed', 'canceled');--> statement-breakpoint
CREATE TABLE "campaign" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "campaign_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" bigint NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"channel" "channel" NOT NULL,
	"topic_id" bigint NOT NULL,
	"targets" jsonb NOT NULL,
	"payload" jsonb NOT NULL,
	"schedule" jsonb,
	"status" "campaign_status" DEFAULT 'draft' NOT NULL,
	"throttle_per_minute" integer,
	"audience_estimate" integer,
	"launched_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "campaign_targets_object" CHECK (jsonb_typeof("campaign"."targets") = 'object'),
	CONSTRAINT "campaign_payload_object" CHECK (jsonb_typeof("campaign"."payload") = 'object'),
	CONSTRAINT "campaign_throttle_positive" CHECK ("campaign"."throttle_per_minute" is null or "campaign"."throttle_per_minute" > 0)
);
--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "campaign_id" bigint;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "throttle_per_minute" integer;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "fanout_resume_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_topic_id_topic_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topic"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_tenant_slug_unique" ON "campaign" USING btree ("tenant_id","slug") WHERE "campaign"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "campaign_tenant_idx" ON "campaign" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_campaign_idx" ON "message" USING btree ("tenant_id","campaign_id","id") WHERE "message"."campaign_id" is not null;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_throttle_positive" CHECK ("message"."throttle_per_minute" is null or "message"."throttle_per_minute" > 0);