<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('recipes', function (Blueprint $table) {
            $table->jsonb('question')->nullable()->after('steps');
            $table->string('question_key', 64)->nullable()->after('question');
            $table->unique(['workspace_id', 'question_key']);
        });
    }

    public function down(): void
    {
        Schema::table('recipes', function (Blueprint $table) {
            $table->dropUnique(['workspace_id', 'question_key']);
            $table->dropColumn(['question', 'question_key']);
        });
    }
};
