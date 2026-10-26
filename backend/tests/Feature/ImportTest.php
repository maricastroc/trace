<?php

namespace Tests\Feature;

use App\Modules\Datasets\DatasetVersion;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use RuntimeException;
use Tests\TestCase;

class ImportTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_failed_import_leaves_no_file_behind_and_answers_without_internal_details(): void
    {
        Storage::fake('local');
        [, $token] = $this->workspace(false);
        DatasetVersion::creating(function (): void {
            throw new RuntimeException('falha interna com 12345678900');
        });

        $response = $this->upload($token, 'pessoas.csv', "nome,documento\nAna,12345678900\n")->assertStatus(500);

        $this->assertSame('server_error', $response->json('code'));
        $this->assertStringNotContainsString('12345678900', $response->getContent(), 'no value of the file reaches the response');
        $this->assertSame([], Storage::disk('local')->allFiles(), 'the raw file is removed with the rolled back version');
        $this->assertSame(0, DB::table('datasets')->count());
    }

    public function test_a_header_name_that_is_too_long_is_refused_by_position(): void
    {
        [, $token] = $this->workspace(false);
        $label = str_repeat('Ana Maria da Silva ', 10);

        $response = $this->upload($token, 'pessoas.csv', "id,{$label}\n1,x\n")->assertStatus(422);

        $this->assertSame('csv.header_too_long', $response->json('code'));
        $this->assertSame(2, $response->json('details.position'));
        $this->assertStringNotContainsString('Ana Maria', $response->getContent());
    }

    public function test_a_first_row_that_looks_like_data_is_flagged(): void
    {
        [, $token] = $this->workspace(false);

        $dataset = $this->upload($token, 'sem_cabecalho.csv', "Ana,12345678900,2024-01-02\nBia,98765432100,2024-02-03\n")->assertCreated()->json('data');
        $version = $this->api($token, 'GET', "dataset-versions/{$dataset['latest_version']['id']}")->assertOk()->json('data');
        $warning = collect($version['import_report']['warnings'])->firstWhere('code', 'header_looks_like_data');

        $this->assertNotNull($warning);
        $this->assertSame([2, 3], $warning['positions']);
        $this->assertStringNotContainsString('12345678900', $warning['message']);
    }

    public function test_upload_persists_version_columns_rows_and_original_file(): void
    {
        [, $token] = $this->workspace(false);
        $csv = "id;municipio;quantidade\n0001;Fortaleza;10\n0002;Caucaia;\n";

        $dataset = $this->upload($token, 'Entregas 2026.csv', $csv)->assertCreated()->json('data');

        $this->assertSame('entregas_2026', $dataset['key']);
        $this->assertSame(1, $dataset['latest_version']['number']);
        $this->assertSame(['identifier', 'text', 'number'], array_column($dataset['columns'], 'type'));

        $version = $this->api($token, 'GET', "dataset-versions/{$dataset['latest_version']['id']}")->assertOk()->json('data');
        $this->assertSame(';', $version['delimiter']);
        $this->assertSame(hash('sha256', $csv), $version['checksum']);

        $rows = $this->api($token, 'GET', "dataset-versions/{$version['id']}/rows")->assertOk()->json('data');
        $this->assertSame(['id' => '0001', 'municipio' => 'Fortaleza', 'quantidade' => '10'], $rows[0]['values']);
        $this->assertNull($rows[1]['values']['quantidade']);
        $this->assertSame([2, 3], array_column($rows, 'line_number'));

        $path = DB::table('dataset_versions')->where('id', $version['id'])->value('source_path');
        $this->assertSame($csv, Storage::disk('local')->get($path));
    }

    public function test_new_version_keeps_previous_version_intact_and_reports_changes(): void
    {
        [, $token] = $this->workspace(false);
        $first = $this->upload($token, 'a.csv', "id,valor\n1,10\n2,20\n")->json('data');

        $second = $this->upload($token, 'a-v2.csv', "id,valor,obs\n1,15\n", $first['id'])->assertStatus(422)->json();
        $this->assertSame('csv.ragged_rows', $second['code']);

        $second = $this->upload($token, 'a-v2.csv', "id,valor,obs\n1,15,ok\n", $first['id'])->assertCreated()->json('data');

        $this->assertSame([2, 1], array_column($second['versions'], 'number'));
        $latest = $this->api($token, 'GET', "dataset-versions/{$second['latest_version']['id']}")->json('data');
        $this->assertSame(['obs'], $latest['import_report']['columns_added']);
        $this->assertSame(-1, $latest['import_report']['row_delta']);

        $old = $this->api($token, 'GET', "dataset-versions/{$first['latest_version']['id']}/rows")->json('data');
        $this->assertSame(['10', '20'], array_column(array_column($old, 'values'), 'valor'));
    }

    public function test_invalid_files_return_clear_errors_and_persist_nothing(): void
    {
        [, $token] = $this->workspace(false);

        $this->upload($token, 'dup.csv', "id,ID\n1,2\n")->assertStatus(422)->assertJsonPath('code', 'csv.duplicate_header');
        $this->upload($token, 'vazio.csv', "id,nome\n")->assertStatus(422)->assertJsonPath('code', 'csv.no_rows');
        $this->upload($token, 'planilha.xlsx', "id\n1\n")->assertStatus(422)->assertJsonValidationErrors('file');
        $this->withHeaders(['X-Trace-Workspace' => $token, 'Accept' => 'application/json'])
            ->post('/api/v1/datasets', [])->assertStatus(422)->assertJsonValidationErrors('file');

        config(['trace.limits.rows' => 2]);
        $this->upload($token, 'grande.csv', "id\n1\n2\n3\n")->assertStatus(422)->assertJsonPath('code', 'csv.too_many_rows');

        $this->assertSame(0, DB::table('datasets')->count());
        $this->assertSame(0, DB::table('source_rows')->count());
    }

    public function test_preview_does_not_persist(): void
    {
        [, $token] = $this->workspace(false);
        $file = UploadedFile::fake()->createWithContent('x.csv', "id,v\n01,1\n02,2\n");

        $preview = $this->withHeaders(['X-Trace-Workspace' => $token, 'Accept' => 'application/json'])
            ->post('/api/v1/imports/preview', ['file' => $file])->assertOk()->json('data');

        $this->assertSame(2, $preview['row_count']);
        $this->assertSame('01', $preview['rows'][0]['values']['id']);
        $this->assertSame(0, DB::table('datasets')->count());
    }

    public function test_uploads_can_be_disabled_for_public_demo(): void
    {
        [, $token] = $this->workspace(false);
        config(['trace.uploads_enabled' => false]);

        $this->upload($token, 'a.csv', "id\n1\n")->assertStatus(403)->assertJsonPath('code', 'uploads.disabled');
        $this->getJson('/api/v1/meta')->assertJsonPath('data.uploads_enabled', false);
    }

    public function test_dataset_used_by_a_run_cannot_be_deleted_but_unused_one_can(): void
    {
        [, $token] = $this->workspace();
        $this->runDemo($token);
        $ids = $this->demoIds($token);

        $this->api($token, 'DELETE', "datasets/{$ids['cozinhas']['id']}")->assertStatus(409)->assertJsonPath('code', 'dataset.in_use');

        $extra = $this->upload($token, 'extra.csv', "id\n1\n")->json('data');
        $this->api($token, 'DELETE', "datasets/{$extra['id']}")->assertNoContent();
        $this->api($token, 'GET', "datasets/{$extra['id']}")->assertNotFound();
    }
}
