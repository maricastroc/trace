<?php

use App\Modules\Workspaces\WorkspacePruner;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('trace:prune-workspaces {--days= : Dias sem atividade}', function (WorkspacePruner $pruner) {
    $days = (int) ($this->option('days') ?? config('trace.workspace_ttl_days'));
    $count = $pruner->prune($days);
    $this->info("{$count} espaço(s) de trabalho sem atividade há mais de {$days} dias removido(s).");
})->purpose('Remove espaços de trabalho inativos, com seus dados e arquivos');

Schedule::command('trace:prune-workspaces')->daily();
