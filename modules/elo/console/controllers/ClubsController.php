<?php

namespace modules\elo\console\controllers;

use Craft;
use craft\console\Controller;
use craft\elements\Entry;
use craft\helpers\Console;
use craft\helpers\Db;
use yii\console\ExitCode;

/**
 * Club entries for the Elo pages.
 */
class ClubsController extends Controller
{
    /**
     * Creates or updates a Clubs entry for every club in elo/data/clubs.json (from elo/fetch-clubs.mjs).
     * Only the synced fields are written: short name (title), full name, region and NBF club ID.
     * Logos and websites are added by hand and left alone.
     *
     * ddev craft elo/clubs/sync
     */
    public function actionSync(): int
    {
        $path = Craft::getAlias('@root/elo/data/clubs.json');
        if (!is_file($path)) {
            $this->stderr("$path not found. Run node elo/fetch-clubs.mjs first.\n", Console::FG_RED);
            return ExitCode::UNAVAILABLE;
        }
        $clubs = json_decode(file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);

        $section = Craft::$app->getEntries()->getSectionByHandle('clubs');
        $type = Craft::$app->getEntries()->getEntryTypeByHandle('club');
        $created = $updated = 0;
        foreach ($clubs as $club) {
            // Match on the NBF id, or on the name for entries created by hand
            $entry = Entry::find()->section('clubs')->nbfClubId($club['id'])->status(null)->one()
                ?? Entry::find()->section('clubs')->title(Db::escapeParam($club['name']))->nbfClubId(':empty:')->status(null)->one();
            if (!$entry) {
                $entry = new Entry(['sectionId' => $section->id, 'typeId' => $type->id]);
                $created++;
            } else {
                $updated++;
            }
            $entry->title = $club['name'];
            $entry->setFieldValues([
                'nbfClubId' => $club['id'],
                'clubFullName' => $club['fullName'],
                'clubRegion' => $club['region'],
            ]);
            if (!Craft::$app->getElements()->saveElement($entry)) {
                $this->stderr("{$club['name']}: " . implode(', ', $entry->getFirstErrors()) . "\n", Console::FG_RED);
            }
        }

        $this->stdout("Clubs: $created created, $updated updated.\n", Console::FG_GREEN);
        return ExitCode::OK;
    }
}
