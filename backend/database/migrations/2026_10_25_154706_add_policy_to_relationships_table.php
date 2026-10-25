<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('relationships', function (Blueprint $table) {
            $table->string('policy', 32)->nullable()->after('status');
        });
    }

    public function down(): void
    {
        Schema::table('relationships', function (Blueprint $table) {
            $table->dropColumn('policy');
        });
    }
};
