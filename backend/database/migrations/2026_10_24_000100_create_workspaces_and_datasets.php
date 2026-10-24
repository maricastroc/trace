<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('workspaces', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->string('name', 120);
            $table->char('token_hash', 64)->unique();
            $table->timestamp('last_active_at')->nullable()->index();
            $table->timestamps();
        });

        Schema::create('datasets', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('workspace_id')->constrained()->cascadeOnDelete();
            $table->string('key', 64);
            $table->string('name', 160);
            $table->string('origin', 16);
            $table->boolean('is_synthetic')->default(false);
            $table->timestamps();
            $table->unique(['workspace_id', 'key']);
        });

        Schema::create('dataset_versions', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('dataset_id')->constrained()->cascadeOnDelete();
            $table->unsignedInteger('number');
            $table->string('source_filename', 255);
            $table->string('source_path', 255);
            $table->char('checksum', 64);
            $table->unsignedBigInteger('size_bytes');
            $table->string('encoding', 32);
            $table->string('delimiter', 4);
            $table->unsignedInteger('row_count');
            $table->unsignedSmallInteger('column_count');
            $table->jsonb('import_report');
            $table->timestamp('created_at');
            $table->unique(['dataset_id', 'number']);
        });

        Schema::create('dataset_columns', function (Blueprint $table) {
            $table->id();
            $table->foreignUlid('dataset_version_id')->constrained()->cascadeOnDelete();
            $table->unsignedSmallInteger('position');
            $table->string('key', 64);
            $table->string('label', 255);
            $table->string('inferred_type', 16);
            $table->jsonb('profile');
            $table->unique(['dataset_version_id', 'key']);
            $table->unique(['dataset_version_id', 'position']);
        });

        Schema::create('source_rows', function (Blueprint $table) {
            $table->id();
            $table->foreignUlid('dataset_version_id')->constrained()->cascadeOnDelete();
            $table->unsignedInteger('row_number');
            $table->unsignedInteger('line_number');
            $table->jsonb('values');
            $table->unique(['dataset_version_id', 'row_number']);
        });

        DB::statement('CREATE INDEX source_rows_values_gin ON source_rows USING gin ("values" jsonb_path_ops)');
    }

    public function down(): void
    {
        Schema::dropIfExists('source_rows');
        Schema::dropIfExists('dataset_columns');
        Schema::dropIfExists('dataset_versions');
        Schema::dropIfExists('datasets');
        Schema::dropIfExists('workspaces');
    }
};
