'use strict';

// Kasvata versiota aina, kun jokin alla olevista tiedostoista muuttuu.
// Muuten asennettu sovellus jatkaa vanhojen tiedostojen käyttöä.
const VERSIO = 'ajopaivakirja-1';
const TIEDOSTOT = [
  './',
  'index.html',
  'app.js',
  'vendor/dexie.min.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' ohittaa selaimen HTTP-välimuistin, jotta uusi versio tallentuu varmasti.
  e.waitUntil(
    caches.open(VERSIO)
      .then((valimuisti) => valimuisti.addAll(TIEDOSTOT.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((nimet) => Promise.all(nimet.filter((nimi) => nimi !== VERSIO).map((nimi) => caches.delete(nimi))))
      .then(() => self.clients.claim()),
  );
});

// Ensin välimuistista, jotta sovellus aukeaa heti myös ilman verkkoa.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((vastaus) => vastaus ?? fetch(e.request)));
});
