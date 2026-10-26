<?php

namespace Tests\Feature;

use App\Modules\Recipes\RecipeCompiler;
use App\Modules\Runs\RunLauncher;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class ComparisonTest extends TestCase
{
    use RefreshDatabase;

    private const YEAR = ['kind' => 'date', 'column' => 'data', 'from' => '2025-01-01', 'to' => '2025-12-31'];

    private function datasets(string $token): array
    {
        return collect($this->api($token, 'GET', 'datasets')->json('data'))->keyBy('key')->all();
    }

    private function rows(string $versionId): Collection
    {
        return DB::table('source_rows')->where('dataset_version_id', $versionId)->orderBy('row_number')->pluck('values')
            ->map(fn (string $json) => json_decode($json, true));
    }

    private function population(array $dataset, string $key, array $extra = []): array
    {
        return ['kind' => 'population', 'dataset_id' => $dataset['id'], 'key' => $key] + $extra;
    }

    private function preview(string $token, array $spec): array
    {
        return $this->api($token, 'POST', 'comparisons/preview', ['spec' => $spec])->assertOk()->json('data');
    }

    private function declared(string $token, array $spec): array
    {
        $equivalence = $this->preview($token, $spec)['equivalence'];
        if ($equivalence['status'] !== 'unconfirmed') {
            return $spec;
        }

        return $spec + ['equivalence' => [
            'a' => ['dataset_id' => $equivalence['a']['dataset_id'], 'key' => $equivalence['a']['key']],
            'b' => ['dataset_id' => $equivalence['b']['dataset_id'], 'key' => $equivalence['b']['key']],
        ]];
    }

    private function trace(string $token, array $spec, ?string $name = null): array
    {
        $created = $this->api($token, 'POST', 'comparisons/trace', ['spec' => $this->declared($token, $spec), 'name' => $name])->assertStatus(202)->json('data');
        $run = $this->api($token, 'GET', "comparison-runs/{$created['id']}")->assertOk()->json('data');
        $this->assertSame('succeeded', $run['status'], json_encode($run['error']));

        return $run;
    }

    private function independent(iterable $aValues, iterable $bValues): array
    {
        $side = function (iterable $values): array {
            $ids = [];
            $empty = 0;
            $rows = 0;
            foreach ($values as $value) {
                $rows++;
                if ($value === null || trim($value) === '') {
                    $empty++;

                    continue;
                }
                $ids['k'.$value] = ($ids['k'.$value] ?? 0) + 1;
            }

            return ['rows' => $rows, 'empty' => $empty, 'ids' => $ids];
        };
        $a = $side($aValues);
        $b = $side($bValues);
        $shared = array_intersect_key($a['ids'], $b['ids']);

        return [
            'a' => ['rows' => $a['rows'], 'empty_rows' => $a['empty'], 'distinct' => count($a['ids']), 'repeated_rows' => array_sum($a['ids']) - count($a['ids'])],
            'b' => ['rows' => $b['rows'], 'empty_rows' => $b['empty'], 'distinct' => count($b['ids']), 'repeated_rows' => array_sum($b['ids']) - count($b['ids'])],
            'shared' => count($shared),
            'only_a' => count($a['ids']) - count($shared),
            'only_b' => count($b['ids']) - count($shared),
            'only_a_keys' => array_map(fn (string $k) => substr($k, 1), array_keys(array_diff_key($a['ids'], $b['ids']))),
            'only_b_keys' => array_map(fn (string $k) => substr($k, 1), array_keys(array_diff_key($b['ids'], $a['ids']))),
        ];
    }

    private function assertMatchesIndependent(array $summary, array $expected): void
    {
        foreach (['a', 'b'] as $side) {
            foreach ($expected[$side] as $field => $value) {
                $this->assertSame($value, $summary[$side][$field], "{$side}.{$field}");
            }
        }
        $this->assertSame([$expected['shared'], $expected['only_a'], $expected['only_b']], [$summary['shared'] + $summary['shared_by_rule'], $summary['only_a'], $summary['only_b']]);
        $this->assertSame($summary['a']['distinct'] - $summary['b']['distinct'], $summary['net_difference']);
        $this->assertSame($summary['only_a'] + $summary['only_b'], $summary['unmatched']);
        foreach ($summary['checks'] as $check) {
            $this->assertTrue($check['holds'], $check['formula']);
        }
    }

    private function cadastro(): array
    {
        [, $token] = $this->workspace(true, 'cadastro');

        return [$token, $this->datasets($token)];
    }

    public function test_the_prototype_reference_case_reconciles_exactly_and_matches_an_independent_count(): void
    {
        [$token, $ds] = $this->cadastro();
        $spec = ['a' => $this->population($ds['beneficiarios'], 'id'), 'b' => $this->population($ds['atendimentos'], 'beneficiario_id', ['period' => self::YEAR])];

        $preview = $this->preview($token, $spec);
        $this->assertTrue($preview['computed']);
        $summary = $preview['summary'];

        $people = $this->rows($ds['beneficiarios']['latest_version']['id'])->pluck('id');
        $served = $this->rows($ds['atendimentos']['latest_version']['id'])->filter(fn (array $r) => $r['data'] >= '2025-01-01' && $r['data'] <= '2025-12-31')->pluck('beneficiario_id');
        $this->assertMatchesIndependent($summary, $this->independent($people, $served));

        $this->assertSame([1242, 1196, 1179, 63, 17, 46, 80], [$summary['a']['distinct'], $summary['b']['distinct'], $summary['shared'], $summary['only_a'], $summary['only_b'], $summary['net_difference'], $summary['unmatched']]);
        $this->assertSame(1248 - 6, $summary['a']['distinct'], 'six ids repeat in the register: rows are not people');
        $this->assertSame(14, $summary['possible_matches']);
        $this->assertSame(['excluded_in_other' => 0, 'outside_other_period' => 0, 'possible_match' => 14, 'ambiguous_match' => 0, 'variant_of_matched' => 0, 'absent' => 49], $summary['explanations']['only_a']);
        $this->assertSame('sources', $preview['attribution']['kind']);
        $this->assertContains('comparison.possible_matches', array_column($preview['issues'], 'code'));
        $this->assertContains('comparison.repeated_identities', array_column($preview['issues'], 'code'));

        $this->assertSame(['absent', 'possible_match'], collect($preview['explained_samples']['only_a'])->keys()->sort()->values()->all());
        $pairs = $preview['explained_samples']['only_a']['possible_match'];
        $this->assertCount(10, $pairs);
        foreach ($pairs as $pair) {
            $this->assertSame('only_a', $pair['category']);
            $this->assertSame(ltrim($pair['identity'], '0'), $pair['detail']['candidate']);
            $this->assertSame(['leading_zeros'], $pair['detail']['rules']);
        }
        $this->assertSame(['absent', 'possible_match'], collect($preview['explained_samples']['only_b'])->keys()->sort()->values()->all());
        $this->assertSame(3, count($preview['explained_samples']['only_b']['absent']));
    }

    public function test_an_accepted_normalization_pairs_only_unique_candidates_and_still_closes(): void
    {
        [$token, $ds] = $this->cadastro();
        $spec = ['a' => $this->population($ds['beneficiarios'], 'id'), 'b' => $this->population($ds['atendimentos'], 'beneficiario_id', ['period' => self::YEAR]), 'rules' => ['leading_zeros']];

        $summary = $this->preview($token, $spec)['summary'];
        $this->assertSame([1179, 14, 49, 3], [$summary['shared'], $summary['shared_by_rule'], $summary['only_a'], $summary['only_b']]);
        $this->assertSame(1242 - 49 + 3, $summary['b']['distinct']);
        $this->assertSame(0, $summary['possible_matches']);

        $run = $this->trace($token, $spec);
        $paired = $this->api($token, 'GET', "comparison-runs/{$run['id']}/identities?category=shared_by_rule&per_page=50")->json('data');
        $this->assertCount(14, $paired);
        foreach ($paired as $identity) {
            $this->assertNotSame($identity['a_value'], $identity['b_value'], 'each side keeps its own text');
            $this->assertSame(ltrim($identity['a_value'], '0'), ltrim($identity['b_value'], '0'));
        }
    }

    public function test_validity_evidence_explains_identities_that_were_not_active_in_the_other_period(): void
    {
        [$token, $ds] = $this->cadastro();
        $this->api($token, 'PUT', "datasets/{$ds['beneficiarios']['id']}/validity", ['start_column' => 'data_cadastro', 'end_column' => 'data_desligamento', 'end_inclusive' => true])->assertOk();
        $spec = ['a' => $this->population($ds['beneficiarios'], 'id'), 'b' => $this->population($ds['atendimentos'], 'beneficiario_id', ['period' => self::YEAR])];

        $summary = $this->preview($token, $spec)['summary'];
        $people = $this->rows($ds['beneficiarios']['latest_version']['id']);
        $served = $this->rows($ds['atendimentos']['latest_version']['id'])->pluck('beneficiario_id')->flip();
        $inactive = $people->groupBy('id')->filter(fn (Collection $rows, $id) => ! isset($served[(string) $id])
            && $rows->every(fn (array $r) => $r['data_cadastro'] > '2025-12-31' || ($r['data_desligamento'] !== null && $r['data_desligamento'] < '2025-01-01')));

        $this->assertSame($inactive->count(), $summary['explanations']['only_a']['outside_other_period']);
        $this->assertSame(18, $summary['explanations']['only_a']['outside_other_period']);
        $this->assertSame(63, array_sum($summary['explanations']['only_a']));
    }

    public function test_rows_excluded_by_the_other_side_explain_each_identity_and_can_be_inspected_page_by_page(): void
    {
        [$token, $ds] = $this->cadastro();
        $firstHalf = ['kind' => 'date', 'column' => 'data', 'from' => '2025-01-01', 'to' => '2025-06-30'];
        $spec = ['a' => $this->population($ds['atendimentos'], 'beneficiario_id', ['period' => self::YEAR, 'label' => 'ano']), 'b' => $this->population($ds['atendimentos'], 'beneficiario_id', ['period' => $firstHalf, 'label' => 'semestre'])];

        $preview = $this->preview($token, $spec);
        $this->assertSame('criteria', $preview['attribution']['kind']);
        $all = $this->rows($ds['atendimentos']['latest_version']['id']);
        $this->assertMatchesIndependent($preview['summary'], $this->independent($all->pluck('beneficiario_id'), $all->filter(fn (array $r) => $r['data'] <= '2025-06-30')->pluck('beneficiario_id')));
        $this->assertSame($preview['summary']['only_a'], $preview['summary']['explanations']['only_a']['excluded_in_other']);
        $this->assertSame(0, $preview['summary']['only_b']);

        $run = $this->trace($token, $spec);
        $this->assertEquals($preview['summary'], $run['summary']);
        $page = $this->api($token, 'GET', "comparison-runs/{$run['id']}/identities?category=only_a&per_page=3&page=2")->assertOk()->json();
        $this->assertSame($preview['summary']['only_a'], $page['meta']['total']);
        $this->assertCount(3, $page['data']);
        $identity = $page['data'][0];
        $this->assertSame('excluded_in_other', $identity['explanation']);
        $this->assertSame('filter.condition_false', $identity['detail']['by'][0]['code']);
        $this->assertSame('Não atende à condição', $identity['detail']['by'][0]['label']);

        $selectedA = $this->api($token, 'GET', "comparison-runs/{$run['id']}/rows?side=a&identity=".urlencode($identity['identity']))->assertOk()->json();
        $this->assertSame($identity['a_rows'], $selectedA['meta']['total']);
        $this->assertSame([$ds['atendimentos']['id'], 1], [$selectedA['meta']['dataset']['id'], $selectedA['meta']['version']['number']]);
        $excludedB = $this->api($token, 'GET', "comparison-runs/{$run['id']}/rows?side=b&state=excluded&identity=".urlencode($identity['identity']))->assertOk()->json();
        $this->assertSame($identity['detail']['by'][0]['rows'], $excludedB['meta']['total']);
        $this->assertSame('excluded', $excludedB['data'][0]['state']);
        $this->assertStringContainsString('2025-06-30', $excludedB['data'][0]['exclusion']['explanation']);
        $this->assertGreaterThan('2025-06-30', $excludedB['data'][0]['values']['data']);
    }

    /**
     * @return array<string, array{0: string, 1: string}>
     */
    public static function smallSets(): array
    {
        return [
            'identical' => ["id\n1\n2\n3\n", "codigo\n3\n2\n1\n"],
            'disjoint' => ["id\n1\n2\n", "codigo\n3\n4\n"],
            'partial' => ["id\n1\n2\n3\n4\n", "codigo\n3\n4\n5\n"],
            'repeated on both sides' => ["id\n1\n1\n1\n2\n3\n", "codigo\n1\n1\n3\n3\n4\n"],
            'empty identifiers' => ["id,n\n1,a\n,b\n   ,c\n2,d\n", "codigo,n\n,x\n2,y\n,z\n"],
            'leading zeros are not equal' => ["id\n0187\n042\n7\n", "codigo\n187\n042\n0007\n"],
            'case is not equal' => ["id\nAna\nBia\n", "codigo\nana\nBia\n"],
        ];
    }

    #[DataProvider('smallSets')]
    public function test_small_sets_reconcile_like_an_independent_set_computation(string $left, string $right): void
    {
        [, $token] = $this->workspace(false);
        $a = $this->upload($token, 'lado_a.csv', $left)->assertCreated()->json('data');
        $b = $this->upload($token, 'lado_b.csv', $right)->assertCreated()->json('data');

        $summary = $this->preview($token, ['a' => $this->population($a, 'id'), 'b' => $this->population($b, 'codigo')])['summary'];
        $expected = $this->independent($this->rows($a['latest_version']['id'])->pluck('id'), $this->rows($b['latest_version']['id'])->pluck('codigo'));
        $this->assertMatchesIndependent($summary, $expected);
        $this->assertSame($summary['a']['rows'], $summary['a']['distinct'] + $summary['a']['repeated_rows'] + $summary['a']['empty_rows'], 'rows are not identities');
    }

    public function test_leading_zeros_stay_different_until_the_rule_is_accepted(): void
    {
        [, $token] = $this->workspace(false);
        $a = $this->upload($token, 'lado_a.csv', "id\n0187\n0042\n0042\n9\n")->json('data');
        $b = $this->upload($token, 'lado_b.csv', "codigo\n187\n42\n042\n9\n")->json('data');
        $spec = ['a' => $this->population($a, 'id'), 'b' => $this->population($b, 'codigo')];

        $strict = $this->preview($token, $spec)['summary'];
        $this->assertSame([1, 0, 2, 3], [$strict['shared'], $strict['shared_by_rule'], $strict['only_a'], $strict['only_b']]);
        $this->assertSame(['possible_match' => 1, 'ambiguous_match' => 1], array_intersect_key(array_filter($strict['explanations']['only_a']), ['possible_match' => 0, 'ambiguous_match' => 0]));

        $ruled = $this->preview($token, $spec + ['rules' => ['leading_zeros']])['summary'];
        $this->assertSame([1, 1, 1, 2], [$ruled['shared'], $ruled['shared_by_rule'], $ruled['only_a'], $ruled['only_b']], '0042 has two candidates (42 and 042): never paired');
        $this->assertSame(1, $ruled['explanations']['only_a']['ambiguous_match']);
    }

    public function test_a_variant_of_an_already_matched_identity_is_named_but_never_paired(): void
    {
        [, $token] = $this->workspace();
        $ids = $this->demoIds($token);
        $preview = $this->preview($token, ['a' => $this->population($ids['refeicoes'], 'cozinha_id'), 'b' => $this->population($ids['cozinhas'], 'id'), 'rules' => ['leading_zeros']]);

        $variant = collect($preview['samples']['only_a'])->firstWhere('identity', '187');
        $this->assertSame('variant_of_matched', $variant['explanation']);
        $this->assertSame(['0187'], $variant['detail']['candidates']);
        $this->assertSame(0, $preview['summary']['shared_by_rule'], '0187 already has an exact pair: 187 cannot become a second one');
        $this->assertSame(1, $preview['summary']['a']['empty_rows']);
    }

    public function test_two_versions_show_what_appeared_disappeared_and_changed_by_key_never_by_position(): void
    {
        [, $token] = $this->workspace(false);
        $v1 = $this->upload($token, 'cadastro.csv', "id,valor,bairro\n1,10,Centro\n2,20,Sul\n3,30,Norte\n3,31,Norte\n5,50,Leste\n")->json('data');
        $this->upload($token, 'cadastro.csv', "id,valor,bairro\n5,55,Leste\n2,20,Sul\n4,40,Oeste\n3,99,Norte\n", $v1['id'])->assertCreated();
        $versions = $this->api($token, 'GET', "datasets/{$v1['id']}")->json('data.versions');
        $ids = collect($versions)->keyBy('number');

        $spec = [
            'a' => $this->population($v1, 'id', ['version_id' => $ids[1]['id'], 'label' => 'versão 1']),
            'b' => $this->population($v1, 'id', ['version_id' => $ids[2]['id'], 'label' => 'versão 2']),
            'fields' => [['a' => 'valor', 'b' => 'valor'], ['a' => 'bairro', 'b' => 'bairro']],
        ];
        $preview = $this->preview($token, $spec);
        $this->assertSame('versions', $preview['attribution']['kind']);
        $this->assertSame([3, 1, 1], [$preview['summary']['shared'], $preview['summary']['only_a'], $preview['summary']['only_b']]);
        $this->assertSame(['a' => 'valor', 'b' => 'valor', 'compared' => 3, 'same' => 1, 'different' => 2, 'partial' => 0], $preview['summary']['fields'][0]);

        $run = $this->trace($token, $spec);
        $byIdentity = collect($this->api($token, 'GET', "comparison-runs/{$run['id']}/identities?per_page=50")->json('data'))->keyBy('identity');
        $this->assertSame('only_a', $byIdentity['1']['category']);
        $this->assertSame('only_b', $byIdentity['4']['category']);
        $this->assertSame([2, 1], [$byIdentity['3']['a_rows'], $byIdentity['3']['b_rows']]);
        $this->assertSame(['30', '31'], $byIdentity['3']['fields'][0]['a_values']);
        $this->assertSame('different', $byIdentity['3']['fields'][0]['status']);
        $this->assertSame('same', $byIdentity['5']['fields'][1]['status'], 'id 5 moved to the first line: same identity');
        $changed = $this->api($token, 'GET', "comparison-runs/{$run['id']}/identities?changed=1")->json('meta.total');
        $this->assertSame(2, $changed);
    }

    public function test_a_traced_comparison_keeps_its_versions_after_the_data_changes(): void
    {
        [, $token] = $this->workspace(false);
        $a = $this->upload($token, 'pessoas.csv', "id\n1\n2\n3\n")->json('data');
        $b = $this->upload($token, 'atendidos.csv', "pessoa\n2\n3\n4\n")->json('data');
        $spec = ['a' => $this->population($a, 'id'), 'b' => $this->population($b, 'pessoa')];

        $old = $this->trace($token, $spec);
        $this->upload($token, 'atendidos.csv', "pessoa\n1\n2\n3\n", $b['id'])->assertCreated();

        $fresh = $this->preview($token, $spec)['summary'];
        $this->assertSame([3, 0, 0], [$fresh['shared'], $fresh['only_a'], $fresh['only_b']]);
        $kept = $this->api($token, 'GET', "comparison-runs/{$old['id']}")->json('data');
        $this->assertSame([2, 1, 1], [$kept['summary']['shared'], $kept['summary']['only_a'], $kept['summary']['only_b']]);
        $this->assertSame(1, $kept['sides']['b']['version']['number']);
        $rows = $this->api($token, 'GET', "comparison-runs/{$old['id']}/rows?side=b&identity=4")->json();
        $this->assertSame(1, $rows['meta']['total'], 'the old run still reads version 1, where 4 exists');

        $again = $this->trace($token, $spec);
        $this->assertSame($old['comparison_id'], $again['comparison_id']);
        $history = $this->api($token, 'GET', "comparison-runs?comparison_id={$old['comparison_id']}")->assertOk()->json();
        $this->assertSame([$again['id'], $old['id']], array_column($history['data'], 'id'));
        $this->assertSame([2, 1], array_map(fn (array $run) => $run['sides']['b']['version']['number'], $history['data']), 'each run keeps its own version');
        $listed = $this->api($token, 'GET', 'comparisons')->json('data.0');
        $this->assertSame([2, $again['id'], 'pessoa'], [$listed['runs'], $listed['last_run']['id'], $listed['last_run']['sides']['b']['key']]);
        $this->assertSame(2, $again['sides']['b']['version']['number']);
        $this->assertSame(2, DB::table('comparison_runs')->where('comparison_id', $old['comparison_id'])->count());
    }

    public function test_preview_and_trace_agree_on_every_identity(): void
    {
        [$token, $ds] = $this->cadastro();
        $spec = [
            'a' => $this->population($ds['beneficiarios'], 'id'),
            'b' => $this->population($ds['atendimentos'], 'beneficiario_id', ['period' => self::YEAR]),
            'rules' => ['leading_zeros'],
            'fields' => [['a' => 'cozinha_id', 'b' => 'cozinha_id']],
        ];
        $preview = $this->preview($token, $this->declared($token, $spec));
        $run = $this->trace($token, $spec, 'Cadastro × atendidos');

        $this->assertEquals($preview['summary'], $run['summary']);
        $this->assertSame($preview['spec_key'], DB::table('comparisons')->where('id', $run['comparison_id'])->value('spec_key'));
        $this->assertSame('Cadastro × atendidos', $this->api($token, 'GET', 'comparisons')->json('data.0.name'));
        foreach (['shared', 'shared_by_rule', 'only_a', 'only_b'] as $category) {
            $traced = $this->api($token, 'GET', "comparison-runs/{$run['id']}/identities?category={$category}&per_page=10")->json('data');
            $this->assertEquals($preview['samples'][$category], $traced, $category);
        }
        $field = $run['summary']['fields'][0];
        $this->assertSame($field['compared'], $field['same'] + $field['different'] + $field['partial']);
        $this->assertSame($run['summary']['shared'] + $run['summary']['shared_by_rule'], $field['compared']);
        $this->assertNotNull(DB::table('runs')->where('id', $run['sides']['a']['run_id'])->value('id'), 'each side is a traced engine run');
    }

    public function test_traced_question_runs_compare_their_populations_and_attribute_the_difference_to_the_criteria(): void
    {
        [$token, $ds] = $this->cadastro();
        $this->api($token, 'PUT', "datasets/{$ds['beneficiarios']['id']}/validity", ['start_column' => 'data_cadastro', 'end_column' => 'data_desligamento', 'end_inclusive' => true])->assertOk();
        $question = fn (string $reading) => [
            'base_dataset_id' => $ds['beneficiarios']['id'],
            'measure' => ['function' => 'count_distinct', 'column' => 'id'],
            'period' => ['kind' => 'validity', 'reading' => $reading, 'from' => '2025-01-01', 'to' => '2025-12-31'],
            'dimension' => null,
        ];
        $active = $this->api($token, 'POST', 'questions/trace', ['question' => $question('active_any')])->assertStatus(202)->json('data.run.id');
        $started = $this->api($token, 'POST', 'questions/trace', ['question' => $question('started')])->assertStatus(202)->json('data.run.id');

        $run = $this->trace($token, ['a' => ['kind' => 'run', 'run_id' => $active, 'key' => 'id'], 'b' => ['kind' => 'run', 'run_id' => $started, 'key' => 'id']]);
        $this->assertSame('criteria', $run['attribution']['kind']);
        $this->assertSame(['steps'], $run['attribution']['differences']);

        $people = $this->rows($ds['beneficiarios']['latest_version']['id']);
        $activeIds = $people->filter(fn (array $r) => $r['data_cadastro'] <= '2025-12-31' && ($r['data_desligamento'] === null || $r['data_desligamento'] >= '2025-01-01'))->pluck('id');
        $startedIds = $people->filter(fn (array $r) => $r['data_cadastro'] >= '2025-01-01' && $r['data_cadastro'] <= '2025-12-31')->pluck('id');
        $this->assertMatchesIndependent($run['summary'], $this->independent($activeIds, $startedIds));
        $this->assertSame($run['summary']['only_a'], $run['summary']['explanations']['only_a']['excluded_in_other']);

        $identity = $this->api($token, 'GET', "comparison-runs/{$run['id']}/identities?category=only_a&per_page=1")->json('data.0');
        $this->assertSame('filter.validity_out', $identity['detail']['by'][0]['code']);
        $this->assertSame($active, $run['sides']['a']['run_id'], 'run sides reuse the traced runs');
        $this->assertSame([[], []], [$run['changes']['a'], $run['changes']['b']]);

        $this->api($token, 'PUT', "datasets/{$ds['beneficiarios']['id']}/validity", ['start_column' => 'data_cadastro', 'end_column' => 'data_desligamento', 'end_inclusive' => false])->assertOk();
        $now = $this->preview($token, ['a' => ['kind' => 'run', 'run_id' => $active, 'key' => 'id'], 'b' => ['kind' => 'run', 'run_id' => $started, 'key' => 'id']]);
        $warning = collect($now['issues'])->firstWhere('code', 'comparison.run_decisions_changed');
        $this->assertNotNull($warning, 'a run side calculated with older decisions is flagged');
        $this->assertStringContainsString('data_cadastro → data_desligamento (fim incluído)', $warning['message']);
        $this->assertStringContainsString('agora é data_cadastro → data_desligamento (fim excluído)', $warning['message']);
        $this->assertEquals($run['summary'], $now['summary'], 'the runs keep the numbers they recorded');

        $reopened = $this->api($token, 'GET', "comparison-runs/{$run['id']}")->assertOk()->json('data');
        $this->assertStringContainsString('fim excluído', $reopened['changes']['a'][0]['message']);
        $this->assertSame($run['summary'], $reopened['summary']);
    }

    public function test_comparing_fields_needs_evidence_or_an_explicit_declaration_that_is_kept_with_the_trace(): void
    {
        [$token, $ds] = $this->cadastro();
        $kitchens = $this->population($ds['cozinhas'], 'municipio', ['label' => 'municípios']);
        $people = $this->population($ds['beneficiarios'], 'id', ['label' => 'cadastro']);
        $unrelated = ['a' => $people, 'b' => $kitchens];

        $preview = $this->preview($token, $unrelated);
        $this->assertTrue($preview['computed'], 'a preview persists nothing, so it still computes');
        $this->assertSame(['unconfirmed', null], [$preview['equivalence']['status'], $preview['equivalence']['relationship_id']]);
        $this->assertSame(['beneficiarios.id', 'cozinhas.municipio'], [$preview['equivalence']['a']['name'], $preview['equivalence']['b']['name']]);
        $this->assertSame(['comparison.equivalence_unconfirmed'], array_column($preview['pending'], 'code'));
        $this->api($token, 'POST', 'comparisons/trace', ['spec' => $unrelated])->assertStatus(422)->assertJsonPath('code', 'comparison.not_runnable');

        $declaration = ['a' => ['dataset_id' => $ds['beneficiarios']['id'], 'key' => 'id'], 'b' => ['dataset_id' => $ds['cozinhas']['id'], 'key' => 'municipio']];
        $declared = $this->preview($token, $unrelated + ['equivalence' => $declaration]);
        $this->assertSame('declared', $declared['equivalence']['status']);
        $this->assertSame(['kind' => 'unknown', 'registry' => null, 'entity' => null, 'key_unique' => null], $declared['equivalence']['reading'], 'a declaration alone says nothing about what each side is');
        $this->assertStringContainsString('O Trace não verificou essa equivalência', $declared['equivalence']['statement']);
        $this->assertSame([], $declared['pending']);
        $this->assertEquals($preview['summary'], $declared['summary'], 'the declaration never changes the reconciliation');
        $this->assertNotSame($preview['spec_key'], $declared['spec_key']);

        $stale = $this->preview($token, ['a' => $people, 'b' => $this->population($ds['cozinhas'], 'id'), 'equivalence' => $declaration]);
        $this->assertSame('unconfirmed', $stale['equivalence']['status'], 'a declaration only holds for the columns it names');
        $this->assertContains('comparison.equivalence_stale', array_column($stale['issues'], 'code'));
        $this->assertArrayNotHasKey('equivalence', $stale['spec']);

        $run = $this->api($token, 'POST', 'comparisons/trace', ['spec' => $unrelated + ['equivalence' => $declaration]])->assertStatus(202)->json('data');
        $run = $this->api($token, 'GET', "comparison-runs/{$run['id']}")->json('data');
        $this->assertSame(['succeeded', 'declared'], [$run['status'], $run['equivalence']['status']]);
        $this->assertEquals($declaration, $run['spec']['equivalence']);
        $this->assertSame(['cadastro', 'municípios'], [$run['sides']['a']['label'], $run['sides']['b']['label']]);
        $this->assertSame('declared', $this->api($token, 'GET', 'comparison-runs')->json('data.0.equivalence.status'));

        $renamed = $this->preview($token, ['a' => ['label' => 'Cadastro de beneficiários'] + $people, 'b' => $kitchens, 'equivalence' => $declaration]);
        $this->assertSame('Cadastro de beneficiários', $renamed['sides']['a']['label']);
        $this->assertSame('cadastro', $this->api($token, 'GET', "comparison-runs/{$run['id']}")->json('data.sides.a.label'), 'renaming later never touches a traced run');

        $same = $this->preview($token, ['a' => $people, 'b' => $this->population($ds['beneficiarios'], 'id', ['period' => ['kind' => 'date', 'column' => 'data_cadastro', 'from' => '2025-01-01', 'to' => '2025-12-31']])]);
        $this->assertSame(['same_field', []], [$same['equivalence']['status'], $same['pending']]);
        $this->assertSame(['same_field', 'beneficiarios', false], [$same['equivalence']['reading']['kind'], $same['equivalence']['reading']['entity']['dataset'], $same['equivalence']['reading']['key_unique']]);

        $suggested = $this->preview($token, ['a' => $people, 'b' => $this->population($ds['atendimentos'], 'beneficiario_id')]);
        $relation = collect($this->api($token, 'GET', 'relationships')->json('data'))->first(fn (array $r) => $r['from']['dataset_key'] === 'atendimentos' && $r['from']['column'] === 'beneficiario_id');
        $this->assertSame(['unconfirmed', $relation['id'], 'suggested'], [$suggested['equivalence']['status'], $suggested['equivalence']['relationship_id'], $suggested['equivalence']['relationship_standing']]);
        $this->assertStringContainsString('sugere estas colunas', $suggested['equivalence']['statement']);

        $byKitchen = collect($this->api($token, 'GET', 'relationships')->json('data'))->first(fn (array $r) => $r['from']['dataset_key'] === 'atendimentos' && $r['from']['column'] === 'cozinha_id');
        $this->api($token, 'POST', "relationships/{$byKitchen['id']}/confirm")->assertOk();
        $kitchenSpec = ['a' => $this->population($ds['cozinhas'], 'id'), 'b' => $this->population($ds['atendimentos'], 'cozinha_id')];
        $confirmed = $this->preview($token, $kitchenSpec);
        $this->assertSame(['unconfirmed', $byKitchen['id'], 'confirmed'], [$confirmed['equivalence']['status'], $confirmed['equivalence']['relationship_id'], $confirmed['equivalence']['relationship_standing']]);
        $this->assertStringContainsString('autoriza usar a relação para ligar tabelas, mas não declara', $confirmed['equivalence']['statement'], 'a many-to-one join alone is not an identity');
        $this->assertSame('unknown', $confirmed['equivalence']['reading']['kind']);

        $this->api($token, 'POST', "relationships/{$byKitchen['id']}/identity")->assertOk()->assertJsonPath('data.status', 'confirmed');
        $declared = $this->preview($token, $kitchenSpec);
        $this->assertSame(['map_declared', []], [$declared['equivalence']['status'], $declared['pending']]);
        $this->assertStringContainsString('No Mapa, você declarou que cozinhas.id e atendimentos.cozinha_id identificam a mesma entidade', $declared['equivalence']['statement']);
        $this->assertSame(['registry_references', 'a', 'cozinhas'], [$declared['equivalence']['reading']['kind'], $declared['equivalence']['reading']['registry'], $declared['equivalence']['reading']['entity']['dataset']]);
        $this->assertEquals($confirmed['summary'], $declared['summary']);

        $this->api($token, 'POST', "relationships/{$byKitchen['id']}/reject")->assertOk()->assertJsonPath('data.identity_declared_at', null);
        $this->assertSame('unconfirmed', $this->preview($token, $kitchenSpec)['equivalence']['status'], 'rejecting the relation withdraws its identity declaration');
        $this->api($token, 'POST', "relationships/{$byKitchen['id']}/identity")->assertStatus(422)->assertJsonPath('code', 'relationship.identity_on_rejected');
    }

    public function test_a_declared_reference_reads_as_registry_against_references_and_a_trace_keeps_the_reading_it_had(): void
    {
        [, $token] = $this->workspace(true, 'refeicoes');
        $ds = $this->datasets($token);
        $year = ['kind' => 'date', 'column' => 'data', 'from' => '2026-01-01', 'to' => '2026-12-31'];
        $spec = ['a' => $this->population($ds['cozinhas'], 'id', ['label' => 'Cozinhas']), 'b' => $this->population($ds['refeicoes'], 'cozinha_id', ['period' => $year, 'label' => 'Refeições de 2026'])];
        $relation = collect($this->api($token, 'GET', 'relationships')->json('data'))->first(fn (array $r) => $r['from']['dataset_key'] === 'refeicoes' && $r['from']['column'] === 'cozinha_id');

        $suggested = $this->preview($token, $spec);
        $this->assertSame(['unconfirmed', 'unknown'], [$suggested['equivalence']['status'], $suggested['equivalence']['reading']['kind']], 'a suggested relation is not characterized enough');

        $this->api($token, 'POST', "relationships/{$relation['id']}/confirm")->assertOk();
        $this->assertSame('unconfirmed', $this->preview($token, $spec)['equivalence']['status'], 'confirming the join does not declare the identity');
        $this->api($token, 'POST', "relationships/{$relation['id']}/identity")->assertOk();
        $preview = $this->preview($token, $spec);
        $this->assertSame(['map_declared', []], [$preview['equivalence']['status'], $preview['pending']]);
        $this->assertSame(['kind' => 'registry_references', 'registry' => 'a', 'entity' => ['dataset' => 'cozinhas', 'name' => $ds['cozinhas']['name']], 'key_unique' => true], $preview['equivalence']['reading']);

        $kitchens = $this->rows($ds['cozinhas']['latest_version']['id'])->pluck('id');
        $meals = $this->rows($ds['refeicoes']['latest_version']['id'])->filter(fn (array $r) => $r['data'] >= '2026-01-01' && $r['data'] <= '2026-12-31')->pluck('cozinha_id');
        $this->assertMatchesIndependent($preview['summary'], $this->independent($kitchens, $meals));
        $summary = $preview['summary'];
        $this->assertSame([15, 15, 13, 2, 2], [$summary['a']['distinct'], $summary['b']['distinct'], $summary['shared'], $summary['only_a'], $summary['only_b']]);
        $this->assertGreaterThan($summary['b']['distinct'], $summary['b']['rows'], 'referenced identifiers are not meals');

        $run = $this->trace($token, $spec);
        $this->assertSame(['map_declared', 'registry_references'], [$run['equivalence']['status'], $run['equivalence']['reading']['kind']]);

        $this->api($token, 'DELETE', "relationships/{$relation['id']}/identity")->assertOk()->assertJsonPath('data.identity_declared_at', null);
        $now = $this->preview($token, $spec);
        $this->assertSame(['unconfirmed', 'unknown'], [$now['equivalence']['status'], $now['equivalence']['reading']['kind']]);
        $kept = $this->api($token, 'GET', "comparison-runs/{$run['id']}")->json('data');
        $this->assertSame(['map_declared', 'registry_references', 'a'], [$kept['equivalence']['status'], $kept['equivalence']['reading']['kind'], $kept['equivalence']['reading']['registry']], 'a traced run keeps the reading it was traced with');
        $this->assertStringContainsString('Essa declaração foi retirada depois', $kept['changes']['equivalence'], 'the run says the declaration it used is no longer in force');
    }

    public function test_a_confirmed_relation_alone_does_not_make_two_columns_the_same_identity(): void
    {
        [$token, $ds] = $this->cadastro();
        $oneToOne = $this->api($token, 'POST', 'relationships', [
            'from_dataset_id' => $ds['atendimentos']['id'], 'from_column' => 'id', 'to_dataset_id' => $ds['cozinhas']['id'], 'to_column' => 'id',
        ])->assertCreated()->json('data');
        $this->api($token, 'POST', "relationships/{$oneToOne['id']}/confirm")->assertOk();
        $preview = $this->preview($token, ['a' => $this->population($ds['cozinhas'], 'id'), 'b' => $this->population($ds['atendimentos'], 'id')]);
        $this->assertSame(['unconfirmed', $oneToOne['id'], 'confirmed'], [$preview['equivalence']['status'], $preview['equivalence']['relationship_id'], $preview['equivalence']['relationship_standing']]);
        $this->assertStringContainsString('não declara que cozinhas.id e atendimentos.id identificam a mesma entidade', $preview['equivalence']['statement']);
        $this->assertSame(['comparison.equivalence_unconfirmed'], array_column($preview['pending'], 'code'));

        $served = collect($this->api($token, 'GET', 'relationships')->json('data'))->first(fn (array $r) => $r['from']['dataset_key'] === 'atendimentos' && $r['from']['column'] === 'beneficiario_id');
        $this->api($token, 'POST', "relationships/{$served['id']}/confirm", ['policy' => 'accept_multiplicity'])->assertOk();
        $spec = ['a' => $this->population($ds['beneficiarios'], 'id'), 'b' => $this->population($ds['atendimentos'], 'beneficiario_id')];
        $multiplied = $this->preview($token, $spec);
        $this->assertSame(['unconfirmed', 'caveat'], [$multiplied['equivalence']['status'], $multiplied['equivalence']['relationship_standing']]);
        $this->assertStringContainsString('beneficiarios.id tem valores repetidos', $multiplied['equivalence']['statement']);
        $this->api($token, 'POST', 'comparisons/trace', ['spec' => $spec])->assertStatus(422)->assertJsonPath('code', 'comparison.not_runnable');

        $run = $this->trace($token, $spec);
        $this->assertSame(['declared', 'unknown'], [$run['equivalence']['status'], $run['equivalence']['reading']['kind']]);
        $this->assertStringContainsString('O Trace não verificou essa equivalência', $run['equivalence']['statement']);
    }

    public function test_invalid_and_ambiguous_definitions_are_explained_before_any_computation(): void
    {
        [$token, $ds] = $this->cadastro();
        $people = $this->population($ds['beneficiarios'], 'id');
        $queued = app(RunLauncher::class)->record($this->workspaceModel($token), app(RecipeCompiler::class)->compile($this->workspaceModel($token), $ds['cozinhas']['id'], [
            ['type' => 'aggregate', 'group_by' => [['alias' => 'cozinhas', 'column' => 'id']], 'measures' => [['function' => 'count', 'name' => 'n']]],
        ]), null);

        $cases = [
            'comparison.sides_missing' => ['a' => $people],
            'comparison.dataset_missing' => ['a' => $people, 'b' => ['kind' => 'population', 'dataset_id' => 'nao-existe', 'key' => 'id']],
            'comparison.key_missing' => ['a' => $people, 'b' => $this->population($ds['atendimentos'], 'pessoa')],
            'comparison.version_unavailable' => ['a' => $people, 'b' => $this->population($ds['atendimentos'], 'id', ['version_id' => $ds['cozinhas']['latest_version']['id']])],
            'comparison.run_not_ready' => ['a' => $people, 'b' => ['kind' => 'run', 'run_id' => $queued->id, 'key' => 'id']],
            'comparison.dimension_value_required' => ['a' => $people, 'b' => $this->population($ds['atendimentos'], 'id', ['dimension' => ['relationships' => [], 'column' => 'cozinha_id', 'label_column' => null, 'value' => null]])],
            'comparison.reading_required' => ['a' => $people, 'b' => $this->population($ds['beneficiarios'], 'id', ['period' => ['kind' => 'validity', 'reading' => null, 'from' => '2025-01-01', 'to' => '2025-12-31']])],
            'comparison.rule_unknown' => ['a' => $people, 'b' => $people, 'rules' => ['ignorar_tudo']],
            'comparison.field_missing' => ['a' => $people, 'b' => $people, 'fields' => [['a' => 'cozinha_id', 'b' => 'nao_existe']]],
        ];
        foreach ($cases as $code => $spec) {
            $response = $this->api($token, 'POST', 'comparisons/preview', ['spec' => $spec])->assertStatus(422);
            $this->assertSame($code, $response->json('details.issues.0.code'), $code);
        }

        $kitchens = collect($this->api($token, 'GET', 'relationships')->json('data'))->first(fn (array $r) => $r['from']['dataset_key'] === 'beneficiarios' && $r['to']['dataset_key'] === 'cozinhas');
        $pending = ['a' => $people, 'b' => $this->population($ds['beneficiarios'], 'id', ['dimension' => ['relationships' => [$kitchens['id']], 'column' => 'id', 'label_column' => null, 'value' => '0101']])];
        $preview = $this->preview($token, $pending);
        $this->assertTrue($preview['computed'], 'an unconfirmed relation with a unique target does not change the result');
        $this->assertSame(['join.relationship_unconfirmed'], array_column($preview['pending'], 'code'));
        $this->assertSame(['criteria', ['cut']], [$preview['attribution']['kind'], $preview['attribution']['differences']]);
        $this->api($token, 'POST', 'comparisons/trace', ['spec' => $pending])->assertStatus(422)->assertJsonPath('code', 'comparison.not_runnable');
        $this->assertSame(0, DB::table('comparisons')->count());

        $this->api($token, 'POST', 'comparisons/preview', ['spec' => ['a' => $people, 'b' => $this->population($ds['atendimentos'], 'data')]])
            ->assertOk()->assertJsonPath('data.issues.0.code', 'comparison.key_types_differ');
        $notReady = $this->api($token, 'POST', 'comparisons/trace', ['spec' => ['a' => $people, 'b' => $people]])->json('data.id');
        DB::table('comparison_runs')->where('id', $notReady)->update(['status' => 'running']);
        $this->api($token, 'GET', "comparison-runs/{$notReady}/identities")->assertStatus(409);
    }

    public function test_the_larger_prototype_reference_closes_on_generated_sets_within_the_import_limit(): void
    {
        [, $token] = $this->workspace(false);
        $shared = array_map(fn (int $n) => sprintf('P%05d', $n), range(1, 20408));
        $onlyA = array_map(fn (int $n) => sprintf('A%05d', $n), range(1, 3592));
        $onlyB = array_map(fn (int $n) => sprintf('B%05d', $n), range(1, 1372));
        $left = array_merge($shared, $onlyA);
        $right = array_merge($onlyB, array_reverse($shared));

        $a = $this->upload($token, 'rede_a.csv', "id\n".implode("\n", $left)."\n")->assertCreated()->json('data');
        $b = $this->upload($token, 'rede_b.csv', "pessoa\n".implode("\n", $right)."\n")->assertCreated()->json('data');
        $summary = $this->preview($token, ['a' => $this->population($a, 'id'), 'b' => $this->population($b, 'pessoa')])['summary'];

        $this->assertSame([24000, 21780, 20408, 3592, 1372], [$summary['a']['distinct'], $summary['b']['distinct'], $summary['shared'], $summary['only_a'], $summary['only_b']]);
        $this->assertSame(24000, $summary['shared'] + $summary['only_a']);
        $this->assertSame(21780, $summary['shared'] + $summary['only_b']);
        $this->assertSame(2220, $summary['net_difference']);
        $this->assertSame(4964, $summary['unmatched'], 'the net difference is not the number of divergences');
    }
}
