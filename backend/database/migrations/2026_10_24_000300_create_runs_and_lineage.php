<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('runs', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('workspace_id')->constrained()->cascadeOnDelete();
            $table->foreignUlid('recipe_id')->nullable()->constrained()->nullOnDelete();
            $table->unsignedInteger('recipe_revision');
            $table->jsonb('recipe_snapshot');
            $table->string('status', 16);
            $table->jsonb('error')->nullable();
            $table->jsonb('output_columns')->nullable();
            $table->unsignedInteger('result_count')->nullable();
            $table->unsignedInteger('tuple_count')->nullable();
            $table->unsignedInteger('duration_ms')->nullable();
            $table->timestamp('queued_at');
            $table->timestamp('started_at')->nullable();
            $table->timestamp('finished_at')->nullable();
            $table->timestamps();
            $table->index(['workspace_id', 'created_at']);
            $table->index(['recipe_id', 'created_at']);
        });

        Schema::create('run_inputs', function (Blueprint $table) {
            $table->foreignUlid('run_id')->constrained()->cascadeOnDelete();
            $table->unsignedSmallInteger('position');
            $table->string('alias', 64);
            $table->foreignUlid('dataset_id')->constrained('datasets')->restrictOnDelete();
            $table->foreignUlid('dataset_version_id')->constrained('dataset_versions')->restrictOnDelete();
            $table->primary(['run_id', 'position']);
            $table->unique(['run_id', 'alias']);
        });

        Schema::create('run_steps', function (Blueprint $table) {
            $table->foreignUlid('run_id')->constrained()->cascadeOnDelete();
            $table->unsignedSmallInteger('position');
            $table->string('type', 16);
            $table->jsonb('config');
            $table->unsignedInteger('input_count');
            $table->unsignedInteger('output_count');
            $table->unsignedInteger('excluded_count');
            $table->jsonb('stats');
            $table->unsignedInteger('duration_ms');
            $table->primary(['run_id', 'position']);
        });

        Schema::create('run_result_rows', function (Blueprint $table) {
            $table->foreignUlid('run_id')->constrained()->cascadeOnDelete();
            $table->unsignedInteger('result_no');
            $table->jsonb('values');
            $table->unsignedInteger('contributor_count');
            $table->primary(['run_id', 'result_no']);
        });

        Schema::create('run_tuples', function (Blueprint $table) {
            $table->foreignUlid('run_id')->constrained()->cascadeOnDelete();
            $table->unsignedInteger('tuple_no');
            $table->unsignedInteger('parent_no')->nullable();
            $table->unsignedSmallInteger('born_step');
            $table->unsignedSmallInteger('end_step')->nullable();
            $table->string('fate', 12);
            $table->string('exclusion_code', 40)->nullable();
            $table->jsonb('exclusion_detail')->nullable();
            $table->unsignedInteger('result_no')->nullable();
            $table->primary(['run_id', 'tuple_no']);
            $table->index(['run_id', 'result_no']);
            $table->index(['run_id', 'parent_no']);
        });

        DB::statement("CREATE INDEX run_tuples_exclusions ON run_tuples (run_id, end_step, exclusion_code) WHERE fate = 'excluded'");
        DB::statement('ALTER TABLE run_tuples ADD CONSTRAINT run_tuples_parent_fk FOREIGN KEY (run_id, parent_no) REFERENCES run_tuples (run_id, tuple_no) ON DELETE CASCADE');
        DB::statement('ALTER TABLE run_tuples ADD CONSTRAINT run_tuples_result_fk FOREIGN KEY (run_id, result_no) REFERENCES run_result_rows (run_id, result_no) ON DELETE CASCADE');

        Schema::create('run_tuple_sources', function (Blueprint $table) {
            $table->ulid('run_id');
            $table->unsignedInteger('tuple_no');
            $table->unsignedSmallInteger('input_position');
            $table->foreignId('source_row_id')->constrained('source_rows')->restrictOnDelete();
            $table->primary(['run_id', 'tuple_no', 'input_position']);
            $table->index(['run_id', 'source_row_id']);
            $table->foreign(['run_id', 'tuple_no'])->references(['run_id', 'tuple_no'])->on('run_tuples')->cascadeOnDelete();
        });

        Schema::create('run_diagnostics', function (Blueprint $table) {
            $table->id();
            $table->foreignUlid('run_id')->constrained()->cascadeOnDelete();
            $table->unsignedSmallInteger('step_position');
            $table->string('code', 40);
            $table->string('severity', 10);
            $table->foreignId('source_row_id')->nullable()->constrained('source_rows')->restrictOnDelete();
            $table->unsignedInteger('tuple_no')->nullable();
            $table->jsonb('detail');
            $table->index(['run_id', 'code']);
            $table->index(['run_id', 'source_row_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('run_diagnostics');
        Schema::dropIfExists('run_tuple_sources');
        Schema::dropIfExists('run_tuples');
        Schema::dropIfExists('run_result_rows');
        Schema::dropIfExists('run_steps');
        Schema::dropIfExists('run_inputs');
        Schema::dropIfExists('runs');
    }
};
