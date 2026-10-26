<?php

namespace App\Modules\Comparisons;

use App\Modules\Runs\Engine\ExecutionOutcome;
use App\Modules\Runs\Engine\TupleStore;
use App\Modules\Runs\Run;
use Illuminate\Support\Facades\DB;

final class SideCollector
{
    public function fromOutcome(ExecutionOutcome $outcome, SideSource $plan): SideSet
    {
        $included = [];
        $excluded = [];
        foreach ($outcome->tuples->fate as $no => $fate) {
            $row = $outcome->tuples->sources[$no][0] ?? null;
            if ($row === null) {
                continue;
            }
            if ($fate === TupleStore::INCLUDED) {
                $included[$row] = true;
            } elseif ($fate === TupleStore::EXCLUDED && ! isset($excluded[$row])) {
                $excluded[$row] = [(int) $outcome->tuples->endStep[$no], (string) $outcome->tuples->exclusionCode[$no]];
            }
        }

        return $this->build($plan, $included, $excluded);
    }

    public function fromRun(Run $run, SideSource $plan): SideSet
    {
        $included = [];
        foreach (DB::select(
            'SELECT DISTINCT s.source_row_id FROM run_tuples t
             JOIN run_tuple_sources s ON s.run_id = t.run_id AND s.tuple_no = t.tuple_no AND s.input_position = 0
             WHERE t.run_id = ? AND t.result_no IS NOT NULL',
            [$run->id],
        ) as $row) {
            $included[(int) $row->source_row_id] = true;
        }

        $excluded = [];
        foreach (DB::select(
            "SELECT DISTINCT ON (s.source_row_id) s.source_row_id, t.end_step, t.exclusion_code FROM run_tuples t
             JOIN run_tuple_sources s ON s.run_id = t.run_id AND s.tuple_no = t.tuple_no AND s.input_position = 0
             WHERE t.run_id = ? AND t.fate = 'excluded'
             ORDER BY s.source_row_id, t.tuple_no",
            [$run->id],
        ) as $row) {
            $excluded[(int) $row->source_row_id] = [(int) $row->end_step, (string) $row->exclusion_code];
        }

        return $this->build($plan, $included, $excluded);
    }

    /**
     * @param  array<int, true>  $included
     * @param  array<int, array{0: int, 1: string}>  $excluded
     */
    private function build(SideSource $plan, array $included, array $excluded): SideSet
    {
        $select = ['id', '"values"->>? AS k'];
        $bindings = [$plan->key];
        if ($plan->validity !== null) {
            $select[] = '"values"->>? AS vs';
            $select[] = '"values"->>? AS ve';
            $bindings[] = $plan->validity['start_column'];
            $bindings[] = $plan->validity['end_column'] ?? '';
        }
        foreach ($plan->fields as $i => $column) {
            $select[] = "\"values\"->>? AS f{$i}";
            $bindings[] = $column;
        }
        $bindings[] = $plan->versionId;

        $identities = [];
        $empty = [];
        $outside = [];
        $validity = [];
        $fields = [];
        foreach (DB::cursor('SELECT '.implode(', ', $select).' FROM source_rows WHERE dataset_version_id = ? ORDER BY row_number', $bindings) as $row) {
            $id = (int) $row->id;
            $key = $row->k;

            if (isset($included[$id])) {
                if (IdentityRules::isEmpty($key)) {
                    $empty[] = $id;
                } else {
                    $identities[$key][] = $id;
                }
                if ($plan->validity !== null) {
                    $validity[$id] = [$row->vs, $plan->validity['end_column'] === null ? null : $row->ve];
                }
                foreach ($plan->fields as $i => $column) {
                    $fields[$id][$column] = $row->{"f{$i}"};
                }

                continue;
            }

            if (isset($excluded[$id]) && ! IdentityRules::isEmpty($key)) {
                $stepCode = $excluded[$id][0].'|'.$excluded[$id][1];
                $outside[$key][$stepCode] = ($outside[$key][$stepCode] ?? 0) + 1;
            }
        }

        return new SideSet($identities, $empty, $outside, count($included), $validity, $fields, $plan->basis);
    }
}
