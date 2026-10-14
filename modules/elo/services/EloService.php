<?php

namespace modules\elo\services;

use Craft;
use yii\base\Component;

/**
 * Reads the rating files written by elo/rate.mjs:
 *
 * - elo/data/ratings.json: every player's current rating and the strongest clubs per pool ("men", "women")
 * - elo/data/history/<id>.json: one player's rating at the end of every week, per pool
 * - elo/data/matches/<id>.json: one player's last matches and biggest wins and losses, per pool
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
     * Ranked (active) players in a pool, best first. With $includeInactive, also players who
     * haven't played in the last 12 months (rank null), in rating order among the ranked ones.
     *
     * @return array<int, array>
     */
    public function getRankings(string $pool, bool $includeInactive = false): array
    {
        $players = $this->ratings()['pools'][$pool] ?? [];
        if ($includeInactive) {
            return $players;
        }

        return array_values(array_filter($players, fn(array $p) => $p['rank'] !== null));
    }

    /**
     * Clubs in a pool by the average rating of their best ranked players, strongest first.
     *
     * @return array<int, array>
     */
    public function getClubs(string $pool): array
    {
        return $this->ratings()['clubs'][$pool] ?? [];
    }

    /**
     * A club's ranked players in a pool (by the club shown for each player), best first.
     *
     * @return array<int, array>
     */
    public function getClubPlayers(string $club, string $pool): array
    {
        return array_values(array_filter($this->getRankings($pool), fn(array $p) => $p['club'] === $club));
    }

    /**
     * One player across the pools they have played in, with their weekly rating history and matches.
     *
     * @return array{id: int, name: string, club: ?string, pools: array<string, array>}|null
     */
    public function getPlayer(int $id): ?array
    {
        $player = null;
        $history = $this->read("history/$id.json");
        $matches = $this->read("matches/$id.json");
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
                    'matchLog' => $matches[$pool] ?? null,
                ];
                break;
            }
        }

        // Women's singles first for women (gender from the player register), even if they have
        // also played men's singles.
        if (isset($player['pools']['women']) && ($player['pools']['women']['gender'] ?? null) === 'K') {
            $player['pools'] = ['women' => $player['pools']['women']] + $player['pools'];
            $player['name'] = $player['pools']['women']['name'];
            $player['club'] = $player['pools']['women']['club'];
        }

        return $player;
    }
}
