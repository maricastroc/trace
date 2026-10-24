<?php

namespace Tests\Feature;

use App\Modules\Runs\Jobs\ExecuteRun;
use App\Modules\Runs\Run;
use App\Modules\Runs\RunExecutor;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use RuntimeException;
use Tests\TestCase;

class RunFailureTest extends TestCase
{
    use RefreshDatabase;

    private function lineageRowCounts(string $runId): array
    {
        return collect(['run_steps', 'run_result_rows', 'run_tuples', 'run_tuple_sources', 'run_diagnostics'])
            ->mapWithKeys(fn (string $table) => [$table => DB::table($table)->where('run_id', $runId)->count()])
            ->all();
    }

    private function confirmedDemo(): array
    {
        [, $token] = $this->workspace();
        $ids = $this->demoIds($token);
        $this->api($token, 'POST', "relationships/{$ids['relationship']['id']}/confirm");

        return [$token, $ids];
    }

    public function test_run_is_queued_with_pinned_inputs_before_execution(): void
    {
        Queue::fake();
        [$token, $ids] = $this->confirmedDemo();

        $run = $this->api($token, 'POST', "recipes/{$ids['recipe']['id']}/runs")->assertStatus(202)->json('data');

        $this->assertSame('queued', $run['status']);
        Queue::assertPushed(ExecuteRun::class, fn (ExecuteRun $job) => $job->runId === $run['id']);
        $this->assertSame(
            [$ids['refeicoes']['latest_version']['id'], $ids['cozinhas']['latest_version']['id']],
            DB::table('run_inputs')->where('run_id', $run['id'])->orderBy('position')->pluck('dataset_version_id')->all(),
        );
        $this->api($token, 'GET', "runs/{$run['id']}/results")->assertStatus(409)->assertJsonPath('code', 'run.not_ready');
    }

    public function test_tuple_limit_failure_is_recorded_and_leaves_no_partial_lineage(): void
    {
        [$token, $ids] = $this->confirmedDemo();
        config(['trace.limits.tuples' => 150]);

        $run = $this->runRecipe($token, $ids['recipe']['id']);

        $this->assertSame('failed', $run['status']);
        $this->assertSame('limit.tuples', $run['error']['code']);
        $this->assertSame(2, $run['error']['step_position']);
        $this->assertSame(array_fill_keys(['run_steps', 'run_result_rows', 'run_tuples', 'run_tuple_sources', 'run_diagnostics'], 0), $this->lineageRowCounts($run['id']));
    }

    public function test_database_failure_midway_through_writing_rolls_back_all_lineage(): void
    {
        [$token, $ids] = $this->confirmedDemo();

        DB::unprepared(<<<'SQL'
            CREATE FUNCTION trace_test_fail() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'simulated disk failure'; END; $$ LANGUAGE plpgsql;
            CREATE TRIGGER trace_test_fail BEFORE INSERT ON run_diagnostics FOR EACH ROW EXECUTE FUNCTION trace_test_fail();
        SQL);

        $run = $this->runRecipe($token, $ids['recipe']['id']);

        $this->assertSame('failed', $run['status']);
        $this->assertSame('internal', $run['error']['code']);
        $this->assertSame(array_fill_keys(['run_steps', 'run_result_rows', 'run_tuples', 'run_tuple_sources', 'run_diagnostics'], 0), $this->lineageRowCounts($run['id']));

        DB::unprepared('DROP TRIGGER trace_test_fail ON run_diagnostics; DROP FUNCTION trace_test_fail();');
        $retry = $this->runRecipe($token, $ids['recipe']['id']);
        $this->assertSame('succeeded', $retry['status']);
    }

    public function test_worker_failure_marks_the_run_failed(): void
    {
        Queue::fake();
        [$token, $ids] = $this->confirmedDemo();
        $runId = $this->api($token, 'POST', "recipes/{$ids['recipe']['id']}/runs")->json('data.id');

        (new ExecuteRun($runId))->failed(new RuntimeException('timeout'));

        $run = $this->api($token, 'GET', "runs/{$runId}")->json('data');
        $this->assertSame('failed', $run['status']);
        $this->assertSame('job_failed', $run['error']['code']);
    }

    public function test_execution_is_idempotent_for_finished_runs(): void
    {
        [$token] = $this->confirmedDemo();
        $run = $this->runRecipe($token, $this->demoIds($token)['recipe']['id']);
        $counts = $this->lineageRowCounts($run['id']);

        app(RunExecutor::class)->execute(Run::query()->findOrFail($run['id']));
        (new ExecuteRun($run['id']))->failed(new RuntimeException('late failure'));

        $this->assertSame($counts, $this->lineageRowCounts($run['id']));
        $this->assertSame('succeeded', Run::query()->findOrFail($run['id'])->status);
    }
}
