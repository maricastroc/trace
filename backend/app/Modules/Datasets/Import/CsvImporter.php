<?php

namespace App\Modules\Datasets\Import;

use App\Modules\Datasets\Dataset;
use App\Modules\Datasets\DatasetVersion;
use App\Modules\Support\Identifier;
use App\Modules\Support\UploadLimit;
use App\Modules\Workspaces\Workspace;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Throwable;

final class CsvImporter
{
    public function __construct(private readonly ColumnProfiler $profiler) {}

    public function preview(string $path, string $filename): array
    {
        self::allowMemoryForParsing();
        $parsed = CsvReader::fromConfig()->readFile($path);
        $previewRows = array_slice($parsed->records, 0, (int) config('trace.limits.preview_rows'));

        return [
            'filename' => $filename,
            'suggested_key' => Identifier::fromLabel(pathinfo($filename, PATHINFO_FILENAME), 'dataset'),
            'encoding' => $parsed->encoding,
            'delimiter' => $parsed->delimiter,
            'row_count' => $parsed->rowCount(),
            'column_count' => count($parsed->keys),
            'size_bytes' => $parsed->sizeBytes,
            'checksum' => $parsed->checksum,
            'warnings' => $parsed->warnings,
            'columns' => $this->describeColumns($parsed),
            'rows' => array_map(fn (array $record) => [
                'line_number' => $record['line'],
                'values' => $parsed->associativeValues($record),
            ], $previewRows),
        ];
    }

    public function importFile(
        Workspace $workspace,
        string $path,
        string $filename,
        ?Dataset $dataset = null,
        array $attributes = [],
    ): DatasetVersion {
        self::allowMemoryForParsing();
        $raw = (string) file_get_contents($path);
        $parsed = CsvReader::fromConfig()->readFile($path);

        return $this->persist($workspace, $parsed, $raw, $filename, $dataset, $attributes);
    }

    private function persist(
        Workspace $workspace,
        ParsedCsv $parsed,
        string $raw,
        string $filename,
        ?Dataset $dataset,
        array $attributes,
    ): DatasetVersion {
        $columns = $this->describeColumns($parsed);
        $stored = null;

        try {
            return $this->store($workspace, $parsed, $raw, $filename, $dataset, $attributes, $columns, $stored);
        } catch (Throwable $failure) {
            if ($stored !== null) {
                Storage::disk('local')->delete($stored);
                if (Storage::disk('local')->allFiles(dirname($stored)) === []) {
                    Storage::disk('local')->deleteDirectory(dirname($stored));
                }
            }

            throw $failure;
        }
    }

    private function store(
        Workspace $workspace,
        ParsedCsv $parsed,
        string $raw,
        string $filename,
        ?Dataset $dataset,
        array $attributes,
        array $columns,
        ?string &$stored,
    ): DatasetVersion {
        return DB::transaction(function () use ($workspace, $parsed, $raw, $filename, $dataset, $attributes, $columns, &$stored) {
            $dataset ??= $this->createDataset($workspace, $filename, $attributes);
            $locked = Dataset::query()->whereKey($dataset->id)->lockForUpdate()->firstOrFail();
            $previous = $locked->latestVersion()->with('columns')->first();
            $number = ($previous?->number ?? 0) + 1;

            $path = sprintf('datasets/%s/v%d-%s.csv', $locked->id, $number, substr($parsed->checksum, 0, 12));
            Storage::disk('local')->put($path, $raw);
            $stored = $path;

            $version = DatasetVersion::create([
                'dataset_id' => $locked->id,
                'number' => $number,
                'source_filename' => mb_substr($filename, 0, 255),
                'source_path' => $path,
                'checksum' => $parsed->checksum,
                'size_bytes' => $parsed->sizeBytes,
                'encoding' => $parsed->encoding,
                'delimiter' => $parsed->delimiter,
                'row_count' => $parsed->rowCount(),
                'column_count' => count($parsed->keys),
                'import_report' => $this->report($parsed, $previous),
            ]);

            foreach ($columns as $column) {
                $version->columns()->create([
                    'position' => $column['position'],
                    'key' => $column['key'],
                    'label' => $column['label'],
                    'inferred_type' => $column['type'],
                    'profile' => $column['profile'],
                ]);
            }

            $this->insertRows($version, $parsed);
            $locked->touch();

            return $version->load('columns', 'dataset');
        });
    }

    private static function allowMemoryForParsing(): void
    {
        $current = (string) ini_get('memory_limit');
        if ($current !== '-1' && UploadLimit::bytes($current) < 512 * 1024 ** 2) {
            ini_set('memory_limit', '512M');
        }
    }

    private function createDataset(Workspace $workspace, string $filename, array $attributes): Dataset
    {
        $base = $attributes['key'] ?? Identifier::fromLabel(pathinfo($filename, PATHINFO_FILENAME), 'dataset');
        $taken = $workspace->datasets()->pluck('key')->all();

        return $workspace->datasets()->create([
            'key' => Identifier::unique($base, $taken),
            'name' => $attributes['name'] ?? pathinfo($filename, PATHINFO_FILENAME),
            'origin' => $attributes['origin'] ?? 'upload',
            'is_synthetic' => $attributes['is_synthetic'] ?? false,
        ]);
    }

    private function describeColumns(ParsedCsv $parsed): array
    {
        $columns = [];
        foreach ($parsed->keys as $index => $key) {
            $profile = $this->profiler->profile($parsed->columnValues($index));
            $columns[] = [
                'position' => $index + 1,
                'key' => $key,
                'label' => $parsed->labels[$index],
                'type' => $profile['type'],
                'profile' => $profile['profile'],
            ];
        }

        return $columns;
    }

    private function report(ParsedCsv $parsed, ?DatasetVersion $previous): array
    {
        $report = ['warnings' => $parsed->warnings];

        if ($previous !== null) {
            $before = $previous->columnKeys();
            $report['compared_to_version'] = $previous->number;
            $report['columns_added'] = array_values(array_diff($parsed->keys, $before));
            $report['columns_removed'] = array_values(array_diff($before, $parsed->keys));
            $report['row_delta'] = $parsed->rowCount() - $previous->row_count;
            $report['identical_content'] = $previous->checksum === $parsed->checksum;
        }

        return $report;
    }

    private function insertRows(DatasetVersion $version, ParsedCsv $parsed): void
    {
        $batch = [];
        foreach ($parsed->records as $index => $record) {
            $batch[] = [
                'dataset_version_id' => $version->id,
                'row_number' => $index + 1,
                'line_number' => $record['line'],
                'values' => json_encode($parsed->associativeValues($record), JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
            ];

            if (count($batch) === 1000) {
                DB::table('source_rows')->insert($batch);
                $batch = [];
            }
        }

        if ($batch !== []) {
            DB::table('source_rows')->insert($batch);
        }
    }
}
