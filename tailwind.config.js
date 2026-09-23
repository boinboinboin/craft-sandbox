/*
this uses calc instead of clamp because it is more accessible than using clamp.
One issue is that this only sets the fluid part within two breakpoints, so we
need three definitions of the font, on below the minWidth, the fluid part,
and one above the maxWidth
'heading-1-desktop': [96/16 + 'rem', '110%'],
'heading-1-mobile': [40/16 + 'rem', '110%'],
'heading-1-fluid': [fluidFontSize(40,96), '110%'],

.h1 {
  @apply text-heading-1-mobile sm:text-heading-1-fluid 3xl:text-heading-1-desktop font-normal;
}

*/
const fluidFontSize = (minPx, maxPx) => {
  const minWidth = 640
  const maxWidth = 1728
  const remSize = 16
  const minRem = minPx / remSize
  const maxRem = maxPx / remSize
  return 'calc('+minRem+'rem + ('+maxRem+' - '+minRem+') * ((100vw - '+minWidth/remSize+'rem) / ('+maxWidth/remSize+' - '+minWidth/remSize+')))'
}

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./templates/**/*.twig",
    "./assets/**/*.js"
  ],
  theme: {
    fontFamily: {
        'sans': ['Public Sans', 'sans-serif']
    },
    extend: {
      fontSize: {
        'heading-1-desktop': [96/16 + 'rem', '110%'],
        'heading-1-mobile': [40/16 + 'rem', '110%'],
        'heading-1-fluid': [fluidFontSize(40,96), '110%'],
      },
    },
  },
  plugins: [],
}
