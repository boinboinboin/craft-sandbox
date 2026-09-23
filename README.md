# Craft CMS Boilerplate

This project is set up with ddev

To set up run

~~Delete config/license.key, so a new one can be generated.~~

In the repo .gitignore, licence.key is added. this must be removed so
we can generate a new one that can be comitted

run `ddev composer run-script setup-dev` to set up .gitignore correctly, and set up .env to work with ddev

*Check: Can we add this to .gitignore, or will this cause havoc?*

`ddev composer install`

`ddev craft install`

`ddev craft setup/keys`

If server is Nginx, remove web/.htaccess

## Packages
- DDEV
- Craft CMS
- Vite
- Tailwindcss
- Stimulus
- Stimulus controller resolver

[Stimulus resolver documentation](https://github.com/danieldiekmeier/stimulus-controller-resolver)

## Assets
Using Vite to manage assets
main file is `assets/js/app.js`, this is also responsible to compile tailwind css.

Vite is set up inside ddev so that no local setup is neccesary. It has HMR set up, and reloads the page
when changes are done in twig.
[Vite plugin documentation](https://nystudio107.com/docs/vite/#using-vite)

If dev server isn't running, it will serve assets from web/dist/assets folder. This can be used to test production
build before release. this will not auto update assets, so you need to run `ddev npm run build` to update assets

`ddev npm run dev` to start dev server with HTM/reload

`ddev npm run build` to build for production, production build is used when envvar `ENVIRONMENT=production`

`ddev npm run kill-dev` if you close terminal when running vite, use this to stop dev server.

### Tailwind
Tailwind is used for css, Tailwind is a utility first framework
[Tailwind documentation](https://tailwindcss.com/docs/utility-first)

Tailwind config `tailwind.config.js`

### Stimulus
Stimulus is used to handle javascript. Stimulus has some advantages compared to vanilla Javascript.

It uses controllers that are connected to spesific parts of the code. The controllers are loaded
async only to pages that are using the controller. If new elements with a controller is loaded on the page,
The controllers are connected automaticly.

This means that we don't load uneccesary javascript on the page and we don't need to reload javascript when
new elements are loaded on the page. [Stimulus handbook](https://stimulus.hotwired.dev/handbook/introduction)

## Styling rules
Never style tags or ID's only classes, except for when styling rich text fields, here it is possible to
wrap the rich text content in a class and style tags inside this class.
```
<div class="richtext">
  <h2>sub title</h2>
  <p>text</p>
</div>
```
with the css
```
.richtext {
  h2 {
    @apply text-xl font-bold
  }
  p {
    @apply text-lg font-normal;
  }
}
```
example:
<h1>title</h1> does not have any styles with tailwind, so we need to add a class to it.
either use tailwinds utility classes like `text-3xl font-bold` or use a predefined class like .h1
<h1 class="h1">title</h1>
use html tags only for semantics not for styling.
to style p, define a base style
