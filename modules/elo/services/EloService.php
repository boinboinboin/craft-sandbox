<?php

namespace modules\elo\services;

use Craft;
use craft\elements\Entry;
use craft\helpers\UrlHelper;
use yii\base\Component;

/**
 * Reads the rating files written by elo/rate.mjs:
 *
 * - elo/data/ratings.json: every player's current rating and the strongest clubs per pool ("men", "women")
 * - elo/data/history/<id>.json: one player's rating and national rank at the end of every week, per pool
 * - elo/data/rank-counts.json: the number of ranked players at the end of every week, per pool
 * - elo/data/matches/<id>.json: one player's last matches and biggest wins and losses, per pool
 * - elo/data/eliteserien.json: Eliteserien team strengths (elo/eliteserien.mjs)
 * - elo/data/club-history/<NBF club id>.json: a club's strength and rank at the end of every week, per pool
 * - elo/data/upsets.json: each week's biggest upsets (matches won with the lowest win chance)
 * - elo/data/eliteserien-<season>.json: an Eliteserien season in review (elo/eliteserien-review.mjs)
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

    /**
     * Rating difference scale of the expected score, as SCALE in elo/rules.mjs: a difference of
     * 300 points means a 91% win chance.
     */
    private const SCALE = 300;

    private ?array $ratings = null;
    private ?array $upsets = null;
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
     * Eliteserien team strengths (elo/eliteserien.mjs): teams with their best lineup, players and
     * strength, and the head-to-head chances between them. Empty if not calculated yet.
     */
    public function getEliteserien(): array
    {
        return $this->read('eliteserien.json');
    }

    /**
     * An Eliteserien season in review (elo/eliteserien-review.mjs): predicted against actual
     * results. `$season` is like "2025-26". Empty if not calculated.
     */
    public function getEliteserienReview(string $season): array
    {
        return preg_match('/^\d{4}-\d{2}$/', $season) ? $this->read("eliteserien-$season.json") : [];
    }

    /**
     * The seasons with a review, newest first, like ["2025-26", "2024-25"].
     *
     * @return string[]
     */
    public function getEliteserienReviewSeasons(): array
    {
        $files = glob(Craft::getAlias('@root/elo/data/eliteserien-[0-9][0-9][0-9][0-9]-[0-9][0-9].json')) ?: [];
        $seasons = array_map(fn($file) => substr(basename($file, '.json'), strlen('eliteserien-')), $files);
        rsort($seasons);
        return $seasons;
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

    /**
     * Players whose name contains every word of $query (accents and case ignored), for the player
     * pickers: ranked players first, then by number of matches.
     *
     * @return array<int, array{id: int, name: string, club: ?string}>
     */
    public function searchPlayers(string $query, int $limit = 10): array
    {
        $words = preg_split('/\s+/', $this->normalize($query), -1, PREG_SPLIT_NO_EMPTY);
        if (!$words) {
            return [];
        }
        $found = [];
        foreach ($this->ratings()['pools'] ?? [] as $players) {
            foreach ($players as $p) {
                $name = $this->normalize($p['name']);
                foreach ($words as $word) {
                    if (!str_contains($name, $word)) {
                        continue 2;
                    }
                }
                $entry = $found[$p['id']] ?? ['id' => $p['id'], 'name' => $p['name'], 'club' => $p['club'] ?? null, 'ranked' => false, 'matches' => 0, 'prefix' => str_starts_with($name, $words[0])];
                $entry['ranked'] = $entry['ranked'] || $p['rank'] !== null;
                $entry['matches'] += $p['matches'];
                $found[$p['id']] = $entry;
            }
        }
        usort($found, fn(array $a, array $b) => [$b['prefix'], $b['ranked'], $b['matches']] <=> [$a['prefix'], $a['ranked'], $a['matches']]);

        return array_map(fn(array $p) => ['id' => $p['id'], 'name' => $p['name'], 'club' => $p['club']], array_slice($found, 0, $limit));
    }

    /**
     * Each week's biggest upsets, newest week first: [{ week (Monday), matches: [{ day, pool,
     * poolLabel, event, winChance, winners, losers, score }] }], lowest win chance first. The newest
     * week is the current one if it has had matches, else the last week that did.
     *
     * @return array<int, array{week: string, matches: array}>
     */
    public function getUpsetWeeks(): array
    {
        $weeks = $this->upsets ??= $this->read('upsets.json')['weeks'] ?? [];
        foreach ($weeks as &$week) {
            foreach ($week['matches'] as &$m) {
                $m['poolLabel'] = self::POOLS[$m['pool']] ?? $m['pool'];
            }
        }

        return $weeks;
    }

    /**
     * The search bar on every Elo page: players (as searchPlayers), clubs (club entries by short or
     * full name) and the Eliteserien pages (this season's team strengths and each season in
     * review), each with the URL to go to. Every word of $query must match.
     *
     * @return array{players: array, clubs: array, eliteserien: array}
     */
    public function search(string $query): array
    {
        $words = preg_split('/\s+/', $this->normalize($query), -1, PREG_SPLIT_NO_EMPTY);
        if (!$words) {
            return ['players' => [], 'clubs' => [], 'eliteserien' => []];
        }
        $matches = function(string $text) use ($words): bool {
            $text = $this->normalize($text);
            foreach ($words as $word) {
                if (!str_contains($text, $word)) {
                    return false;
                }
            }
            return true;
        };

        $players = array_map(fn(array $p) => $p + ['url' => UrlHelper::siteUrl("elo/players/{$p['id']}")], $this->searchPlayers($query, 6));

        $clubs = [];
        foreach (Entry::find()->section('clubs')->with(['clubLogo'])->orderBy('title')->all() as $entry) {
            $fullName = (string)($entry->clubFullName ?? '');
            if (!$matches("$entry->title $fullName")) {
                continue;
            }
            $logo = $entry->clubLogo[0] ?? null;
            $clubs[] = [
                'name' => $entry->title,
                'detail' => $fullName !== $entry->title ? $fullName : (string)($entry->clubRegion ?? ''),
                'url' => $entry->url,
                'logo' => $logo?->url,
            ];
            if (count($clubs) === 6) {
                break;
            }
        }

        $pages = [];
        $current = $this->getEliteserien()['season'] ?? null;
        if ($current) {
            $pages[] = ['name' => "Eliteserien $current", 'detail' => 'Team strengths', 'url' => UrlHelper::siteUrl('elo/eliteserien'), 'terms' => 'team strengths lineups'];
        }
        foreach ($this->getEliteserienReviewSeasons() as $season) {
            $label = substr($season, 0, 4) . '/' . (substr($season, 0, 4) + 1);
            $pages[] = ['name' => "Eliteserien $label", 'detail' => 'Season in review', 'url' => UrlHelper::siteUrl("elo/eliteserien/$season"), 'terms' => "$season review results"];
        }
        $eliteserien = array_values(array_filter($pages, fn(array $page) => $matches("eliteserie {$page['name']} {$page['terms']}")));

        return [
            'players' => $players,
            'clubs' => $clubs,
            'eliteserien' => array_map(fn(array $page) => array_diff_key($page, ['terms' => true]), $eliteserien),
        ];
    }

    private function normalize(string $text): string
    {
        $text = mb_strtolower($text);
        $text = strtr($text, ['æ' => 'ae', 'ø' => 'o', 'å' => 'a']);

        return preg_replace('/\p{Mn}/u', '', \Normalizer::normalize($text, \Normalizer::FORM_D));
    }

    /**
     * Two players head to head: both players (as getPlayer), their matches against each other and
     * together as partners (from player A's match logs, newest first, each with its `pool` and
     * `poolLabel`), the record from A's side, and per discipline both play: the current ratings
     * and A's chance of beating B now (in doubles, with equally rated partners).
     *
     * @return array{a: array, b: array, meetings: array, together: array, record: array, pools: array}|null
     */
    public function getHeadToHead(int $a, int $b): ?array
    {
        $playerA = $this->getPlayer($a);
        $playerB = $this->getPlayer($b);
        if (!$playerA || !$playerB || $a === $b) {
            return null;
        }

        $meetings = [];
        $together = [];
        foreach ($playerA['pools'] as $pool => $p) {
            foreach ($p['matchLog']['all'] ?? [] as $m) {
                $m += ['pool' => $pool, 'poolLabel' => $p['label']] + $this->points($m['score'] ?? '');
                if (in_array($b, array_column($m['opponents'], 'id'), true)) {
                    $meetings[] = $m;
                } elseif (($m['partner']['id'] ?? null) === $b) {
                    $together[] = $m;
                }
            }
        }
        $newestFirst = fn(array $x, array $y) => strcmp($y['day'], $x['day']);
        usort($meetings, $newestFirst);
        usort($together, $newestFirst);

        $pools = [];
        foreach ($playerA['pools'] as $pool => $p) {
            $q = $playerB['pools'][$pool] ?? null;
            if (!$q) {
                continue;
            }
            $pools[$pool] = [
                'label' => $p['label'],
                'a' => $p,
                'b' => $q,
                'chance' => 1 / (1 + 10 ** (($q['rating'] - $p['rating']) / self::SCALE)),
                'record' => $this->record(array_filter($meetings, fn(array $m) => $m['pool'] === $pool)),
                'margins' => $this->margins(array_filter($meetings, fn(array $m) => $m['pool'] === $pool)),
            ];
        }

        return [
            'a' => $playerA,
            'b' => $playerB,
            'meetings' => $meetings,
            'together' => $together,
            'record' => $this->record($meetings),
            'margins' => $this->margins($meetings),
            'togetherRecord' => $this->record($together),
            'pools' => $pools,
        ];
    }

    /**
     * Sets and points of a score from the player's side ("21-17, 18-21, 21-15"), and the point
     * margin. All null for a walkover or a score that can't be read.
     *
     * @return array{setsFor: ?int, setsAgainst: ?int, pointsFor: ?int, pointsAgainst: ?int, margin: ?int}
     */
    private function points(string $score): array
    {
        $none = ['setsFor' => null, 'setsAgainst' => null, 'pointsFor' => null, 'pointsAgainst' => null, 'margin' => null];
        if (!preg_match_all('/(\d+)-(\d+)/', $score, $sets, PREG_SET_ORDER) || !preg_match('/^\d+-\d+(, \d+-\d+)*$/', trim($score))) {
            return $none;
        }
        $for = $against = $setsFor = $setsAgainst = 0;
        foreach ($sets as [, $x, $y]) {
            $for += (int)$x;
            $against += (int)$y;
            $setsFor += (int)$x > (int)$y ? 1 : 0;
            $setsAgainst += (int)$y > (int)$x ? 1 : 0;
        }

        return ['setsFor' => $setsFor, 'setsAgainst' => $setsAgainst, 'pointsFor' => $for, 'pointsAgainst' => $against, 'margin' => $for - $against];
    }

    /**
     * Winning margins of a list of meetings from player A's side (matches with a readable score):
     * sets and points won by each, and per side (`a`, `b`) the matches won, the average point
     * margin of those wins and the biggest win; also the matches that went to a deciding set and
     * the closest match.
     */
    private function margins(array $meetings): array
    {
        $scored = array_values(array_filter($meetings, fn(array $m) => $m['margin'] !== null));
        $side = function(bool $forA) use ($scored): array {
            $wins = array_values(array_filter($scored, fn(array $m) => $forA ? $m['result'] == 1 : $m['result'] == 0));
            $margins = array_map(fn(array $m) => abs($m['margin']), $wins);
            $biggest = null;
            foreach ($wins as $m) {
                if (!$biggest || abs($m['margin']) > abs($biggest['margin'])) {
                    $biggest = $m;
                }
            }
            return [
                'wins' => count($wins),
                'average' => $margins ? array_sum($margins) / count($margins) : null,
                'biggest' => $biggest,
            ];
        };
        $closest = null;
        foreach ($scored as $m) {
            if (!$closest || abs($m['margin']) < abs($closest['margin'])) {
                $closest = $m;
            }
        }

        return [
            'matches' => count($scored),
            'sets' => [array_sum(array_column($scored, 'setsFor')), array_sum(array_column($scored, 'setsAgainst'))],
            'points' => [array_sum(array_column($scored, 'pointsFor')), array_sum(array_column($scored, 'pointsAgainst'))],
            'deciding' => count(array_filter($scored, fn(array $m) => $m['setsFor'] + $m['setsAgainst'] === 3)),
            'closest' => $closest,
            'a' => $side(true),
            'b' => $side(false),
        ];
    }

    /**
     * Wins, draws and losses of a list of matches (result 1, 0.5 or 0).
     *
     * @return array{matches: int, wins: int, draws: int, losses: int}
     */
    private function record(array $matches): array
    {
        $results = array_column($matches, 'result');

        return [
            'matches' => count($results),
            'wins' => count(array_filter($results, fn($r) => $r == 1)),
            'draws' => count(array_filter($results, fn($r) => $r > 0 && $r < 1)),
            'losses' => count(array_filter($results, fn($r) => $r == 0)),
        ];
    }
}
