<?php

namespace modules\discogs\controllers;

use Craft;
use craft\elements\Entry;
use craft\web\Controller;
use yii\web\BadRequestHttpException;
use yii\web\NotFoundHttpException;
use yii\web\Response;

/**
 * Manages Vinyl entries directly (remove, change status) — no Discogs API involved.
 */
class VinylController extends Controller
{
    protected array|bool|int $allowAnonymous = ['remove', 'move'];

    /**
     * POST actions/discogs/vinyl/remove
     * Body: { entryId: int }
     */
    public function actionRemove(): Response
    {
        $this->requirePostRequest();
        $this->requireAcceptsJson();

        $entry = $this->requireVinylEntry();
        Craft::$app->getElements()->deleteElement($entry);

        return $this->asJson(['success' => true]);
    }

    /**
     * POST actions/discogs/vinyl/move
     * Body: { entryId: int, status: 'owned'|'wanted' }
     * Moves a vinyl between the Collection (owned) and Wishlist (wanted).
     */
    public function actionMove(): Response
    {
        $this->requirePostRequest();
        $this->requireAcceptsJson();

        $status = (string)Craft::$app->getRequest()->getRequiredBodyParam('status');
        if (!in_array($status, ['owned', 'wanted'], true)) {
            throw new BadRequestHttpException('status must be "owned" or "wanted".');
        }

        $entry = $this->requireVinylEntry();
        $entry->setFieldValue('vinylStatus', $status);
        Craft::$app->getElements()->saveElement($entry);

        return $this->asJson(['success' => true, 'status' => $status]);
    }

    private function requireVinylEntry(): Entry
    {
        $entryId = (int)Craft::$app->getRequest()->getRequiredBodyParam('entryId');

        $entry = Entry::find()
            ->id($entryId)
            ->section('vinyls')
            ->one();

        if (!$entry) {
            throw new NotFoundHttpException('Vinyl entry not found.');
        }

        return $entry;
    }
}
