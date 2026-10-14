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
];
