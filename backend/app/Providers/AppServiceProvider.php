<?php

namespace App\Providers;

use App\Modules\Workspaces\Http\ResolveWorkspace;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void {}

    public function boot(): void
    {
        foreach (['dataset', 'version', 'relationship', 'recipe', 'run'] as $parameter) {
            Route::pattern($parameter, '[0-9A-Za-z]{26}');
        }
        Route::pattern('resultNo', '[0-9]{1,9}');
        Route::pattern('row', '[0-9]{1,18}');

        RateLimiter::for('workspaces', fn (Request $request) => Limit::perMinute(10)->by($request->ip()));
        RateLimiter::for('uploads', fn (Request $request) => Limit::perMinute(30)->by($this->workspaceKey($request)));
        RateLimiter::for('workspace-api', fn (Request $request) => Limit::perMinute(600)->by($this->workspaceKey($request)));
    }

    private function workspaceKey(Request $request): string
    {
        $token = $request->header(ResolveWorkspace::HEADER);

        return is_string($token) ? hash('sha256', $token) : (string) $request->ip();
    }
}
