import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1791400000001 implements MigrationInterface {
  name = 'InitialSchema1791400000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TYPE "public"."user_role" AS ENUM('customer', 'driver', 'admin', 'staff')
        `);
    await queryRunner.query(`
            CREATE TYPE "public"."user_status" AS ENUM('active', 'suspended', 'deleted')
        `);
    await queryRunner.query(`
            CREATE TABLE "users" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "phone" character varying(20) NOT NULL,
                "email" character varying(255),
                "full_name" character varying(120),
                "role" "public"."user_role" NOT NULL,
                "status" "public"."user_status" NOT NULL DEFAULT 'active',
                "phone_verified_at" TIMESTAMP WITH TIME ZONE,
                "last_login_at" TIMESTAMP WITH TIME ZONE,
                CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "uq_users_phone" ON "users" ("phone")
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "uq_users_email" ON "users" ("email")
            WHERE "email" IS NOT NULL
        `);
    await queryRunner.query(`
            CREATE INDEX "ix_users_role" ON "users" ("role")
        `);
    await queryRunner.query(`
            CREATE TABLE "audit_logs" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "actor_user_id" uuid,
                "action" character varying(100) NOT NULL,
                "entity_type" character varying(60) NOT NULL,
                "entity_id" uuid,
                "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
                "ip_address" inet,
                "user_agent" character varying(255),
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_1bb179d048bbc581caa3b013439" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "ix_audit_logs_actor_created" ON "audit_logs" ("actor_user_id", "created_at")
        `);
    await queryRunner.query(`
            CREATE INDEX "ix_audit_logs_entity" ON "audit_logs" ("entity_type", "entity_id")
        `);
    await queryRunner.query(`
            CREATE TABLE "auth_sessions" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "user_id" uuid NOT NULL,
                "refresh_token_hash" character varying(255) NOT NULL,
                "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
                "revoked_at" TIMESTAMP WITH TIME ZONE,
                "user_agent" character varying(255),
                "ip_address" inet,
                CONSTRAINT "PK_641507381f32580e8479efc36cd" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "uq_auth_sessions_refresh_token_hash" ON "auth_sessions" ("refresh_token_hash")
        `);
    await queryRunner.query(`
            CREATE INDEX "ix_auth_sessions_user" ON "auth_sessions" ("user_id")
        `);
    await queryRunner.query(`
            CREATE TABLE "otp_challenges" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "phone" character varying(20) NOT NULL,
                "code_hash" character varying(255) NOT NULL,
                "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
                "attempts" smallint NOT NULL DEFAULT '0',
                "consumed_at" TIMESTAMP WITH TIME ZONE,
                "request_ip" inet,
                CONSTRAINT "PK_c34f21df6c8aa51229715452068" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "ix_otp_challenges_phone_created" ON "otp_challenges" ("phone", "created_at")
        `);
    await queryRunner.query(`
            CREATE TYPE "public"."payment_method" AS ENUM('cash', 'card', 'apple_pay')
        `);
    await queryRunner.query(`
            CREATE TABLE "customers" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "user_id" uuid NOT NULL,
                "default_payment_method" "public"."payment_method",
                CONSTRAINT "REL_11d81cd7be87b6f8865b0cf766" UNIQUE ("user_id"),
                CONSTRAINT "PK_133ec679a801fab5e070f73d3ea" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "uq_customers_user" ON "customers" ("user_id")
        `);
    await queryRunner.query(`
            CREATE TYPE "public"."kyc_status" AS ENUM('pending', 'approved', 'rejected', 'suspended')
        `);
    await queryRunner.query(`
            CREATE TYPE "public"."driver_availability" AS ENUM('offline', 'online', 'busy', 'en_route')
        `);
    await queryRunner.query(`
            CREATE TABLE "drivers" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "user_id" uuid NOT NULL,
                "kyc_status" "public"."kyc_status" NOT NULL DEFAULT 'pending',
                "availability" "public"."driver_availability" NOT NULL DEFAULT 'offline',
                "rating" numeric(3, 2),
                "total_trips" integer NOT NULL DEFAULT '0',
                "experience_years" smallint NOT NULL DEFAULT '0',
                "acceptance_rate" numeric(5, 2),
                "current_location" geography(Point, 4326),
                "location_updated_at" TIMESTAMP WITH TIME ZONE,
                CONSTRAINT "REL_8e224f1b8f05ace7cfc7c76d03" UNIQUE ("user_id"),
                CONSTRAINT "PK_92ab3fb69e566d3eb0cae896047" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "uq_drivers_user" ON "drivers" ("user_id")
        `);
    await queryRunner.query(`
            CREATE INDEX "ix_drivers_current_location" ON "drivers" USING gist ("current_location")
        `);
    await queryRunner.query(`
            CREATE INDEX "ix_drivers_dispatch" ON "drivers" ("kyc_status", "availability")
        `);
    await queryRunner.query(`
            CREATE TYPE "public"."tow_type" AS ENUM('flatbed', 'wheel-lift', 'bike-carrier')
        `);
    await queryRunner.query(`
            CREATE TYPE "public"."emirate" AS ENUM(
                'Dubai',
                'Abu Dhabi',
                'Sharjah',
                'Ajman',
                'Umm Al Quwain',
                'Ras Al Khaimah',
                'Fujairah'
            )
        `);
    await queryRunner.query(`
            CREATE TABLE "tow_trucks" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "driver_id" uuid NOT NULL,
                "tow_type" "public"."tow_type" NOT NULL,
                "model" character varying(80) NOT NULL,
                "year" smallint NOT NULL,
                "plate_emirate" "public"."emirate" NOT NULL,
                "plate_code" character varying(3) NOT NULL,
                "plate_number" character varying(6) NOT NULL,
                "is_active" boolean NOT NULL DEFAULT true,
                CONSTRAINT "PK_8350a7360cf788f94a68b70c605" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "uq_tow_trucks_plate" ON "tow_trucks" ("plate_emirate", "plate_code", "plate_number")
        `);
    await queryRunner.query(`
            CREATE INDEX "ix_tow_trucks_driver" ON "tow_trucks" ("driver_id")
        `);
    await queryRunner.query(`
            CREATE TYPE "public"."zone_status" AS ENUM('active', 'peak', 'restricted')
        `);
    await queryRunner.query(`
            CREATE TABLE "service_zones" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "name" character varying(120) NOT NULL,
                "emirate" "public"."emirate" NOT NULL,
                "status" "public"."zone_status" NOT NULL DEFAULT 'active',
                "area" geography(MultiPolygon, 4326) NOT NULL,
                "surge_multiplier" numeric(4, 2) NOT NULL DEFAULT '1',
                "is_active" boolean NOT NULL DEFAULT true,
                CONSTRAINT "PK_1fadb6afc50f01a0d66ab68c12d" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "uq_service_zones_name" ON "service_zones" ("name")
        `);
    await queryRunner.query(`
            CREATE INDEX "ix_service_zones_area" ON "service_zones" USING gist ("area")
        `);
    await queryRunner.query(`
            CREATE TABLE "pricing_rules" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "tow_type" "public"."tow_type" NOT NULL,
                "base_fare_fils" integer NOT NULL,
                "per_km_fils" integer NOT NULL,
                "minimum_fare_fils" integer NOT NULL,
                "tow_type_surcharge_fils" integer NOT NULL DEFAULT '0',
                "night_surcharge_fils" integer NOT NULL DEFAULT '0',
                "vat_rate_bps" integer NOT NULL DEFAULT '500',
                "platform_commission_bps" integer NOT NULL DEFAULT '2000',
                "currency" character(3) NOT NULL DEFAULT 'AED',
                "effective_from" TIMESTAMP WITH TIME ZONE NOT NULL,
                "effective_to" TIMESTAMP WITH TIME ZONE,
                "is_active" boolean NOT NULL DEFAULT true,
                CONSTRAINT "PK_fda27bb8db4630894decda61ff6" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "ix_pricing_rules_lookup" ON "pricing_rules" ("tow_type", "is_active", "effective_from")
        `);
    await queryRunner.query(`
            CREATE TYPE "public"."vehicle_category" AS ENUM('car', 'motorbike')
        `);
    await queryRunner.query(`
            CREATE TABLE "customer_vehicles" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "customer_id" uuid NOT NULL,
                "category" "public"."vehicle_category" NOT NULL,
                "brand" character varying(60) NOT NULL,
                "model" character varying(80) NOT NULL,
                "year" smallint NOT NULL,
                "color" character varying(40),
                "plate_emirate" "public"."emirate" NOT NULL,
                "plate_code" character varying(3) NOT NULL,
                "plate_number" character varying(6) NOT NULL,
                "is_default" boolean NOT NULL DEFAULT false,
                "deleted_at" TIMESTAMP WITH TIME ZONE,
                CONSTRAINT "PK_d2f39f888b9426c8f6dfc4d0253" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "uq_customer_vehicles_plate" ON "customer_vehicles" (
                "customer_id",
                "plate_emirate",
                "plate_code",
                "plate_number"
            )
            WHERE "deleted_at" IS NULL
        `);
    await queryRunner.query(`
            CREATE INDEX "ix_customer_vehicles_customer" ON "customer_vehicles" ("customer_id")
        `);
    await queryRunner.query(`
            CREATE TYPE "public"."vehicle_issue" AS ENUM(
                'Breakdown',
                'Flat Tyre',
                'Accident',
                'Battery Issue',
                'Engine Issue',
                'Overheating',
                'Locked Out',
                'Other'
            )
        `);
    await queryRunner.query(`
            CREATE TYPE "public"."booking_status" AS ENUM(
                'requested',
                'searching',
                'driver_assigned',
                'driver_arriving',
                'driver_arrived',
                'vehicle_loaded',
                'in_transit',
                'completed',
                'cancelled'
            )
        `);
    await queryRunner.query(`
            CREATE TYPE "public"."cancelled_by" AS ENUM('customer', 'driver', 'admin', 'system')
        `);
    await queryRunner.query(`
            CREATE TABLE "bookings" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "booking_number" character varying(20) NOT NULL,
                "customer_id" uuid NOT NULL,
                "customer_vehicle_id" uuid NOT NULL,
                "driver_id" uuid,
                "tow_truck_id" uuid,
                "tow_type" "public"."tow_type" NOT NULL,
                "issue" "public"."vehicle_issue" NOT NULL,
                "status" "public"."booking_status" NOT NULL DEFAULT 'requested',
                "notes" text,
                "pickup_point" geography(Point, 4326) NOT NULL,
                "pickup_address" text NOT NULL,
                "dropoff_point" geography(Point, 4326) NOT NULL,
                "dropoff_address" text NOT NULL,
                "service_zone_id" uuid,
                "distance_meters" integer NOT NULL,
                "estimated_duration_seconds" integer,
                "pricing_rule_id" uuid NOT NULL,
                "base_fare_fils" integer NOT NULL,
                "distance_charge_fils" integer NOT NULL,
                "tow_type_charge_fils" integer NOT NULL DEFAULT '0',
                "additional_charges_fils" integer NOT NULL DEFAULT '0',
                "subtotal_fils" integer NOT NULL,
                "vat_fils" integer NOT NULL,
                "total_fils" integer NOT NULL,
                "currency" character(3) NOT NULL DEFAULT 'AED',
                "payment_method" "public"."payment_method" NOT NULL,
                "assigned_at" TIMESTAMP WITH TIME ZONE,
                "completed_at" TIMESTAMP WITH TIME ZONE,
                "cancelled_at" TIMESTAMP WITH TIME ZONE,
                "cancelled_by" "public"."cancelled_by",
                "cancellation_reason" character varying(255),
                CONSTRAINT "PK_bee6805982cc1e248e94ce94957" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "uq_bookings_booking_number" ON "bookings" ("booking_number")
        `);
    await queryRunner.query(`
            CREATE INDEX "ix_bookings_pickup_point" ON "bookings" USING gist ("pickup_point")
        `);
    await queryRunner.query(`
            CREATE INDEX "ix_bookings_status" ON "bookings" ("status")
        `);
    await queryRunner.query(`
            CREATE INDEX "ix_bookings_driver_status" ON "bookings" ("driver_id", "status")
        `);
    await queryRunner.query(`
            CREATE INDEX "ix_bookings_customer_created" ON "bookings" ("customer_id", "created_at")
        `);
    await queryRunner.query(`
            CREATE TABLE "booking_status_history" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "booking_id" uuid NOT NULL,
                "from_status" "public"."booking_status",
                "to_status" "public"."booking_status" NOT NULL,
                "actor_user_id" uuid,
                "note" character varying(255),
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_589851c586ac15a59462092c0cd" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "ix_booking_status_history_booking" ON "booking_status_history" ("booking_id", "created_at")
        `);
    await queryRunner.query(`
            CREATE TABLE "chat_messages" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "booking_id" uuid NOT NULL,
                "sender_id" uuid NOT NULL,
                "body" character varying(1000) NOT NULL,
                "read_at" TIMESTAMP WITH TIME ZONE,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_40c55ee0e571e268b0d3cd37d10" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "ix_chat_messages_booking_created" ON "chat_messages" ("booking_id", "created_at")
        `);
    await queryRunner.query(`
            CREATE TYPE "public"."driver_document_type" AS ENUM(
                'emirates_id',
                'driving_licence',
                'vehicle_registration',
                'commercial_insurance'
            )
        `);
    await queryRunner.query(`
            CREATE TYPE "public"."document_status" AS ENUM('pending', 'approved', 'rejected', 'expired')
        `);
    await queryRunner.query(`
            CREATE TABLE "driver_documents" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "driver_id" uuid NOT NULL,
                "type" "public"."driver_document_type" NOT NULL,
                "status" "public"."document_status" NOT NULL DEFAULT 'pending',
                "file_key" character varying(512) NOT NULL,
                "document_number" character varying(64),
                "expires_on" date,
                "reviewed_by_id" uuid,
                "reviewed_at" TIMESTAMP WITH TIME ZONE,
                "rejection_reason" character varying(255),
                CONSTRAINT "PK_31c28b4e8f55a5d411597d45ab2" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "uq_driver_documents_driver_type" ON "driver_documents" ("driver_id", "type")
        `);
    await queryRunner.query(`
            CREATE TYPE "public"."saved_location_type" AS ENUM('home', 'work', 'garage', 'other')
        `);
    await queryRunner.query(`
            CREATE TABLE "saved_locations" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "customer_id" uuid NOT NULL,
                "type" "public"."saved_location_type" NOT NULL DEFAULT 'other',
                "label" character varying(80) NOT NULL,
                "address" text NOT NULL,
                "emirate" "public"."emirate" NOT NULL,
                "point" geography(Point, 4326) NOT NULL,
                CONSTRAINT "PK_bc4bde22511c9a2963727c194cd" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "ix_saved_locations_point" ON "saved_locations" USING gist ("point")
        `);
    await queryRunner.query(`
            CREATE INDEX "ix_saved_locations_customer" ON "saved_locations" ("customer_id")
        `);
    await queryRunner.query(`
            CREATE TYPE "public"."notification_channel" AS ENUM('in_app', 'push', 'sms', 'email')
        `);
    await queryRunner.query(`
            CREATE TABLE "notifications" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "user_id" uuid NOT NULL,
                "channel" "public"."notification_channel" NOT NULL DEFAULT 'in_app',
                "type" character varying(60) NOT NULL,
                "title" character varying(160) NOT NULL,
                "body" text NOT NULL,
                "data" jsonb NOT NULL DEFAULT '{}'::jsonb,
                "read_at" TIMESTAMP WITH TIME ZONE,
                CONSTRAINT "PK_6a72c3c0f683f6462415e653c3a" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "ix_notifications_user_unread" ON "notifications" ("user_id")
            WHERE "read_at" IS NULL
        `);
    await queryRunner.query(`
            CREATE INDEX "ix_notifications_user_created" ON "notifications" ("user_id", "created_at")
        `);
    await queryRunner.query(`
            CREATE TYPE "public"."payment_status" AS ENUM(
                'pending',
                'authorized',
                'captured',
                'failed',
                'refunded',
                'cancelled'
            )
        `);
    await queryRunner.query(`
            CREATE TABLE "payments" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "booking_id" uuid NOT NULL,
                "method" "public"."payment_method" NOT NULL,
                "status" "public"."payment_status" NOT NULL DEFAULT 'pending',
                "amount_fils" integer NOT NULL,
                "currency" character(3) NOT NULL DEFAULT 'AED',
                "provider" character varying(40),
                "provider_reference" character varying(255),
                "failure_reason" character varying(255),
                "captured_at" TIMESTAMP WITH TIME ZONE,
                "refunded_at" TIMESTAMP WITH TIME ZONE,
                CONSTRAINT "PK_197ab7af18c93fbb0c9b28b4a59" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "uq_payments_provider_reference" ON "payments" ("provider", "provider_reference")
            WHERE "provider_reference" IS NOT NULL
        `);
    await queryRunner.query(`
            CREATE INDEX "ix_payments_booking" ON "payments" ("booking_id")
        `);
    await queryRunner.query(`
            ALTER TABLE "audit_logs"
            ADD CONSTRAINT "FK_f160d97a931844109de9d04228f" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE
            SET NULL ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "auth_sessions"
            ADD CONSTRAINT "FK_50ccaa6440288a06f0ba693ccc6" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "customers"
            ADD CONSTRAINT "FK_11d81cd7be87b6f8865b0cf7661" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "drivers"
            ADD CONSTRAINT "FK_8e224f1b8f05ace7cfc7c76d03b" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "tow_trucks"
            ADD CONSTRAINT "FK_04b762eee04bb8d79a5196b362a" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "customer_vehicles"
            ADD CONSTRAINT "FK_6fd605ef2bfa0903f5ab4e4ddb0" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "bookings"
            ADD CONSTRAINT "FK_8e21b7ae33e7b0673270de4146f" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "bookings"
            ADD CONSTRAINT "FK_baa23aee39bcdfc0c48c6c3a1a8" FOREIGN KEY ("customer_vehicle_id") REFERENCES "customer_vehicles"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "bookings"
            ADD CONSTRAINT "FK_79817be127e277ffc640593de6e" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "bookings"
            ADD CONSTRAINT "FK_68e4809cf5c169ad61b57574f8f" FOREIGN KEY ("tow_truck_id") REFERENCES "tow_trucks"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "bookings"
            ADD CONSTRAINT "FK_d503dbbb283ba743153bb30480e" FOREIGN KEY ("service_zone_id") REFERENCES "service_zones"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "bookings"
            ADD CONSTRAINT "FK_e89ecdb1184acc1a3077d43bfb9" FOREIGN KEY ("pricing_rule_id") REFERENCES "pricing_rules"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "booking_status_history"
            ADD CONSTRAINT "FK_f274364cc4e753ce257fa0e0602" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "booking_status_history"
            ADD CONSTRAINT "FK_83f84460a8d3ba69ccefda25255" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE
            SET NULL ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "chat_messages"
            ADD CONSTRAINT "FK_81eba089f810c972e8c4dee15b8" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "chat_messages"
            ADD CONSTRAINT "FK_9e5fc47ecb06d4d7b84633b1718" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "driver_documents"
            ADD CONSTRAINT "FK_dc156b37dfa0fcda0ef1974bab8" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "driver_documents"
            ADD CONSTRAINT "FK_df453fb4af8f7f201e7c2d29f6b" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE
            SET NULL ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "saved_locations"
            ADD CONSTRAINT "FK_e31075627d53a7ffe51565d1446" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "notifications"
            ADD CONSTRAINT "FK_9a8a82462cab47c73d25f49261f" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "payments"
            ADD CONSTRAINT "FK_e86edf76dc2424f123b9023a2b2" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "payments" DROP CONSTRAINT "FK_e86edf76dc2424f123b9023a2b2"
        `);
    await queryRunner.query(`
            ALTER TABLE "notifications" DROP CONSTRAINT "FK_9a8a82462cab47c73d25f49261f"
        `);
    await queryRunner.query(`
            ALTER TABLE "saved_locations" DROP CONSTRAINT "FK_e31075627d53a7ffe51565d1446"
        `);
    await queryRunner.query(`
            ALTER TABLE "driver_documents" DROP CONSTRAINT "FK_df453fb4af8f7f201e7c2d29f6b"
        `);
    await queryRunner.query(`
            ALTER TABLE "driver_documents" DROP CONSTRAINT "FK_dc156b37dfa0fcda0ef1974bab8"
        `);
    await queryRunner.query(`
            ALTER TABLE "chat_messages" DROP CONSTRAINT "FK_9e5fc47ecb06d4d7b84633b1718"
        `);
    await queryRunner.query(`
            ALTER TABLE "chat_messages" DROP CONSTRAINT "FK_81eba089f810c972e8c4dee15b8"
        `);
    await queryRunner.query(`
            ALTER TABLE "booking_status_history" DROP CONSTRAINT "FK_83f84460a8d3ba69ccefda25255"
        `);
    await queryRunner.query(`
            ALTER TABLE "booking_status_history" DROP CONSTRAINT "FK_f274364cc4e753ce257fa0e0602"
        `);
    await queryRunner.query(`
            ALTER TABLE "bookings" DROP CONSTRAINT "FK_e89ecdb1184acc1a3077d43bfb9"
        `);
    await queryRunner.query(`
            ALTER TABLE "bookings" DROP CONSTRAINT "FK_d503dbbb283ba743153bb30480e"
        `);
    await queryRunner.query(`
            ALTER TABLE "bookings" DROP CONSTRAINT "FK_68e4809cf5c169ad61b57574f8f"
        `);
    await queryRunner.query(`
            ALTER TABLE "bookings" DROP CONSTRAINT "FK_79817be127e277ffc640593de6e"
        `);
    await queryRunner.query(`
            ALTER TABLE "bookings" DROP CONSTRAINT "FK_baa23aee39bcdfc0c48c6c3a1a8"
        `);
    await queryRunner.query(`
            ALTER TABLE "bookings" DROP CONSTRAINT "FK_8e21b7ae33e7b0673270de4146f"
        `);
    await queryRunner.query(`
            ALTER TABLE "customer_vehicles" DROP CONSTRAINT "FK_6fd605ef2bfa0903f5ab4e4ddb0"
        `);
    await queryRunner.query(`
            ALTER TABLE "tow_trucks" DROP CONSTRAINT "FK_04b762eee04bb8d79a5196b362a"
        `);
    await queryRunner.query(`
            ALTER TABLE "drivers" DROP CONSTRAINT "FK_8e224f1b8f05ace7cfc7c76d03b"
        `);
    await queryRunner.query(`
            ALTER TABLE "customers" DROP CONSTRAINT "FK_11d81cd7be87b6f8865b0cf7661"
        `);
    await queryRunner.query(`
            ALTER TABLE "auth_sessions" DROP CONSTRAINT "FK_50ccaa6440288a06f0ba693ccc6"
        `);
    await queryRunner.query(`
            ALTER TABLE "audit_logs" DROP CONSTRAINT "FK_f160d97a931844109de9d04228f"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."ix_payments_booking"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."uq_payments_provider_reference"
        `);
    await queryRunner.query(`
            DROP TABLE "payments"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."ix_notifications_user_created"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."ix_notifications_user_unread"
        `);
    await queryRunner.query(`
            DROP TABLE "notifications"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."ix_saved_locations_customer"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."ix_saved_locations_point"
        `);
    await queryRunner.query(`
            DROP TABLE "saved_locations"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."uq_driver_documents_driver_type"
        `);
    await queryRunner.query(`
            DROP TABLE "driver_documents"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."ix_chat_messages_booking_created"
        `);
    await queryRunner.query(`
            DROP TABLE "chat_messages"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."ix_booking_status_history_booking"
        `);
    await queryRunner.query(`
            DROP TABLE "booking_status_history"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."ix_bookings_customer_created"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."ix_bookings_driver_status"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."ix_bookings_status"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."ix_bookings_pickup_point"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."uq_bookings_booking_number"
        `);
    await queryRunner.query(`
            DROP TABLE "bookings"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."ix_customer_vehicles_customer"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."uq_customer_vehicles_plate"
        `);
    await queryRunner.query(`
            DROP TABLE "customer_vehicles"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."ix_pricing_rules_lookup"
        `);
    await queryRunner.query(`
            DROP TABLE "pricing_rules"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."ix_service_zones_area"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."uq_service_zones_name"
        `);
    await queryRunner.query(`
            DROP TABLE "service_zones"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."ix_tow_trucks_driver"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."uq_tow_trucks_plate"
        `);
    await queryRunner.query(`
            DROP TABLE "tow_trucks"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."ix_drivers_dispatch"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."ix_drivers_current_location"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."uq_drivers_user"
        `);
    await queryRunner.query(`
            DROP TABLE "drivers"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."uq_customers_user"
        `);
    await queryRunner.query(`
            DROP TABLE "customers"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."ix_otp_challenges_phone_created"
        `);
    await queryRunner.query(`
            DROP TABLE "otp_challenges"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."ix_auth_sessions_user"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."uq_auth_sessions_refresh_token_hash"
        `);
    await queryRunner.query(`
            DROP TABLE "auth_sessions"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."ix_audit_logs_entity"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."ix_audit_logs_actor_created"
        `);
    await queryRunner.query(`
            DROP TABLE "audit_logs"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."ix_users_role"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."uq_users_email"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."uq_users_phone"
        `);
    await queryRunner.query(`
            DROP TABLE "users"
        `);
    await queryRunner.query(`
            DROP TYPE "public"."payment_status"
        `);
    await queryRunner.query(`
            DROP TYPE "public"."payment_method"
        `);
    await queryRunner.query(`
            DROP TYPE "public"."notification_channel"
        `);
    await queryRunner.query(`
            DROP TYPE "public"."emirate"
        `);
    await queryRunner.query(`
            DROP TYPE "public"."saved_location_type"
        `);
    await queryRunner.query(`
            DROP TYPE "public"."document_status"
        `);
    await queryRunner.query(`
            DROP TYPE "public"."driver_document_type"
        `);
    await queryRunner.query(`
            DROP TYPE "public"."booking_status"
        `);
    await queryRunner.query(`
            DROP TYPE "public"."cancelled_by"
        `);
    await queryRunner.query(`
            DROP TYPE "public"."vehicle_issue"
        `);
    await queryRunner.query(`
            DROP TYPE "public"."tow_type"
        `);
    await queryRunner.query(`
            DROP TYPE "public"."vehicle_category"
        `);
    await queryRunner.query(`
            DROP TYPE "public"."zone_status"
        `);
    await queryRunner.query(`
            DROP TYPE "public"."driver_availability"
        `);
    await queryRunner.query(`
            DROP TYPE "public"."kyc_status"
        `);
    await queryRunner.query(`
            DROP TYPE "public"."user_status"
        `);
    await queryRunner.query(`
            DROP TYPE "public"."user_role"
        `);
  }
}
