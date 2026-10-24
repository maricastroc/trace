<?php

namespace App\Modules\Relationships;

final class NameHeuristics
{
    public static function evaluate(string $fromColumn, string $toDatasetKey, string $toColumn): array
    {
        $entityNames = self::singularForms($toDatasetKey);
        $candidates = [];

        foreach ($entityNames as $entity) {
            $candidates[] = "{$entity}_{$toColumn}";
            $candidates[] = "{$toColumn}_{$entity}";
            if ($toColumn === 'id') {
                $candidates[] = "id{$entity}";
                $candidates[] = "{$entity}id";
                $candidates[] = $entity;
            }
        }

        if ($toColumn !== 'id' && $fromColumn === $toColumn) {
            return [
                'matched' => true,
                'reason' => "As colunas têm o mesmo nome ({$fromColumn}).",
            ];
        }

        if (in_array($fromColumn, $candidates, true)) {
            return [
                'matched' => true,
                'reason' => "O nome {$fromColumn} sugere uma referência a {$toDatasetKey}.{$toColumn}.",
            ];
        }

        return ['matched' => false, 'reason' => 'Os nomes das colunas não indicam uma referência.'];
    }

    private static function singularForms(string $key): array
    {
        $forms = [$key];

        $rules = [
            '/oes$/' => 'ao',
            '/aes$/' => 'ao',
            '/ies$/' => 'y',
            '/is$/' => 'l',
            '/res$/' => 'r',
            '/zes$/' => 'z',
            '/ses$/' => 's',
            '/s$/' => '',
        ];

        foreach ($rules as $pattern => $replacement) {
            if (preg_match($pattern, $key) === 1) {
                $forms[] = (string) preg_replace($pattern, $replacement, $key);
            }
        }

        return array_values(array_unique($forms));
    }
}
