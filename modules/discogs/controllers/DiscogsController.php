<?php

namespace modules\discogs\controllers;

use Craft;
use craft\elements\Asset;
use craft\elements\Entry;
use craft\helpers\Assets as AssetsHelper;
use craft\web\Controller;
use GuzzleHttp\Client as GuzzleClient;
use modules\discogs\Module;
use yii\web\BadRequestHttpException;
use yii\web\Response;

/**
 * Requires login; vinyls are added to (and de-duplicated within) the current user's own collection.
 */
class DiscogsController extends Controller
{
    /**
     * GET actions/discogs/discogs/search?q=...
     * Searches Discogs and returns candidate releases as JSON.
     */
    public function actionSearch(): Response
    {
        $this->requireAcceptsJson();

        $query = trim((string)Craft::$app->getRequest()->getRequiredQueryParam('q'));
        if ($query === '') {
            throw new BadRequestHttpException('Query cannot be empty.');
        }

        $results = Module::getInstance()->get('discogs')->search($query);

        return $this->asJson(['results' => $results]);
    }

    /**
     * POST actions/discogs/discogs/add
     * Body: { discogsId: int, status: 'owned'|'wanted' }
     *
     * Creates a new Vinyl entry from a Discogs release, or — if that release
     * was already added before — just updates its status instead of duplicating it.
     */
    public function actionAdd(): Response
    {
        $this->requirePostRequest();
        $this->requireAcceptsJson();

        $section = Craft::$app->getEntries()->getSectionByHandle('vinyls');
        $this->requirePermission("createEntries:$section->uid");
        $user = static::currentUser();

        $request = Craft::$app->getRequest();
        $discogsId = (int)$request->getRequiredBodyParam('discogsId');
        $status = (string)$request->getRequiredBodyParam('status');

        if (!in_array($status, ['owned', 'wanted'], true)) {
            throw new BadRequestHttpException('status must be "owned" or "wanted".');
        }

        // Already have this release? Just update its status rather than duplicating it.
        $existing = Entry::find()
            ->section('vinyls')
            ->authorId($user->id)
            ->discogsReleaseId($discogsId)
            ->one();

        if ($existing) {
            $existing->setFieldValue('vinylStatus', $status);
            Craft::$app->getElements()->saveElement($existing);

            return $this->asJson([
                'created' => false,
                'entry' => ['id' => $existing->id, 'url' => $existing->url, 'title' => $existing->title],
            ]);
        }

        try {
            $discogs = Module::getInstance()->get('discogs');
            $release = $discogs->getMaster($discogsId);

            $entry = new Entry();
            $entryType = Craft::$app->getEntries()->getEntryTypeByHandle('vinyl');
            $entry->sectionId = $section->id;
            $entry->typeId = $entryType->id;
            $entry->setAuthorIds([$user->id]);
            $entry->title = $release['title'];
            $entry->setFieldValue('vinylArtist', $release['artist']);
            $entry->setFieldValue('vinylStatus', $status);
            $entry->setFieldValue('vinylYear', $release['year']);
            $entry->setFieldValue('vinylLabel', $release['label']);
            $entry->setFieldValue('vinylTracklist', $release['tracklist']);
            $entry->setFieldValue('discogsReleaseId', $discogsId);

            if ($release['coverImageUrl']) {
                $asset = $this->downloadCoverImage($release['coverImageUrl'], $release['title']);
                if ($asset) {
                    $entry->setFieldValue('vinylCoverImage', [$asset->id]);
                }
            }

            Craft::$app->getElements()->saveElement($entry);

            return $this->asJson([
                'created' => true,
                'entry' => ['id' => $entry->id, 'url' => $entry->url, 'title' => $entry->title],
            ]);
        } catch (\Throwable $e) {
            Craft::error('Discogs add failed: ' . $e->getMessage(), __METHOD__);
            return $this->asJson(['error' => $e->getMessage()])->setStatusCode(422);
        }
    }

    /**
     * Downloads a Discogs cover image and saves it as a real Craft Asset
     * in the `assets` volume's `vinyl-cover-images` subfolder.
     * Returns null (rather than throwing) if the download fails, so a
     * missing/broken image never blocks creating the entry itself.
     */
    private function downloadCoverImage(string $url, string $title): ?Asset
    {
        try {
            $volume = Craft::$app->getVolumes()->getVolumeByHandle('assets');
            $folder = Craft::$app->getAssets()->ensureFolderByFullPathAndVolume('vinyl-cover-images', $volume);

            $tempPath = Craft::$app->getPath()->getTempPath() . '/' . uniqid('discogs-', true) . '.jpg';
            (new GuzzleClient())->get($url, ['sink' => $tempPath]);

            $asset = new Asset();
            $asset->tempFilePath = $tempPath;
            $asset->newFolderId = $folder->id;
            $asset->newFilename = AssetsHelper::prepareAssetName($title . '.jpg');
            $asset->avoidFilenameConflicts = true;
            $asset->setScenario(Asset::SCENARIO_CREATE);

            if (!Craft::$app->getElements()->saveElement($asset)) {
                return null;
            }

            return $asset;
        } catch (\Throwable $e) {
            Craft::warning('Could not download Discogs cover image: ' . $e->getMessage(), __METHOD__);
            return null;
        }
    }
}
