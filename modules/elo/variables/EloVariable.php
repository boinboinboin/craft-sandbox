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

    public function rankings(string $pool): array
    {
        return Module::getInstance()->elo->getRankings($pool);
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
