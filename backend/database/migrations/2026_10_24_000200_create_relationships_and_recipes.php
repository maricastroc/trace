<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('relationships', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('workspace_id')->constrained()->cascadeOnDelete();
            $table->foreignUlid('from_dataset_id')->constrained('datasets')->cascadeOnDelete();
            $table->string('from_column', 64);
            $table->foreignUlid('to_dataset_id')->constrained('datasets')->cascadeOnDelete();
            $table->string('to_column', 64);
            $table->string('status', 16);
            $table->string('origin', 16);
            $table->decimal('score', 5, 4);
            $table->jsonb('evidence');
            $table->foreignUlid('from_version_id')->nullable()->constrained('dataset_versions')->nullOnDelete();
            $table->foreignUlid('to_version_id')->nullable()->constrained('dataset_versions')->nullOnDelete();
            $table->timestamp('confirmed_at')->nullable();
            $table->timestamp('rejected_at')->nullable();
            $table->timestamps();
            $table->unique(['workspace_id', 'from_dataset_id', 'from_column', 'to_dataset_id', 'to_column'], 'relationships_pair_unique');
            $table->index(['workspace_id', 'status']);
        });

        Schema::create('recipes', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('workspace_id')->constrained()->cascadeOnDelete();
            $table->string('name', 160);
            $table->text('description')->nullable();
            $table->foreignUlid('base_dataset_id')->constrained('datasets')->restrictOnDelete();
            $table->jsonb('steps');
            $table->unsignedInteger('revision')->default(1);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('recipes');
        Schema::dropIfExists('relationships');
    }
};
