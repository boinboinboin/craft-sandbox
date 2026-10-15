<?php

namespace modules\elo\variables;

use modules\elo\Module;
use modules\elo\services\EloService;

/**
 * `craft.elo` in templates.
 */
class EloVariable
{
    public function pools(): array
    {
        return EloService::POOLS;
    }

    public function rankings(string $pool, bool $includeInactive = false, ?string $gender = null): array
    {
        return Module::getInstance()->elo->getRankings($pool, $includeInactive, $gender);
    }

    public function clubs(string $pool): array
    {
        return Module::getInstance()->elo->getClubs($pool);
    }

    public function clubStrengthRule(string $pool): ?array
    {
        return Module::getInstance()->elo->getClubStrengthRule($pool);
    }

    public function clubPlayers(string $club, string $pool): array
    {
        return Module::getInstance()->elo->getClubPlayers($club, $pool);
    }

    public function clubHistory(int $nbfClubId): array
    {
        return Module::getInstance()->elo->getClubHistory($nbfClubId);
    }

    public function eliteserien(): array
    {
        return Module::getInstance()->elo->getEliteserien();
    }

    public function player(int $id): ?array
    {
        return Module::getInstance()->elo->getPlayer($id);
    }

    public function generatedAt(): ?\DateTime
    {
        return Module::getInstance()->elo->getGeneratedAt();
    }
}
