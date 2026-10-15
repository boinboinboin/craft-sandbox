<?php

namespace modules\elo\services;

use Craft;
use yii\base\Component;

/**
 * Reads the rating files written by elo/rate.mjs:
 *
 * - elo/data/ratings.json: every player's current rating and the strongest clubs per pool ("men", "women")
 * - elo/data/history/<id>.json: one player's rating and national rank at the end of every week, per pool
 * - elo/data/rank-counts.json: the number of ranked players at the end of every week, per pool
 * - elo/data/matches/<id>.json: one player's last matches and biggest wins and losses, per pool
 * - elo/data/club-history/<NBF club id>.json: a club's strength and rank at the end of every week, per pool
 *
 * ratings.json is decoded once per request and kept in memory.
 */
class EloService extends Component
{
    public const POOLS = [
        'men' => "Men's singles",
        'women' => "Women's singles",
        'mensDoubles' => "Men's doubles",
        'womensDoubles' => "Women's doubles",
        'mixedDoubles' => 'Mixed doubles',
    ];

    /**
     * Order of a player's pools on their page: their own gender's disciplines first, so women's
     * singles leads for women even if they have also played men's singles.
     */
    private const POOL_ORDER = [
        'M' => ['men', 'mensDoubles', 'mixedDoubles', 'women', 'womensDoubles'],
        'K' => ['women', 'womensDoubles', 'mixedDoubles', 'men', 'mensDoubles'],
    ];

    private ?array $ratings = null;
    private ?array $rankCounts = null;

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
     * With $gender ("M" or "K"), only players of that gender: mixed doubles ranks men and women
     * separately.
     *
     * @return array<int, array>
     */
    public function getRankings(string $pool, bool $includeInactive = false, ?string $gender = null): array
    {
        $players = $this->ratings()['pools'][$pool] ?? [];
        if ($gender !== null) {
            $players = array_values(array_filter($players, fn(array $p) => ($p['gender'] ?? null) === $gender));
        }
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
     * How a club's strength in a pool is calculated: `slots` (players or pairs counted), `pairs`
     * (null, "doubles" or "mixed") and the `weights` of the slots, best first.
     *
     * @return array{slots: int, pairs: ?string, weights: float[]}|null
     */
    public function getClubStrengthRule(string $pool): ?array
    {
        return $this->ratings()['clubStrength'][$pool] ?? null;
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
     * A club's strength history per pool: `from` (Monday of the first week), and per week its
     * `strength`, `rank` and the number of ranked `clubs` (null in weeks it had too few players).
     *
     * @return array<string, array{from: string, strength: array, rank: array, clubs: array}>
     */
    public function getClubHistory(int $nbfClubId): array
    {
        return $this->read("club-history/$nbfClubId.json")['pools'] ?? [];
    }

    /**
     * Adds `rankCounts` to a player's history in a pool: the number of ranked players in each week
     * of their `ranks` (in mixed doubles, of their own gender), for "#12 of 1,950".
     */
    private function withRankCounts(?array $history, string $pool, ?string $gender): ?array
    {
        if (!$history || empty($history['ranks'])) {
            return $history;
        }
        $this->rankCounts ??= $this->read('rank-counts.json');
        $counts = $this->rankCounts['pools'][$pool] ?? [];
        if ($pool === 'mixedDoubles') {
            $counts = $counts[$gender] ?? [];
        }
        $offset = (int)round((strtotime($history['from']) - strtotime($this->rankCounts['from'] ?? $history['from'])) / (7 * 86400));
        $history['rankCounts'] = array_slice($counts, $offset, count($history['ranks']));

        return $history;
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
                $player ??= ['id' => $id, 'pools' => []];
                $player['pools'][$pool] = $p + [
                    'label' => self::POOLS[$pool],
                    'history' => $this->withRankCounts($history[$pool] ?? null, $pool, $p['gender'] ?? null),
                    'matchLog' => $matches[$pool] ?? null,
                ];
                break;
            }
        }

        if ($player !== null) {
            $gender = current($player['pools'])['gender'] ?? 'M';
            $order = array_flip(self::POOL_ORDER[$gender] ?? self::POOL_ORDER['M']);
            uksort($player['pools'], fn(string $a, string $b) => $order[$a] <=> $order[$b]);
            // Name and club from the first pool shown
            $player['name'] = current($player['pools'])['name'];
            $player['club'] = current($player['pools'])['club'];
        }

        return $player;
    }
}
