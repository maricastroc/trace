<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('dataset_erasures', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('workspace_id')->constrained()->cascadeOnDelete();
            $table->string('dataset_key');
            $table->string('dataset_name');
            $table->jsonb('versions');
            $table->jsonb('removed');
            $table->timestamp('erased_at');
            $table->index(['workspace_id', 'erased_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('dataset_erasures');
    }
};
