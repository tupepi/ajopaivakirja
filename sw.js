'use strict';

// Kasvata versiota aina, kun jokin alla olevista tiedostoista muuttuu.
// Muuten asennettu sovellus jatkaa vanhojen tiedostojen käyttöä.
const VERSIO = 'ajopaivakirja-3';
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

// Tiedostot haetaan versionumerolla, jotta Cloudflaren välimuisti ei voi antaa
// vanhaa tiedostoa uuden rinnalle. cache: 'reload' ohittaa selaimen välimuistin.
// Välimuistiin ne tallennetaan ilman versionumeroa. Yksikin epäonnistunut haku
// keskeyttää asennuksen, jolloin vanha versio jää käyttöön.
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const valimuisti = await caches.open(VERSIO);
    await Promise.all(TIEDOSTOT.map(async (url) => {
      const vastaus = await fetch(`${url}?v=${VERSIO}`, { cache: 'reload' });
      if (!vastaus.ok) throw new Error(`${url}: ${vastaus.status}`);
      await valimuisti.put(url, vastaus);
    }));
    await self.skipWaiting();
  })());
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
