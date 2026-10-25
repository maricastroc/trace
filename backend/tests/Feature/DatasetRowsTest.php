<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class DatasetRowsTest extends TestCase
{
    use RefreshDatabase;

    public function test_rows_can_be_filtered_by_an_exact_value_or_by_empty_cells(): void
    {
        [, $token] = $this->workspace();
        $versionId = $this->demoIds($token)['refeicoes']['latest_version']['id'];

        $this->assertSame(118, $this->api($token, 'GET', "dataset-versions/{$versionId}/rows")->json('meta.total'));

        $exact = $this->api($token, 'GET', "dataset-versions/{$versionId}/rows?column=cozinha_id&value=0999")->assertOk();
        $this->assertSame(2, $exact->json('meta.total'));
        $this->assertSame(['0999', '0999'], array_column(array_column($exact->json('data'), 'values'), 'cozinha_id'));

        $empty = $this->api($token, 'GET', "dataset-versions/{$versionId}/rows?column=cozinha_id&value=")->assertOk();
        $this->assertSame(1, $empty->json('meta.total'));
        $this->assertNull($empty->json('data.0.values.cozinha_id'));

        $this->assertSame(1, $this->api($token, 'GET', "dataset-versions/{$versionId}/rows?column=cozinha_id&value=187")->json('meta.total'), 'values are compared as exact text');
        $this->assertSame(8, $this->api($token, 'GET', "dataset-versions/{$versionId}/rows?column=cozinha_id&value=0187")->json('meta.total'));
    }

    public function test_filtering_by_an_unknown_column_is_rejected(): void
    {
        [, $token] = $this->workspace();
        $versionId = $this->demoIds($token)['refeicoes']['latest_version']['id'];

        $this->api($token, 'GET', "dataset-versions/{$versionId}/rows?column=nao_existe&value=1")
            ->assertStatus(422)
            ->assertJsonPath('code', 'dataset.column_unknown');
    }
}
