<?php

namespace modules\elo;

use Craft;
use craft\web\twig\variables\CraftVariable;
use modules\elo\services\EloService;
use modules\elo\variables\EloVariable;
use yii\base\Event;
use yii\base\Module as BaseModule;

/**
 * elo module
 *
 * Serves the badminton Elo ratings calculated by elo/rate.mjs to the templates as `craft.elo`.
 *
 * @property-read EloService $elo
 * @method static Module getInstance()
 */
class Module extends BaseModule
{
    public function init(): void
    {
        Craft::setAlias('@modules/elo', __DIR__);

        // Console commands: `craft elo/clubs/sync`
        if (Craft::$app->request->isConsoleRequest) {
            $this->controllerNamespace = 'modules\\elo\\console\\controllers';
        }

        $this->setComponents([
            'elo' => EloService::class,
        ]);

        parent::init();

        Event::on(CraftVariable::class, CraftVariable::EVENT_INIT, function(Event $event) {
            /** @var CraftVariable $variable */
            $variable = $event->sender;
            $variable->set('elo', EloVariable::class);
        });
    }
}
