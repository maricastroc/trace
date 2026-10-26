<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class DatasetErasureTest extends TestCase
{
    use RefreshDatabase;

    private function datasets(string $token): array
    {
        return collect($this->api($token, 'GET', 'datasets')->json('data'))->keyBy('key')->all();
    }

    private function traceQuestion(string $token, array $question): string
    {
        return $this->api($token, 'POST', 'questions/trace', ['question' => $question])->assertStatus(202)->json('data.run.id');
    }

    public function test_a_dataset_with_history_is_erased_only_with_confirmation_and_leaves_an_audit_record_without_rows(): void
    {
        Storage::fake('local');
        [, $token] = $this->workspace(true, 'cadastro');
        $ds = $this->datasets($token);
        $kitchens = collect($this->api($token, 'GET', 'relationships')->json('data'))
            ->first(fn (array $r) => "{$r['from']['dataset_key']}.{$r['from']['column']}" === 'beneficiarios.cozinha_id' && "{$r['to']['dataset_key']}.{$r['to']['column']}" === 'cozinhas.id');
        $this->api($token, 'POST', "relationships/{$kitchens['id']}/confirm")->assertOk();

        $byKitchen = $this->traceQuestion($token, [
            'base_dataset_id' => $ds['beneficiarios']['id'],
            'measure' => ['function' => 'count_distinct', 'column' => 'id'],
            'period' => null,
            'dimension' => ['relationships' => [$kitchens['id']], 'column' => 'id', 'label_column' => 'nome', 'value' => null],
        ]);
        $alone = $this->traceQuestion($token, [
            'base_dataset_id' => $ds['beneficiarios']['id'],
            'measure' => ['function' => 'count'],
            'period' => null,
            'dimension' => null,
        ]);
        $comparison = $this->api($token, 'POST', 'comparisons/trace', ['spec' => [
            'a' => ['kind' => 'population', 'dataset_id' => $ds['cozinhas']['id'], 'key' => 'id'],
            'b' => ['kind' => 'population', 'dataset_id' => $ds['beneficiarios']['id'], 'key' => 'cozinha_id'],
            'rules' => [],
            'fields' => [],
            'equivalence' => ['a' => ['dataset_id' => $ds['cozinhas']['id'], 'key' => 'id'], 'b' => ['dataset_id' => $ds['beneficiarios']['id'], 'key' => 'cozinha_id']],
        ]])->assertStatus(202)->json('data.id');

        $versionId = $ds['cozinhas']['latest_version']['id'];
        $path = DB::table('dataset_versions')->where('id', $versionId)->value('source_path');
        Storage::disk('local')->assertExists($path);

        $dependents = $this->api($token, 'GET', "datasets/{$ds['cozinhas']['id']}/dependents")->assertOk()->json('data');
        $rows = $ds['cozinhas']['latest_version']['row_count'];
        $this->assertSame([1, $rows, 1, 1, 1, 1], [$dependents['versions'], $dependents['rows'], $dependents['files'], $dependents['recipes'], $dependents['comparisons'], $dependents['comparison_runs']]);
        $this->assertSame(2, $dependents['runs'], 'the question that went through cozinhas and the comparison side on cozinhas');

        $this->api($token, 'DELETE', "datasets/{$ds['cozinhas']['id']}")->assertStatus(409)->assertJsonPath('code', 'dataset.in_use')->assertJsonPath('details.dependents.runs', 2);
        $this->api($token, 'DELETE', "datasets/{$ds['cozinhas']['id']}", ['with_history' => true, 'confirm' => 'Cozinhas'])->assertStatus(422)->assertJsonPath('code', 'dataset.confirmation_required');
        $this->assertTrue(DB::table('datasets')->where('id', $ds['cozinhas']['id'])->exists(), 'nothing is erased without the exact confirmation');

        $report = $this->api($token, 'DELETE', "datasets/{$ds['cozinhas']['id']}", ['with_history' => true, 'confirm' => 'cozinhas'])->assertOk()->json('data');
        $this->assertSame($dependents, $report['removed']);

        $this->api($token, 'GET', "datasets/{$ds['cozinhas']['id']}")->assertNotFound();
        $this->assertSame(0, DB::table('source_rows')->where('dataset_version_id', $versionId)->count());
        Storage::disk('local')->assertMissing($path);
        $this->assertSame([], Storage::disk('local')->allFiles("datasets/{$ds['cozinhas']['id']}"));
        $this->assertFalse(DB::table('runs')->where('id', $byKitchen)->exists());
        $this->assertFalse(DB::table('comparison_runs')->where('id', $comparison)->exists());
        $this->assertSame(0, DB::table('relationships')->where('to_dataset_id', $ds['cozinhas']['id'])->count());

        $kept = $this->api($token, 'GET', "runs/{$alone}")->assertOk()->json('data');
        $this->assertSame('succeeded', $kept['status'], 'a run that never touched cozinhas is kept');

        $erasures = $this->api($token, 'GET', 'dataset-erasures')->assertOk()->json('data');
        $this->assertCount(1, $erasures);
        $this->assertSame(['cozinhas', 1, $rows], [$erasures[0]['dataset_key'], $erasures[0]['versions'][0]['number'], $erasures[0]['versions'][0]['row_count']]);
        $stored = json_encode(DB::table('dataset_erasures')->first());
        foreach (['Cozinha Esperança', 'Fortaleza', '0101'] as $value) {
            $this->assertStringNotContainsString($value, $stored, 'the audit record keeps no row values');
        }
    }

    public function test_an_unused_dataset_is_removed_with_its_file_and_folder(): void
    {
        Storage::fake('local');
        [, $token] = $this->workspace(false);
        $extra = $this->upload($token, 'extra.csv', "id\n1\n")->assertCreated()->json('data');
        $path = DB::table('dataset_versions')->where('id', $extra['latest_version']['id'])->value('source_path');

        $this->api($token, 'DELETE', "datasets/{$extra['id']}")->assertNoContent();

        Storage::disk('local')->assertMissing($path);
        $this->assertSame([], Storage::disk('local')->directories('datasets'));
    }
}
