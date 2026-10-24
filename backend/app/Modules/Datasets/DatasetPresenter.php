<?php

namespace App\Modules\Datasets;

final class DatasetPresenter
{
    public static function summary(Dataset $dataset): array
    {
        $latest = $dataset->latestVersion;

        return [
            'id' => $dataset->id,
            'key' => $dataset->key,
            'name' => $dataset->name,
            'origin' => $dataset->origin,
            'is_synthetic' => $dataset->is_synthetic,
            'created_at' => $dataset->created_at?->toIso8601String(),
            'updated_at' => $dataset->updated_at?->toIso8601String(),
            'latest_version' => $latest ? self::versionSummary($latest) : null,
        ];
    }

    public static function detail(Dataset $dataset): array
    {
        return self::summary($dataset) + [
            'versions' => $dataset->versions->map(fn (DatasetVersion $version) => self::versionSummary($version))->all(),
            'columns' => $dataset->latestVersion?->columns->map(fn (DatasetColumn $column) => self::column($column))->all() ?? [],
        ];
    }

    public static function versionSummary(DatasetVersion $version): array
    {
        return [
            'id' => $version->id,
            'dataset_id' => $version->dataset_id,
            'number' => $version->number,
            'source_filename' => $version->source_filename,
            'row_count' => $version->row_count,
            'column_count' => $version->column_count,
            'created_at' => $version->created_at?->toIso8601String(),
        ];
    }

    public static function version(DatasetVersion $version): array
    {
        return self::versionSummary($version) + [
            'checksum' => $version->checksum,
            'size_bytes' => $version->size_bytes,
            'encoding' => $version->encoding,
            'delimiter' => $version->delimiter,
            'import_report' => $version->import_report,
            'dataset' => [
                'id' => $version->dataset->id,
                'key' => $version->dataset->key,
                'name' => $version->dataset->name,
                'is_synthetic' => $version->dataset->is_synthetic,
            ],
            'columns' => $version->columns->map(fn (DatasetColumn $column) => self::column($column))->all(),
        ];
    }

    public static function column(DatasetColumn $column): array
    {
        return [
            'key' => $column->key,
            'label' => $column->label,
            'position' => $column->position,
            'type' => $column->inferred_type,
            'profile' => $column->profile,
        ];
    }

    public static function row(object $row): array
    {
        return [
            'id' => (int) $row->id,
            'row_number' => (int) $row->row_number,
            'line_number' => (int) $row->line_number,
            'values' => is_string($row->values) ? json_decode($row->values, true) : $row->values,
        ];
    }
}
