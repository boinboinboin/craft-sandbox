<?php
// https://github.com/vaersaagod/seomate/blob/master/README.md
return [
    'defaultProfile' => 'standard',
    'fieldProfiles' => [
        'standard' => [
            'title' => ['seoTitle', 'title'],
            'description' => ['seoDescription', 'preamble'],
            'image' => ['seoImage', 'mainImage'],
            'og:title' => ['ogTitle','seoTitle', 'title'],
            'og:description' => ['ogDescription','seoDescription', 'preamble'],
            'og:image' => ['ogImage','seoImage', 'mainImage'],
            'twitter:title' => ['twitterTitle','seoTitle', 'title'],
            'twitter:description' => ['twitterDescription','seoDescription', 'preamble'],
            'twitter:image' => ['twitterImage','seoImage', 'mainImage']
        ]
    ],
    'sitemapEnabled' => true,
    'sitemapLimit' => 100,
    'sitemapConfig' => [
        'elements' => [
            'home' => ['changefreq' => 'weekly', 'priority' => 1],
            'main' => ['changefreq' => 'weekly', 'priority' => 0.5],
        ],
    ],
];
