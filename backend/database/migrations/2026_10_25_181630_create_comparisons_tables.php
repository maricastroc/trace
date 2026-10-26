<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('comparisons', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('workspace_id')->constrained()->cascadeOnDelete();
            $table->string('name', 160);
            $table->jsonb('spec');
            $table->string('spec_key', 64);
            $table->timestamps();
            $table->unique(['workspace_id', 'spec_key']);
        });

        Schema::create('comparison_runs', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('workspace_id')->constrained()->cascadeOnDelete();
            $table->foreignUlid('comparison_id')->constrained()->cascadeOnDelete();
            $table->jsonb('spec');
            $table->foreignUlid('run_a_id')->nullable()->constrained('runs')->nullOnDelete();
            $table->foreignUlid('run_b_id')->nullable()->constrained('runs')->nullOnDelete();
            $table->jsonb('sides');
            $table->jsonb('attribution');
            $table->jsonb('issues');
            $table->string('status', 16);
            $table->jsonb('summary')->nullable();
            $table->jsonb('error')->nullable();
            $table->unsignedInteger('duration_ms')->nullable();
            $table->timestamp('queued_at');
            $table->timestamp('started_at')->nullable();
            $table->timestamp('finished_at')->nullable();
            $table->timestamps();
            $table->index(['comparison_id', 'created_at']);
        });

        Schema::create('comparison_identities', function (Blueprint $table) {
            $table->foreignUlid('comparison_run_id')->constrained()->cascadeOnDelete();
            $table->unsignedInteger('position');
            $table->text('identity');
            $table->text('a_value')->nullable();
            $table->text('b_value')->nullable();
            $table->string('category', 20);
            $table->string('explanation', 32)->nullable();
            $table->jsonb('detail')->nullable();
            $table->unsignedInteger('a_rows');
            $table->unsignedInteger('b_rows');
            $table->jsonb('fields')->nullable();
            $table->primary(['comparison_run_id', 'position']);
            $table->index(['comparison_run_id', 'category', 'explanation']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('comparison_identities');
        Schema::dropIfExists('comparison_runs');
        Schema::dropIfExists('comparisons');
    }
};
