<?php

use craft\helpers\App;

return [
    'useDevServer' => App::env('ENVIRONMENT') === 'dev' || App::env('CRAFT_ENVIRONMENT') === 'dev',
    'manifestPath' => '@webroot/dist/.vite/manifest.json',
	'devServerInternal' => 'http://localhost:3000',
	'devServerPublic' => rtrim(App::env('PRIMARY_SITE_URL'), '/') . ':3000',
    'serverPublic' => App::env('PRIMARY_SITE_URL') . '/dist/',
    'errorEntry' => '',
    'cacheKeySuffix' => '',
    'checkDevServer' => true,
    'includeReactRefreshShim' => false,
    'includeModulePreloadShim' => true,
];
