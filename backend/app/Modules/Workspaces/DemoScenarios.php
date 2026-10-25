<?php

namespace App\Modules\Workspaces;

final class DemoScenarios
{
    public const DEFAULT = 'refeicoes';

    /**
     * @return array<string, array{label: string, description: string, datasets: list<array{file: string, key: string, name: string}>}>
     */
    public static function all(): array
    {
        return [
            'refeicoes' => [
                'label' => 'Refeições',
                'description' => 'Cozinhas e refeições servidas, com a receita de refeições de setembro por município.',
                'datasets' => [
                    ['file' => 'cozinhas.csv', 'key' => 'cozinhas', 'name' => 'Cozinhas'],
                    ['file' => 'refeicoes.csv', 'key' => 'refeicoes', 'name' => 'Refeições'],
                ],
            ],
            'cadastro' => [
                'label' => 'Cadastro e atendimentos',
                'description' => 'Cozinhas, cadastro de beneficiários com datas de cadastro e desligamento, e atendimentos de 2025.',
                'datasets' => [
                    ['file' => 'cadastro/cozinhas.csv', 'key' => 'cozinhas', 'name' => 'Cozinhas'],
                    ['file' => 'cadastro/beneficiarios.csv', 'key' => 'beneficiarios', 'name' => 'Beneficiários'],
                    ['file' => 'cadastro/atendimentos.csv', 'key' => 'atendimentos', 'name' => 'Atendimentos'],
                ],
            ],
        ];
    }

    public static function exists(string $scenario): bool
    {
        return array_key_exists($scenario, self::all());
    }

    /**
     * @return list<array{key: string, label: string, description: string}>
     */
    public static function summaries(): array
    {
        $summaries = [];
        foreach (self::all() as $key => $scenario) {
            $summaries[] = ['key' => $key, 'label' => $scenario['label'], 'description' => $scenario['description']];
        }

        return $summaries;
    }

    /**
     * @return array{key: string, label: string}|null
     */
    public static function summary(?string $scenario): ?array
    {
        if ($scenario === null || ! self::exists($scenario)) {
            return null;
        }

        return ['key' => $scenario, 'label' => self::all()[$scenario]['label']];
    }
}
