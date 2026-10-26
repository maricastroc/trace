<?php

namespace Tests\Feature;

use App\Modules\Support\Http\LimitStatementTime;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use Tests\TestCase;

class ProcessingLimitsTest extends TestCase
{
    use RefreshDatabase;

    private function cadastro(): array
    {
        [, $token] = $this->workspace(true, 'cadastro');
        $datasets = collect($this->api($token, 'GET', 'datasets')->json('data'))->keyBy('key')->all();
        $kitchens = collect($this->api($token, 'GET', 'relationships')->json('data'))
            ->first(fn (array $r) => "{$r['from']['dataset_key']}.{$r['from']['column']}" === 'beneficiarios.cozinha_id' && $r['to']['dataset_key'] === 'cozinhas');
        $this->api($token, 'POST', "relationships/{$kitchens['id']}/confirm")->assertOk();

        return [$token, $datasets, [
            'base_dataset_id' => $datasets['beneficiarios']['id'],
            'measure' => ['function' => 'count_distinct', 'column' => 'id'],
            'period' => null,
            'dimension' => ['relationships' => [$kitchens['id']], 'column' => 'id', 'label_column' => 'nome', 'value' => null],
        ]];
    }

    public function test_a_preview_that_runs_out_of_time_fails_with_a_clear_message(): void
    {
        [$token, , $question] = $this->cadastro();
        config(['trace.limits.preview_seconds' => 0.000001]);

        $preview = $this->api($token, 'POST', 'questions/preview', ['question' => $question])->assertOk()->json('data.preview');

        $this->assertSame([false, 'failed', 'limit.preview_time'], [$preview['computed'], $preview['reason'], $preview['error']['code']]);
        $this->assertStringContainsString('Rastrear calcula em segundo plano', $preview['error']['message']);
        $this->assertNull($preview['totals'], 'no partial number is shown');
    }

    public function test_a_preview_that_multiplies_too_many_rows_points_to_tracing(): void
    {
        [$token, , $question] = $this->cadastro();
        config(['trace.limits.preview_tuples' => 50]);

        $preview = $this->api($token, 'POST', 'questions/preview', ['question' => $question])->assertOk()->json('data.preview');

        $this->assertSame(['failed', 'limit.preview_tuples'], [$preview['reason'], $preview['error']['code']]);
        $this->assertStringContainsString('passou de 50 linhas intermediárias', $preview['error']['message']);
        $this->assertStringContainsString('até 500.000 linhas', $preview['error']['message']);

        [$traced] = [$this->api($token, 'POST', 'questions/trace', ['question' => $question])->assertStatus(202)->json('data.run.id')];
        $this->assertSame('succeeded', $this->api($token, 'GET', "runs/{$traced}")->json('data.status'), 'tracing keeps the larger limit');
    }

    public function test_a_preview_returns_at_most_the_configured_rows_and_says_how_many_exist(): void
    {
        [$token, , $question] = $this->cadastro();
        config(['trace.limits.preview_results' => 3]);

        $preview = $this->api($token, 'POST', 'questions/preview', ['question' => $question])->assertOk()->json('data.preview');

        $this->assertCount(3, $preview['results']);
        $this->assertTrue($preview['results_truncated']);
        $this->assertGreaterThan(3, $preview['results_total']);
        $this->assertSame($preview['results_total'], $preview['totals']['groups'], 'the totals still cover every group');
    }

    public function test_discovery_can_focus_on_one_table_and_says_when_it_stopped_early(): void
    {
        [$token, $datasets] = $this->cadastro();

        $focused = $this->api($token, 'POST', 'relationships/discover', ['dataset_id' => $datasets['cozinhas']['id']])->assertOk()->json('meta');
        $this->assertSame([true, 4, 4], [$focused['complete'], $focused['evaluated_pairs'], $focused['total_pairs']], 'only pairs with cozinhas, in both directions');

        config(['trace.limits.discovery_seconds' => 0]);
        $stopped = $this->api($token, 'POST', 'relationships/discover')->assertOk()->json('meta');
        $this->assertFalse($stopped['complete']);
        $this->assertSame(6, $stopped['total_pairs']);
        $this->assertLessThan(6, $stopped['evaluated_pairs']);
    }

    public function test_a_database_query_over_the_time_limit_is_cut_and_explained(): void
    {
        config(['trace.limits.statement_seconds' => 1]);
        Route::middleware(LimitStatementTime::class)->get('/api/v1/_lento', fn () => DB::select('SELECT pg_sleep(2)'));

        $response = $this->getJson('/api/v1/_lento')->assertStatus(503);

        $this->assertSame('request.timeout', $response->json('code'));
        $this->assertStringContainsString('passou de 1 s', $response->json('message'));
        $this->assertStringNotContainsString('pg_sleep', $response->getContent());
    }
}
