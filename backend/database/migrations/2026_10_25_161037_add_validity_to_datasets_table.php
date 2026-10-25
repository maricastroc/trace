<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('datasets', function (Blueprint $table) {
            $table->string('validity_start_column', 64)->nullable();
            $table->string('validity_end_column', 64)->nullable();
            $table->boolean('validity_end_inclusive')->nullable();
            $table->timestamp('validity_declared_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('datasets', function (Blueprint $table) {
            $table->dropColumn(['validity_start_column', 'validity_end_column', 'validity_end_inclusive', 'validity_declared_at']);
        });
    }
};
