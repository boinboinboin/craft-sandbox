<?php

namespace modules\elo\services;

use Craft;
use yii\base\Component;

/**
 * Reads the rating files written by elo/rate.mjs:
 *
 * - elo/data/ratings.json: every player's current rating per pool ("men", "women")
 * - elo/data/history/<id>.json: one player's rating at the end of every week, per pool
 *
 * ratings.json is decoded once per request and kept in memory.
 */
class EloService extends Component
{
    public const POOLS = ['men' => "Men's singles", 'women' => "Women's singles"];

    private ?array $ratings = null;

    private function read(string $file): array
    {
        $path = Craft::getAlias("@root/elo/data/$file");
        if (!is_file($path)) {
            return [];
        }

        return json_decode(file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);
    }

    private function ratings(): array
    {
        return $this->ratings ??= $this->read('ratings.json');
    }

    /**
     * When the ratings were last calculated, or null if there are none yet.
     */
    public function getGeneratedAt(): ?\DateTime
    {
        $generatedAt = $this->ratings()['generatedAt'] ?? null;

        return $generatedAt ? new \DateTime($generatedAt) : null;
    }

    /**
     * Ranked (active) players in a pool, best first.
     *
     * @return array<int, array>
     */
    public function getRankings(string $pool): array
    {
        $players = $this->ratings()['pools'][$pool] ?? [];

        return array_values(array_filter($players, fn(array $p) => $p['rank'] !== null));
    }

    /**
     * One player across the pools they have played in, with their weekly rating history.
     *
     * @return array{id: int, name: string, club: ?string, pools: array<string, array>}|null
     */
    public function getPlayer(int $id): ?array
    {
        $player = null;
        $history = $this->read("history/$id.json");
        foreach (array_keys(self::POOLS) as $pool) {
            foreach ($this->ratings()['pools'][$pool] ?? [] as $p) {
                if ($p['id'] !== $id) {
                    continue;
                }
                // Keep the name and club from the pool played most recently.
                if ($player === null || $p['lastPlayed'] > $player['lastPlayed']) {
                    $player = ['id' => $id, 'name' => $p['name'], 'club' => $p['club'], 'lastPlayed' => $p['lastPlayed'], 'pools' => $player['pools'] ?? []];
                }
                $player['pools'][$pool] = $p + [
                    'label' => self::POOLS[$pool],
                    'history' => $history[$pool] ?? null,
                ];
                break;
            }
        }

        return $player;
    }
}
