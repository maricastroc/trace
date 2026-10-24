<?php

namespace Tests\Feature;

use App\Modules\Workspaces\Http\ResolveWorkspace;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Route;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route as Router;
use Tests\TestCase;

class WorkspaceIsolationTest extends TestCase
{
    use RefreshDatabase;

    private const PUBLIC_ROUTES = ['GET api/v1/meta', 'POST api/v1/workspaces'];

    private function apiRoutes(): array
    {
        return collect(Router::getRoutes()->getRoutes())
            ->filter(fn (Route $route) => str_starts_with($route->uri(), 'api/v1/'))
            ->map(fn (Route $route) => ['method' => collect($route->methods())->reject(fn ($m) => $m === 'HEAD')->first(), 'route' => $route])
            ->values()
            ->all();
    }

    private function owner(): array
    {
        [, $token] = $this->workspace();
        $run = $this->runDemo($token);
        $ids = $this->demoIds($token);

        return [
            'token' => $token,
            'ids' => [
                'dataset' => $ids['cozinhas']['id'],
                'version' => $ids['cozinhas']['latest_version']['id'],
                'relationship' => $ids['relationship']['id'],
                'recipe' => $ids['recipe']['id'],
                'run' => $run['id'],
                'resultNo' => 1,
                'row' => $this->findRow($token, $run['id'], 'cozinhas', 'id', '0183'),
            ],
        ];
    }

    private function uriFor(Route $route, array $ids): string
    {
        return preg_replace_callback('/\{(\w+)\}/', fn ($m) => (string) $ids[$m[1]], $route->uri());
    }

    public function test_every_private_route_requires_a_valid_workspace_token(): void
    {
        $owner = $this->owner();

        foreach ($this->apiRoutes() as ['method' => $method, 'route' => $route]) {
            $signature = "{$method} {$route->uri()}";
            if (in_array($signature, self::PUBLIC_ROUTES, true)) {
                continue;
            }

            $this->assertContains(ResolveWorkspace::class, $route->gatherMiddleware(), "{$signature} is not scoped to a workspace");

            $uri = '/'.$this->uriFor($route, $owner['ids']);
            $this->flushHeaders();
            $this->json($method, $uri)->assertStatus(401)->assertJsonPath('code', 'workspace.missing');
            $this->withHeaders([ResolveWorkspace::HEADER => 'trw_'.str_repeat('x', 48)])
                ->json($method, $uri)->assertStatus(401)->assertJsonPath('code', 'workspace.unknown');
            $this->flushHeaders();
        }
    }

    public function test_another_workspace_cannot_read_or_change_any_owned_resource(): void
    {
        $owner = $this->owner();
        [, $intruder] = $this->workspace();
        $ownedIds = array_filter($owner['ids'], 'is_string');
        $before = $this->snapshot();

        $checked = 0;
        foreach ($this->apiRoutes() as ['method' => $method, 'route' => $route]) {
            $signature = "{$method} {$route->uri()}";
            if (in_array($signature, self::PUBLIC_ROUTES, true)) {
                continue;
            }

            $response = $this->api($intruder, $method, '/'.preg_replace('#^api/v1/#', '', $this->uriFor($route, $owner['ids'])));
            $hasOwnedParameter = array_intersect($route->parameterNames(), ['dataset', 'version', 'relationship', 'recipe', 'run']) !== [];

            if ($hasOwnedParameter) {
                $this->assertSame(404, $response->status(), "{$signature} returned {$response->status()}: ".$response->getContent());
            } else {
                $this->assertLessThan(500, $response->status(), $signature);
            }

            foreach ($ownedIds as $id) {
                $this->assertStringNotContainsString($id, $response->getContent(), "{$signature} leaked {$id}");
            }
            $checked++;
        }

        $this->assertGreaterThanOrEqual(34, $checked);
        $this->assertSame($before, $this->snapshot(), 'owner data changed after intruder requests');
    }

    public function test_ids_from_another_workspace_inside_payloads_are_rejected(): void
    {
        $owner = $this->owner();
        [, $intruder] = $this->workspace();
        $ownerIds = $this->demoIds($owner['token']);
        $intruderIds = $this->demoIds($intruder);

        $this->api($intruder, 'POST', 'recipes', ['name' => 'x', 'base_dataset_id' => $ownerIds['refeicoes']['id'], 'steps' => []])
            ->assertStatus(422)->assertJsonPath('details.issues.0.code', 'recipe.base_missing');

        $this->api($intruder, 'POST', 'recipes', [
            'name' => 'x', 'base_dataset_id' => $intruderIds['refeicoes']['id'],
            'steps' => [['type' => 'join', 'relationship_id' => $ownerIds['relationship']['id']]],
        ])->assertStatus(422)->assertJsonPath('details.issues.0.code', 'join.relationship_missing');

        $this->api($intruder, 'POST', 'relationships', [
            'from_dataset_id' => $ownerIds['refeicoes']['id'], 'from_column' => 'cozinha_id',
            'to_dataset_id' => $ownerIds['cozinhas']['id'], 'to_column' => 'id',
        ])->assertNotFound();

        $this->api($intruder, 'POST', "relationships/{$intruderIds['relationship']['id']}/confirm");
        $intruderRun = $this->runRecipe($intruder, $intruderIds['recipe']['id']);

        $this->api($intruder, 'GET', "runs/{$intruderRun['id']}/rows/{$owner['ids']['row']}/journey")
            ->assertNotFound()->assertJsonPath('code', 'row.not_in_run');

        $drill = $this->api($intruder, 'GET', "runs/{$intruderRun['id']}/results/1/contributors?input=0&via_input=1&via_row={$owner['ids']['row']}")->assertOk();
        $this->assertSame(0, $drill->json('meta.total'));

        $this->api($intruder, 'GET', "runs/{$intruderRun['id']}/rows?alias=cozinhas&column=id&value=0183")->assertOk()
            ->assertJsonMissing(['id' => $owner['ids']['row']]);
    }

    private function snapshot(): array
    {
        return [
            'relationships' => DB::table('relationships')->orderBy('id')->get(['id', 'status', 'workspace_id'])->map(fn ($r) => (array) $r)->all(),
            'datasets' => DB::table('datasets')->orderBy('id')->pluck('id')->all(),
            'versions' => DB::table('dataset_versions')->count(),
            'recipes' => DB::table('recipes')->orderBy('id')->get(['id', 'revision', 'workspace_id'])->map(fn ($r) => (array) $r)->all(),
            'runs' => DB::table('runs')->orderBy('id')->get(['id', 'workspace_id'])->map(fn ($r) => (array) $r)->all(),
        ];
    }
}
