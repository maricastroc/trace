<?php

namespace App\Modules\Workspaces;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

final class WorkspaceProvisioner
{
    public function __construct(private readonly DemoInstaller $demo)
    {
    }

    public function create(bool $withDemo = true): array
    {
        $token = 'trw_'.Str::random(48);

        $workspace = DB::transaction(function () use ($token, $withDemo) {
            $workspace = Workspace::create([
                'name' => 'Espaço de investigação',
                'token_hash' => Workspace::hashToken($token),
                'last_active_at' => now(),
            ]);

            if ($withDemo) {
                $this->demo->install($workspace);
            }

            return $workspace;
        });

        return [$workspace, $token];
    }
}
