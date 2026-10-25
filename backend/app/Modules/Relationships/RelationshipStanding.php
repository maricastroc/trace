<?php

namespace App\Modules\Relationships;

final class RelationshipStanding
{
    public const SUGGESTED = 'suggested';

    public const CONFIRMED = 'confirmed';

    public const CAVEAT = 'caveat';

    public const REJECTED = 'rejected';

    public const REVIEW = 'review';

    /**
     * @return array{key: string, usable: bool, reason: string|null}
     */
    public static function of(Relationship $relationship): array
    {
        if ($relationship->status === Relationship::SUGGESTED) {
            return self::make(self::SUGGESTED, false);
        }

        if ($relationship->status === Relationship::REJECTED) {
            return self::make(self::REJECTED, false);
        }

        $relationship->loadMissing('fromDataset.latestVersion', 'toDataset.latestVersion.columns');
        $toVersion = $relationship->toDataset->latestVersion;
        $target = "{$relationship->toDataset->key}.{$relationship->to_column}";
        $column = $toVersion?->column($relationship->to_column);

        if ($column === null) {
            return self::make(self::REVIEW, false, "A coluna {$target} não existe na versão atual dos dados.");
        }

        if ($relationship->policy === Relationship::ACCEPT_MULTIPLICITY) {
            $sameVersions = $relationship->from_version_id === $relationship->fromDataset->latestVersion?->id
                && $relationship->to_version_id === $toVersion->id;

            return $sameVersions
                ? self::make(self::CAVEAT, true)
                : self::make(self::REVIEW, false, 'A multiplicidade foi aceita sobre versões anteriores dos dados. Revise a evidência atual e decida de novo.');
        }

        return ($column->profile['unique'] ?? false) === true
            ? self::make(self::CONFIRMED, true)
            : self::make(self::REVIEW, false, "Confirmada como N:1, mas {$target} tem valores repetidos na versão atual. Aceite a multiplicidade, corrija as colunas ou rejeite.");
    }

    /**
     * @return array{key: string, usable: bool, reason: string|null}
     */
    private static function make(string $key, bool $usable, ?string $reason = null): array
    {
        return ['key' => $key, 'usable' => $usable, 'reason' => $reason];
    }
}
