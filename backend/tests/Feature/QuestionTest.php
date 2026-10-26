<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class QuestionTest extends TestCase
{
    use RefreshDatabase;

    private function datasets(string $token): array
    {
        return collect($this->api($token, 'GET', 'datasets')->json('data'))->keyBy('key')->all();
    }

    private function relation(string $token, string $from, string $to): array
    {
        return collect($this->api($token, 'GET', 'relationships')->json('data'))
            ->first(fn (array $r) => "{$r['from']['dataset_key']}.{$r['from']['column']}" === $from && "{$r['to']['dataset_key']}.{$r['to']['column']}" === $to);
    }

    private function rows(array $dataset): Collection
    {
        return DB::table('source_rows')->where('dataset_version_id', $dataset['latest_version']['id'])->orderBy('row_number')->pluck('values')
            ->map(fn (string $json) => json_decode($json, true));
    }

    private function cadastro(): array
    {
        [, $token] = $this->workspace(true, 'cadastro');
        $datasets = $this->datasets($token);
        $this->api($token, 'PUT', "datasets/{$datasets['beneficiarios']['id']}/validity", [
            'start_column' => 'data_cadastro', 'end_column' => 'data_desligamento', 'end_inclusive' => true,
        ])->assertOk();
        $kitchens = $this->relation($token, 'beneficiarios.cozinha_id', 'cozinhas.id');
        $this->api($token, 'POST', "relationships/{$kitchens['id']}/confirm")->assertOk();

        return [$token, $datasets, $kitchens];
    }

    private function beneficiariesQuestion(array $datasets, array $kitchens, ?string $reading, ?string $kitchen = null): array
    {
        return [
            'base_dataset_id' => $datasets['beneficiarios']['id'],
            'measure' => ['function' => 'count_distinct', 'column' => 'id'],
            'period' => ['kind' => 'validity', 'reading' => $reading, 'from' => '2025-01-01', 'to' => '2025-12-31'],
            'dimension' => ['relationships' => [$kitchens['id']], 'column' => 'id', 'label_column' => 'nome', 'value' => $kitchen],
        ];
    }

    private function trace(string $token, array $question, string $title = 'Pergunta de teste'): array
    {
        $traced = $this->api($token, 'POST', 'questions/trace', ['question' => $question, 'title' => $title])->assertStatus(202)->json('data');
        $run = $this->api($token, 'GET', "runs/{$traced['run']['id']}")->assertOk()->json('data');
        $this->assertSame('succeeded', $run['status']);

        return [$traced, $run];
    }

    public function test_a_question_becomes_a_recipe_whose_preview_matches_the_traced_run(): void
    {
        [$token, $datasets, $kitchens] = $this->cadastro();
        $question = $this->beneficiariesQuestion($datasets, $kitchens, 'active_any');

        $answer = $this->api($token, 'POST', 'questions/preview', ['question' => $question])->assertOk()->json('data');
        $this->assertFalse($answer['needs_reading']);
        $this->assertSame(['vigencia', 'ligacao_1', 'resposta'], array_column($answer['recipe']['steps'], 'id'));
        $this->assertSame('left', $answer['recipe']['steps'][1]['join_type']);
        $this->assertSame([['alias' => 'cozinhas', 'column' => 'id'], ['alias' => 'cozinhas', 'column' => 'nome']], $answer['recipe']['steps'][2]['group_by']);
        $this->assertSame(['resposta', 'registros'], array_column($answer['recipe']['steps'][2]['measures'], 'name'));

        $preview = $answer['preview'];
        $this->assertTrue($preview['computed']);

        [$traced, $run] = $this->trace($token, $question);
        $results = $this->api($token, 'GET', "runs/{$run['id']}/results?per_page=200")->json('data');
        $this->assertEquals(array_map(fn (array $r) => $r['values'], $results), array_column($preview['results'], 'values'));
        $this->assertEquals($run['totals'], $preview['totals']);

        $rows = $this->rows($datasets['beneficiarios']);
        $active = $rows->filter(fn (array $r) => $r['data_cadastro'] <= '2025-12-31' && ($r['data_desligamento'] === null || $r['data_desligamento'] >= '2025-01-01'));
        $this->assertSame($active->pluck('id')->unique()->count(), $preview['totals']['values']['resposta']);
        $this->assertSame($active->count(), $preview['totals']['values']['registros']);

        $recipe = $this->api($token, 'GET', "recipes/{$traced['recipe_id']}")->json('data');
        $this->assertEquals($answer['question'], $recipe['question']);
        $this->assertSame($answer['question_key'], $recipe['question_key']);
        $this->assertSame('Pergunta de teste', $recipe['name']);
    }

    public function test_a_traced_run_records_its_decisions_and_reports_the_ones_that_changed_later(): void
    {
        [$token, $datasets, $kitchens] = $this->cadastro();
        $question = $this->beneficiariesQuestion($datasets, $kitchens, 'active_any');
        $before = $this->api($token, 'POST', 'questions/preview', ['question' => $question])->assertOk()->json('data.preview');

        [, $run] = $this->trace($token, $question);
        $this->assertSame($before['basis']['decisions_key'], $run['decisions_key'], 'preview and run agree while nothing changes');
        $this->assertEquals($question['measure'], $run['recipe']['question']['measure'], 'the question travels with the run');
        $this->assertSame([], $run['decision_changes']);
        $relation = collect($run['decisions'])->firstWhere('kind', 'relation');
        $validity = collect($run['decisions'])->firstWhere('kind', 'validity');
        $this->assertSame(['confirmed', null, 'beneficiarios.cozinha_id → cozinhas.id'], [$relation['status'], $relation['policy'], $relation['route']]);
        $this->assertSame(['data_cadastro', 'data_desligamento', true], [$validity['start_column'], $validity['end_column'], $validity['end_inclusive']]);
        $join = collect($run['steps'])->firstWhere('type', 'join');
        $this->assertSame(['confirmed', null, 'forward'], [$join['join']['relationship_status'], $join['join']['relationship_policy'], $join['join']['direction']]);

        $this->api($token, 'PUT', "datasets/{$datasets['beneficiarios']['id']}/validity", [
            'start_column' => 'data_cadastro', 'end_column' => 'data_desligamento', 'end_inclusive' => false,
        ])->assertOk();
        $after = $this->api($token, 'POST', 'questions/preview', ['question' => $question])->assertOk()->json('data.preview');
        $this->assertNotSame($run['decisions_key'], $after['basis']['decisions_key'], 'the current preview no longer matches the run');

        $this->api($token, 'POST', "relationships/{$kitchens['id']}/reopen")->assertOk();
        $old = $this->api($token, 'GET', "runs/{$run['id']}")->assertOk()->json('data');
        $this->assertSame($run['totals'], $old['totals'], 'the old run keeps its numbers');
        $this->assertSame($run['decisions'], $old['decisions'], 'and the decisions it used');
        $this->assertSame([
            'A vigência de beneficiarios era data_cadastro → data_desligamento (fim incluído); agora é data_cadastro → data_desligamento (fim excluído).',
            'A relação beneficiarios.cozinha_id → cozinhas.id estava confirmada como N:1; agora está sugerida, sem confirmação.',
        ], array_column($old['decision_changes'], 'message'));

        $recorded = 'data_cadastro ≤ 31/12/2025 e (data_desligamento vazio ou data_desligamento ≥ 01/01/2025)';
        $this->assertTrue($old['interpretation']['recorded']);
        $this->assertSame($recorded, $old['interpretation']['criteria'][0]['rule'], 'the old run keeps the rule it was read with');
        $this->assertSame($run['interpretation'], $old['interpretation']);
        $this->assertSame(array_column($run['steps'], 'plain'), array_column($old['steps'], 'plain'));
        $current = collect($this->api($token, 'POST', 'questions/readings', ['question' => array_replace_recursive($question, ['period' => ['reading' => null]])])->json('data.readings'))->firstWhere('reading', 'active_any');
        $this->assertSame('data_cadastro ≤ 31/12/2025 e (data_desligamento vazio ou data_desligamento > 01/01/2025)', $current['criteria']['rule'], 'the current rule is shown apart, not over the old one');
    }

    public function test_an_old_run_shows_the_step_text_it_recorded_instead_of_regenerating_it(): void
    {
        [$token, $datasets, $kitchens] = $this->cadastro();
        [, $run] = $this->trace($token, $this->beneficiariesQuestion($datasets, $kitchens, 'started'));

        $snapshot = json_decode(DB::table('runs')->where('id', $run['id'])->value('recipe_snapshot'), true);
        $snapshot['steps'][0]['plain']['headline'] = 'Texto gravado na época';
        DB::table('runs')->where('id', $run['id'])->update(['recipe_snapshot' => json_encode($snapshot)]);

        $reopened = $this->api($token, 'GET', "runs/{$run['id']}")->assertOk()->json('data');
        $this->assertSame('Texto gravado na época', $reopened['steps'][0]['plain']['headline']);
        $this->assertSame($run['totals'], $reopened['totals']);
    }

    public function test_a_single_kitchen_is_filtered_through_the_relation_and_matches_an_independent_count(): void
    {
        [$token, $datasets, $kitchens] = $this->cadastro();
        $question = $this->beneficiariesQuestion($datasets, $kitchens, 'active_at_end', '0101');

        $answer = $this->api($token, 'POST', 'questions/preview', ['question' => $question])->assertOk()->json('data');
        $steps = $answer['recipe']['steps'];
        $this->assertSame(['vigencia', 'ligacao_1', 'recorte', 'resposta'], array_column($steps, 'id'));
        $this->assertSame('inner', $steps[1]['join_type']);
        $this->assertSame([], $steps[3]['group_by']);

        $expected = $this->rows($datasets['beneficiarios'])
            ->filter(fn (array $r) => $r['cozinha_id'] === '0101' && $r['data_cadastro'] <= '2025-12-31' && ($r['data_desligamento'] === null || $r['data_desligamento'] >= '2025-12-31'));
        $this->assertCount(1, $answer['preview']['results']);
        $this->assertSame($expected->pluck('id')->unique()->count(), $answer['preview']['totals']['values']['resposta']);

        [, $run] = $this->trace($token, $question);
        $this->assertSame(1, $run['result_count']);
        $detail = $this->api($token, 'GET', "runs/{$run['id']}/results/1")->assertOk()->json('data');
        $this->assertSame('todos os registros', $detail['related_exclusions']['group']);
        $excludedAtFilter = collect($detail['related_exclusions']['matching'])->sum('count');
        $this->assertSame(array_sum(array_column($run['steps'], 'excluded_count')), $excludedAtFilter);

        $statuses = collect([1, 2])
            ->flatMap(fn (int $page) => $this->api($token, 'GET', "runs/{$run['id']}/results/1/contributors?input=0&per_page=100&page={$page}")->assertOk()->json('data'))
            ->countBy(fn (array $c) => $c['measure_values'][0]['status']);
        $this->assertSame($expected->count(), $statuses->sum());
        $this->assertSame($expected->pluck('id')->unique()->count(), $statuses['counted']);
        $this->api($token, 'GET', "runs/{$run['id']}/exclusions?result=1&per_page=5")->assertOk();
    }

    public function test_the_same_question_reuses_its_recipe_and_a_different_one_gets_its_own(): void
    {
        [$token, $datasets, $kitchens] = $this->cadastro();
        $question = $this->beneficiariesQuestion($datasets, $kitchens, 'started');
        $recipes = DB::table('recipes')->count();

        [$first] = $this->trace($token, $question, 'Primeira');
        [$second] = $this->trace($token, $question, 'Segunda');
        [$other] = $this->trace($token, $this->beneficiariesQuestion($datasets, $kitchens, 'active_at_end'));

        $this->assertSame($first['recipe_id'], $second['recipe_id']);
        $this->assertSame($first['question_key'], $second['question_key']);
        $this->assertNotSame($first['recipe_id'], $other['recipe_id']);
        $this->assertSame($recipes + 2, DB::table('recipes')->count());
        $this->assertSame(2, DB::table('runs')->where('recipe_id', $first['recipe_id'])->count());
        $this->assertSame('Segunda', $this->api($token, 'GET', "recipes/{$first['recipe_id']}")->json('data.name'));
    }

    public function test_an_unread_period_shows_three_readings_with_their_numbers_and_exact_criteria(): void
    {
        [$token, $datasets, $kitchens] = $this->cadastro();
        $question = $this->beneficiariesQuestion($datasets, $kitchens, null, '0101');

        $answer = $this->api($token, 'POST', 'questions/preview', ['question' => $question])->assertOk()->json('data');
        $this->assertTrue($answer['needs_reading']);
        $this->assertNull($answer['preview']);
        $this->api($token, 'POST', 'questions/trace', ['question' => $question])->assertStatus(422)->assertJsonPath('code', 'question.reading_required');

        $readings = $this->api($token, 'POST', 'questions/readings', ['question' => $question])->assertOk()->json('data');
        $this->assertSame('data_cadastro', $readings['declaration']['start_column']);
        $this->assertSame(['started', 'active_any', 'active_at_end'], array_column($readings['readings'], 'reading'));

        foreach ($readings['readings'] as $reading) {
            $single = $this->api($token, 'POST', 'questions/preview', ['question' => $this->beneficiariesQuestion($datasets, $kitchens, $reading['reading'], '0101')])->json('data');
            $this->assertTrue($reading['computed']);
            $this->assertSame($single['preview']['totals']['values']['resposta'], $reading['value'], $reading['reading']);
            $this->assertSame($single['question_key'], $reading['question_key']);
            $this->assertStringContainsString('data_cadastro', $reading['criteria']['rule']);
        }

        $byReading = collect($readings['readings'])->keyBy('reading');
        $this->assertSame('data_cadastro ≤ 31/12/2025 e (data_desligamento vazio ou data_desligamento ≥ 31/12/2025)', $byReading['active_at_end']['criteria']['rule']);
        $this->assertSame('01/01/2025 ≤ data_cadastro ≤ 31/12/2025', $byReading['started']['criteria']['rule']);
        $this->assertGreaterThan(0, $byReading['active_any']['excluded']['out']);
    }

    public function test_readings_wait_for_the_validity_declaration_instead_of_guessing(): void
    {
        [, $token] = $this->workspace(true, 'cadastro');
        $datasets = $this->datasets($token);
        $question = [
            'base_dataset_id' => $datasets['beneficiarios']['id'],
            'measure' => ['function' => 'count'],
            'period' => ['kind' => 'validity', 'reading' => null, 'from' => '2025-01-01', 'to' => '2025-12-31'],
            'dimension' => null,
        ];

        $readings = $this->api($token, 'POST', 'questions/readings', ['question' => $question])->assertOk()->json('data');
        $this->assertNull($readings['declaration']);
        foreach ($readings['readings'] as $reading) {
            $this->assertSame([false, 'blocked', null, null], [$reading['computed'], $reading['reason'], $reading['value'], $reading['criteria']]);
            $this->assertSame(['validity.undeclared'], array_column($reading['pending'], 'code'));
        }
    }

    public function test_an_ungrouped_question_has_one_answer_with_its_whole_lineage(): void
    {
        [, $token] = $this->workspace();
        $ids = $this->demoIds($token);
        $question = [
            'base_dataset_id' => $ids['refeicoes']['id'],
            'measure' => ['function' => 'sum', 'column' => 'quantidade'],
            'period' => ['kind' => 'date', 'column' => 'data', 'from' => '2026-09-01', 'to' => '2026-09-30'],
            'dimension' => null,
        ];

        $answer = $this->api($token, 'POST', 'questions/preview', ['question' => $question])->assertOk()->json('data');
        $this->assertSame(['periodo', 'resposta'], array_column($answer['recipe']['steps'], 'id'));
        $this->assertSame('Soma quantidade em todas as linhas e conta as linhas', $answer['preview']['steps'][1]['plain']['headline']);

        $september = $this->rows($ids['refeicoes'])->filter(fn (array $r) => str_starts_with($r['data'], '2026-09'));
        $this->assertEquals(['resposta' => (string) $september->sum(fn (array $r) => (int) $r['quantidade']), 'registros' => $september->count()], $answer['preview']['results'][0]['values']);

        [, $run] = $this->trace($token, $question);
        $this->assertSame(1, $run['result_count']);
        $flows = $this->api($token, 'GET', "runs/{$run['id']}/flows")->assertOk()->json('data');
        $this->assertSame($september->count(), $flows['base_contributors']);
        $exclusions = $this->api($token, 'GET', "runs/{$run['id']}/exclusions?result=1")->assertOk()->json('meta');
        $this->assertSame(118 - $september->count(), $exclusions['total']);
    }

    public function test_questions_are_validated_before_they_reach_the_engine(): void
    {
        [$token, $datasets, $kitchens] = $this->cadastro();
        $base = ['base_dataset_id' => $datasets['beneficiarios']['id'], 'measure' => ['function' => 'count'], 'period' => null, 'dimension' => null];
        $attending = $this->relation($token, 'atendimentos.cozinha_id', 'cozinhas.id');

        $cases = [
            'question.measure_not_numeric' => ['measure' => ['function' => 'sum', 'column' => 'data_cadastro']],
            'question.measure_column_unknown' => ['measure' => ['function' => 'count_distinct', 'column' => 'nao_existe']],
            'question.period_column' => ['period' => ['kind' => 'date', 'column' => 'nome', 'from' => '2025-01-01', 'to' => '2025-12-31']],
            'question.period_dates' => ['period' => ['kind' => 'date', 'column' => 'data_cadastro', 'from' => '2025-12-31', 'to' => '2025-01-01']],
            'question.path_broken' => ['dimension' => ['relationships' => [$attending['id']], 'column' => 'id', 'label_column' => null, 'value' => null]],
            'question.label_requires_key' => ['dimension' => ['relationships' => [], 'column' => 'cozinha_id', 'label_column' => 'nome', 'value' => null]],
        ];

        foreach ($cases as $code => $patch) {
            $this->api($token, 'POST', 'questions/preview', ['question' => array_merge($base, $patch)])
                ->assertStatus(422)
                ->assertJsonPath('code', 'question.invalid')
                ->assertJsonPath('details.issues.0.code', $code);
        }
    }

    public function test_pending_decisions_keep_the_answer_as_a_preview_and_nothing_is_saved(): void
    {
        [, $token] = $this->workspace(true, 'cadastro');
        $datasets = $this->datasets($token);
        $people = $this->relation($token, 'atendimentos.beneficiario_id', 'beneficiarios.id');
        $kitchens = $this->relation($token, 'atendimentos.cozinha_id', 'cozinhas.id');
        $recipes = DB::table('recipes')->count();

        $byKitchen = [
            'base_dataset_id' => $datasets['atendimentos']['id'],
            'measure' => ['function' => 'count'],
            'period' => ['kind' => 'date', 'column' => 'data', 'from' => '2025-01-01', 'to' => '2025-12-31'],
            'dimension' => ['relationships' => [$kitchens['id']], 'column' => 'id', 'label_column' => 'nome', 'value' => null],
        ];
        $preview = $this->api($token, 'POST', 'questions/preview', ['question' => $byKitchen])->json('data.preview');
        $this->assertTrue($preview['computed']);
        $this->assertSame(['join.relationship_unconfirmed'], array_column($preview['pending'], 'code'));
        $this->api($token, 'POST', 'questions/trace', ['question' => $byKitchen])->assertStatus(422)->assertJsonPath('code', 'recipe.not_runnable');

        $throughPeople = array_merge($byKitchen, ['dimension' => ['relationships' => [$people['id']], 'column' => 'cozinha_id', 'label_column' => null, 'value' => null]]);
        $blocked = $this->api($token, 'POST', 'questions/preview', ['question' => $throughPeople])->json('data.preview');
        $this->assertSame([false, 'blocked'], [$blocked['computed'], $blocked['reason']]);
        $this->assertSame($recipes, DB::table('recipes')->count());
    }
}
