<?php

namespace modules\discogs\services;

use Calliostro\Discogs\DiscogsClient;
use Calliostro\Discogs\DiscogsClientFactory;
use craft\helpers\App;
use yii\base\Component;

/**
 * Talks to the Discogs API and normalizes its responses into the shape
 * the rest of the app (controller, templates) works with.
 *
 * Keeping the raw-Discogs-response mapping in one place means if Discogs
 * ever changes a field name, only this file needs to change.
 */
class DiscogsService extends Component
{
    private ?DiscogsClient $client = null;

    private function getClient(): DiscogsClient
    {
        if ($this->client === null) {
            $this->client = DiscogsClientFactory::createWithPersonalAccessToken(
                App::env('DISCOGS_PERSONAL_ACCESS_TOKEN')
            );
        }

        return $this->client;
    }

    /**
     * Searches Discogs for master releases matching a query.
     *
     * Searching masters (the canonical "album" entry) rather than releases
     * (every individual pressing/reissue) means one result per album, instead
     * of the same title repeated once per pressing.
     *
     * @return array<int, array{id: int, title: string, year: ?string, thumb: ?string}>
     */
    public function search(string $query): array
    {
        $response = $this->getClient()->search(q: $query, type: 'master');

        $results = [];
        $seenTitles = [];
        foreach ($response['results'] ?? [] as $result) {
            $title = $result['title'] ?? '';

            // Defensive backstop: two distinct masters could in theory share a title.
            $dedupeKey = mb_strtolower(trim($title));
            if ($dedupeKey !== '' && isset($seenTitles[$dedupeKey])) {
                continue;
            }
            $seenTitles[$dedupeKey] = true;

            $results[] = [
                'id' => (int)$result['id'],
                'title' => $title,
                'year' => $result['year'] ?? null,
                'thumb' => $result['thumb'] ?? ($result['cover_image'] ?? null),
            ];
        }

        return $results;
    }

    /**
     * Fetches full details for a single master release, normalized for the Vinyl entry fields.
     *
     * Note: master releases don't carry a `labels` field the way individual
     * pressings do (a master isn't tied to one specific label/catalog#), so
     * `label` will typically come back null here.
     *
     * @return array{
     *     title: string,
     *     artist: string,
     *     year: ?int,
     *     label: ?string,
     *     tracklist: array<int, array{position: string, title: string, duration: string}>,
     *     coverImageUrl: ?string,
     * }
     */
    public function getMaster(int $discogsId): array
    {
        $release = $this->getClient()->getMaster($discogsId);

        $artists = array_map(
            static fn(array $artist) => $artist['name'] ?? '',
            $release['artists'] ?? []
        );

        $labels = array_map(
            static fn(array $label) => $label['name'] ?? '',
            $release['labels'] ?? []
        );

        $coverImageUrl = null;
        foreach ($release['images'] ?? [] as $image) {
            if (($image['type'] ?? null) === 'primary') {
                $coverImageUrl = $image['uri'] ?? null;
                break;
            }
        }
        // Fall back to the first image if none is marked "primary"
        if ($coverImageUrl === null && !empty($release['images'])) {
            $coverImageUrl = $release['images'][0]['uri'] ?? null;
        }

        return [
            'title' => $release['title'] ?? '',
            'artist' => implode(', ', array_filter($artists)),
            'year' => isset($release['year']) ? (int)$release['year'] : null,
            'label' => $labels[0] ?? null,
            'tracklist' => $this->normalizeTracklist($release['tracklist'] ?? []),
            'coverImageUrl' => $coverImageUrl,
        ];
    }

    /**
     * Flattens Discogs' tracklist into a simple list of rows, dropping
     * heading-only rows (e.g. "Side A") that have no duration/position of their own
     * but keeping any of their sub_tracks.
     *
     * @param array<int, array<string, mixed>> $tracklist
     * @return array<int, array{position: string, title: string, duration: string}>
     */
    private function normalizeTracklist(array $tracklist): array
    {
        $rows = [];

        foreach ($tracklist as $track) {
            if (($track['type_'] ?? 'track') === 'heading' && !empty($track['sub_tracks'])) {
                foreach ($track['sub_tracks'] as $subTrack) {
                    $rows[] = $this->trackRow($subTrack);
                }
                continue;
            }

            $rows[] = $this->trackRow($track);
        }

        return $rows;
    }

    /**
     * @param array<string, mixed> $track
     * @return array{position: string, title: string, duration: string}
     */
    private function trackRow(array $track): array
    {
        return [
            'position' => $track['position'] ?? '',
            'title' => $track['title'] ?? '',
            'duration' => $track['duration'] ?? '',
        ];
    }
}
