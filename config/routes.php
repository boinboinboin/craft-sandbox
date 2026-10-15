<?php
/**
 * Site URL Rules
 *
 * You can define custom site URL rules here, which Craft will check in addition
 * to routes defined in Settings → Routes.
 *
 * Read all about Craft’s routing behavior, here:
 * https://craftcms.com/docs/4.x/routing.html
 */

return [
    // Badminton Elo ratings (modules/elo, data from elo/rate.mjs)
    'elo' => ['template' => '_elo/index'],
    'elo/players/<playerId:\d+>' => ['template' => '_elo/player'],
    'elo/players/search' => ['template' => '_elo/player-search.json'],
    'elo/search' => ['template' => '_elo/search.json'],
    'elo/head-to-head' => ['template' => '_elo/head-to-head'],
    'elo/upsets' => ['template' => '_elo/upsets'],
    'elo/clubs' => ['template' => '_elo/clubs'],
    'elo/eliteserien' => ['template' => '_elo/eliteserien'],
    'elo/eliteserien/<season:\d{4}-\d{2}>' => ['template' => '_elo/eliteserien-review'],
];
