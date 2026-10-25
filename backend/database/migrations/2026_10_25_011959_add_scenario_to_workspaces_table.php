<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('workspaces', function (Blueprint $table) {
            $table->string('scenario', 32)->nullable()->after('name');
        });

        DB::table('workspaces')->whereExists(
            fn ($query) => $query->select(DB::raw(1))->from('datasets')->whereColumn('datasets.workspace_id', 'workspaces.id')->where('datasets.origin', 'demo')
        )->update(['scenario' => 'refeicoes']);
    }

    public function down(): void
    {
        Schema::table('workspaces', function (Blueprint $table) {
            $table->dropColumn('scenario');
        });
    }
};
