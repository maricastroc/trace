<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PaginationTest extends TestCase
{
    use RefreshDatabase;

    private function collectAll(string $token, string $uri, string $idKey, int $perPage): array
    {
        $ids = [];
        $page = 1;
        do {
            $response = $this->api($token, 'GET', "{$uri}".(str_contains($uri, '?') ? '&' : '?')."per_page={$perPage}&page={$page}")->assertOk();
            $this->assertLessThanOrEqual($perPage, count($response->json('data')));
            array_push($ids, ...array_column($response->json('data'), $idKey));
            $last = $response->json('meta.last_page');
            $total = $response->json('meta.total');
            $page++;
        } while ($page <= $last);

        return [$ids, $total];
    }

    public function test_investigation_lists_are_paginated_without_gaps_or_duplicates(): void
    {
        [, $token] = $this->workspace();
        $run = $this->runDemo($token);
        $excludedTotal = array_sum(array_column($run['steps'], 'excluded_count'));

        [$exclusions, $total] = $this->collectAll($token, "runs/{$run['id']}/exclusions", 'tuple_no', 7);
        $this->assertSame($excludedTotal, $total);
        $this->assertCount($total, array_unique($exclusions));

        [$diagnostics, $diagnosticsTotal] = $this->collectAll($token, "runs/{$run['id']}/diagnostics", 'id', 3);
        $this->assertCount($diagnosticsTotal, array_unique($diagnostics));

        [$rows, $rowsTotal] = $this->collectAll($token, "dataset-versions/{$run['inputs'][0]['version_id']}/rows", 'id', 25);
        $this->assertSame($run['inputs'][0]['row_count'], $rowsTotal);
        $this->assertCount($rowsTotal, array_unique($rows));

        $fortaleza = $this->resultsByKey($token, $run['id'], 'municipio')['Fortaleza'];
        [$contributors, $contributorsTotal] = $this->collectAll($token, "runs/{$run['id']}/results/{$fortaleza['result_no']}/contributors?input=0", 'id', 4);
        $this->assertSame($fortaleza['contributor_count'], $contributorsTotal);
        $this->assertCount($contributorsTotal, array_unique($contributors));
    }

    public function test_page_size_is_capped_and_invalid_parameters_fall_back_to_defaults(): void
    {
        [, $token] = $this->workspace();
        $run = $this->runDemo($token);

        $caps = [
            "runs/{$run['id']}/exclusions" => 100,
            "runs/{$run['id']}/diagnostics" => 100,
            "runs/{$run['id']}/results" => 200,
            "runs/{$run['id']}/results/1/contributors" => 100,
            "runs/{$run['id']}/results/1/breakdown?by=1" => 100,
            "dataset-versions/{$run['inputs'][0]['version_id']}/rows" => 200,
            'runs' => 100,
        ];

        foreach ($caps as $uri => $cap) {
            $glue = str_contains($uri, '?') ? '&' : '?';
            $this->api($token, 'GET', "{$uri}{$glue}per_page=100000")->assertOk()->assertJsonPath('meta.per_page', $cap);
            $this->api($token, 'GET', "{$uri}{$glue}per_page=abc&page=-4")->assertOk()->assertJsonPath('meta.page', 1);
        }

        $beyond = $this->api($token, 'GET', "runs/{$run['id']}/exclusions?page=999")->assertOk();
        $this->assertSame([], $beyond->json('data'));
        $this->assertGreaterThan(0, $beyond->json('meta.total'));
    }

    public function test_journey_paths_are_paginated_with_complete_outcome_counts(): void
    {
        [, $token] = $this->workspace();
        $run = $this->runDemo($token);
        $kitchen = $this->findRow($token, $run['id'], 'cozinhas', 'id', '0188');

        $first = $this->api($token, 'GET', "runs/{$run['id']}/rows/{$kitchen}/journey?per_page=2")->assertOk()->json('data');
        $second = $this->api($token, 'GET', "runs/{$run['id']}/rows/{$kitchen}/journey?per_page=2&page=2")->json('data');

        $this->assertCount(2, $first['paths']);
        $this->assertSame(6, $first['paths_meta']['total']);
        $this->assertSame(6, array_sum(array_column($first['outcomes'], 'count')));
        $this->assertSame($first['outcomes'], $second['outcomes']);
        $this->assertEmpty(array_intersect(array_column($first['paths'], 'tuple_no'), array_column($second['paths'], 'tuple_no')));
        $this->assertStringContainsString('6 chegaram ao resultado', $first['summary']);
    }
}
