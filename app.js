'use strict';

const db = new Dexie('ajopaivakirja');
db.version(1).stores({ trips: '++id, tila, alkuaika' });

const VUOROKAUSI_MS = 24 * 60 * 60 * 1000;
const km = new Intl.NumberFormat('fi-FI');
const $ = (id) => document.getElementById(id);

// --- Apufunktiot ---

// "klo 8.15" tänään, muuten "29.10. klo 8.15".
function klo(iso) {
  const d = new Date(iso);
  const aika = d.toLocaleTimeString('fi-FI', { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === new Date().toDateString()) return `klo ${aika}`;
  return `${d.getDate()}.${d.getMonth() + 1}. klo ${aika}`;
}

// ISO-aika datetime-local-kentän muotoon paikallisessa ajassa.
function paikallinenAika(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Tyhjä kenttä → null, muu kuin kokonaisluku → NaN. Välilyönnit sallitaan (123 456).
function luku(teksti) {
  const s = teksti.replace(/\s/g, '');
  if (s === '') return null;
  return /^\d+$/.test(s) ? Number(s) : NaN;
}

// Tyhjä tekstikenttä tallennetaan puuttuvana kenttänä.
function arvo(input) {
  return input.value.trim() || undefined;
}

function aukiLiianKauan(ajo) {
  return Date.now() - new Date(ajo.alkuaika).getTime() > VUOROKAUSI_MS;
}

function avoinAjo() {
  return db.trips.where('tila').equals('avoin').first();
}

// Viimeisin valmis ajo, joka alkoi ennen annettua hetkeä.
function edellinenValmis(ennen = '￿') {
  return db.trips.where('alkuaika').below(ennen).reverse()
    .filter((t) => t.tila === 'valmis').first();
}

async function alkulukemanVaroitus(ajo, mittariAlku) {
  const ed = await edellinenValmis(ajo.alkuaika);
  return ed && mittariAlku < ed.mittariLoppu
    ? [`Alkulukema on pienempi kuin edellisen ajon loppulukema (${km.format(ed.mittariLoppu)} km).`]
    : [];
}

async function paivitaEhdotukset() {
  const paikat = new Set();
  const tarkoitukset = new Set();
  await db.trips.each((t) => {
    if (t.lahtopaikka) paikat.add(t.lahtopaikka);
    if (t.maaranpaa) paikat.add(t.maaranpaa);
    if (t.tarkoitus) tarkoitukset.add(t.tarkoitus);
  });
  taytaLista($('paikat'), paikat);
  taytaLista($('tarkoitukset'), tarkoitukset);
}

function taytaLista(datalist, arvot) {
  const jarjestetty = [...arvot].sort((a, b) => a.localeCompare(b, 'fi'));
  datalist.replaceChildren(...jarjestetty.map((a) => {
    const o = document.createElement('option');
    o.value = a;
    return o;
  }));
}

function nayta(nakyma) {
  for (const id of ['paa', 'aloitus', 'lopetus']) $(id).hidden = id !== nakyma;
  window.scrollTo(0, 0);
}

function nollaaLomake(lomake) {
  lomake.reset();
  lomake.querySelector('.viesti').textContent = '';
  delete lomake.dataset.kuitattu;
}

// Virhe estää tallennuksen. Varoitus näytetään kerran, ja toinen painallus tallentaa.
function tarkista(lomake, virheet, varoitukset) {
  const viesti = lomake.querySelector('.viesti');
  if (virheet.length) {
    viesti.textContent = virheet.join(' ');
    delete lomake.dataset.kuitattu;
    return false;
  }
  const teksti = varoitukset.join(' ');
  if (teksti && lomake.dataset.kuitattu !== teksti) {
    viesti.textContent = `${teksti} Paina Tallenna uudelleen, jos lukema on oikein.`;
    lomake.dataset.kuitattu = teksti;
    return false;
  }
  return true;
}

// --- Sijainti ---

const PAIKAN_SADE_M = 300;

// Palauttaa { lat, lon, tarkkuus } tai null, jos sijaintia ei saada.
function haeSijainti() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, tarkkuus: Math.round(p.coords.accuracy) }),
      () => resolve(null),
      // Aina tuore sijainti: välimuistissa oleva voi olla edellisen napin painalluksen paikka.
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  });
}

function etaisyysM(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

// Lähin aiemmista ajoista tunnettu paikka säteen sisällä, tai null.
async function lahinPaikka(sijainti) {
  if (sijainti.tarkkuus > PAIKAN_SADE_M) return null;
  let lahin = null;
  let lahinEtaisyys = PAIKAN_SADE_M;
  await db.trips.each((t) => {
    for (const [nimi, s] of [[t.lahtopaikka, t.sijaintiAlku], [t.maaranpaa, t.sijaintiLoppu]]) {
      if (!nimi || !s) continue;
      const d = etaisyysM(sijainti, s);
      if (d <= lahinEtaisyys) {
        lahin = nimi;
        lahinEtaisyys = d;
      }
    }
  });
  return lahin;
}

// Odottaa sijainnin ja tallentaa sen ajoon. Jos lomake on yhä auki samalle ajolle,
// näytetään tila ja ehdotetaan lähintä paikkaa tyhjään paikkakenttään.
async function tallennaSijainti(haku, ajoId, kentta, lomake, tilaRivi, paikkaKentta, voimassa = () => true) {
  tilaRivi.textContent = 'Haetaan sijaintia…';
  const sijainti = await haku;
  if (!voimassa()) return;
  const lomakeAuki = !lomake.hidden && Number(lomake.dataset.id) === ajoId;
  if (!sijainti) {
    if (lomakeAuki) tilaRivi.textContent = 'Sijaintia ei saatu.';
    return;
  }
  await db.trips.update(ajoId, { [kentta]: sijainti });
  if (!lomakeAuki) return;
  tilaRivi.textContent = `Sijainti tallennettu (±${km.format(sijainti.tarkkuus)} m).`;
  if (paikkaKentta.value.trim() === '') {
    const nimi = await lahinPaikka(sijainti);
    if (nimi && paikkaKentta.value.trim() === '') paikkaKentta.value = nimi;
  }
}

// Kasvaa jokaisella Lopeta-painalluksella ja peruutuksella, jotta peruutetun
// lopetuksen myöhässä saapuva sijainti ei tallennu.
let lopetusKerta = 0;

// Mittarirulla alkaa annetusta lukemasta ja kasvaa alaspäin rullattaessa.
// Kenttä pysyy tyhjänä, kunnes rullaa liikutetaan tai lukema kirjoitetaan.
const RULLAN_RIVIT = 1000;
const RIVI_PX = 44;

function liitaRulla(input, rulla, alku) {
  rulla.onscroll = null;
  input.oninput = null;
  rulla.hidden = alku == null;
  if (alku == null) return;

  rulla.replaceChildren(...Array.from({ length: RULLAN_RIVIT }, (_, i) => {
    const rivi = document.createElement('div');
    rivi.textContent = km.format(alku + i);
    return rivi;
  }));
  const paivitaTila = () => rulla.classList.toggle('koskematon', input.value.trim() === '');
  let ohitaSeuraava = false;

  rulla.onscroll = () => {
    if (ohitaSeuraava) {
      ohitaSeuraava = false;
      return;
    }
    input.value = km.format(alku + Math.round(rulla.scrollTop / RIVI_PX));
    paivitaTila();
  };
  input.oninput = () => {
    const v = luku(input.value);
    if (v >= alku && v < alku + RULLAN_RIVIT) {
      const kohta = (v - alku) * RIVI_PX;
      if (rulla.scrollTop !== kohta) {
        ohitaSeuraava = true;
        rulla.scrollTop = kohta;
      }
    }
    paivitaTila();
  };
  if (rulla.scrollTop !== 0) {
    ohitaSeuraava = true;
    rulla.scrollTop = 0;
  }
  paivitaTila();
}

// Vahvistusikkuna. Palauttaa true vain, jos käyttäjä valitsi "Poista ajo".
function vahvista(teksti) {
  const ikkuna = $('vahvistus');
  $('vahvistus-teksti').textContent = teksti;
  ikkuna.returnValue = '';
  ikkuna.showModal();
  return new Promise((resolve) => {
    ikkuna.addEventListener('close', () => resolve(ikkuna.returnValue === 'poista'), { once: true });
  });
}

// --- Pääruutu ---

async function naytaPaa(ilmoitus = '') {
  const ajo = await avoinAjo();
  $('ilmoitus').textContent = ilmoitus;
  $('ei-ajoa').hidden = Boolean(ajo);
  $('ajo-kaynnissa').hidden = !ajo;
  if (ajo) {
    $('alkanut').textContent = `Alkanut ${klo(ajo.alkuaika)}${ajo.lahtopaikka ? `, ${ajo.lahtopaikka}` : ''}`;
    $('auki-varoitus').hidden = !aukiLiianKauan(ajo);
  } else {
    const ed = await edellinenValmis();
    $('edellinen').textContent = ed ? `Edellinen mittarilukema ${km.format(ed.mittariLoppu)} km` : '';
  }
  nayta('paa');
}

$('aloita').addEventListener('click', async () => {
  const alkuaika = new Date().toISOString();
  const sijainti = haeSijainti();
  // Vain yksi avoin ajo kerrallaan, myös tuplanapautuksella.
  const ajo = await db.transaction('rw', db.trips, async () => {
    if (await avoinAjo()) return null;
    const id = await db.trips.add({ tila: 'avoin', alkuaika });
    return db.trips.get(id);
  });
  if (!ajo) return naytaPaa();
  await avaaAloitus(ajo);
  tallennaSijainti(sijainti, ajo.id, 'sijaintiAlku', $('aloitus'), $('a-sijainti'), $('a-paikka'));
});

$('lopeta').addEventListener('click', async () => {
  const kerta = ++lopetusKerta;
  const ajo = await avoinAjo();
  if (!ajo) return naytaPaa();
  // Lopetusaika ja -sijainti tallennetaan heti. Jos lomake jäi kesken, säilytetään aiemmat.
  const sijainti = ajo.sijaintiLoppu ? Promise.resolve(ajo.sijaintiLoppu) : haeSijainti();
  if (!ajo.loppuaika) {
    ajo.loppuaika = new Date().toISOString();
    await db.trips.update(ajo.id, { loppuaika: ajo.loppuaika });
  }
  await avaaLopetus(ajo);
  tallennaSijainti(sijainti, ajo.id, 'sijaintiLoppu', $('lopetus'), $('l-sijainti'), $('l-maaranpaa'),
    () => kerta === lopetusKerta);
});

$('poista').addEventListener('click', async () => {
  const ajo = await avoinAjo();
  if (ajo && await vahvista(`Poistetaanko käynnissä oleva ajo? Alkanut ${klo(ajo.alkuaika)}.`)) {
    await db.trips.delete(ajo.id);
  }
  naytaPaa();
});

// --- Aloitus ---

async function avaaAloitus(ajo) {
  const lomake = $('aloitus');
  nollaaLomake(lomake);
  lomake.dataset.id = ajo.id;
  $('a-otsikko').textContent = `Ajo alkoi ${klo(ajo.alkuaika)}`;
  const ed = await edellinenValmis(ajo.alkuaika);
  await paivitaEhdotukset();
  nayta('aloitus');
  liitaRulla($('a-mittari'), $('a-rulla'), ed?.mittariLoppu);
}

$('aloitus').addEventListener('submit', async (e) => {
  e.preventDefault();
  const lomake = e.currentTarget;
  const ajo = await db.trips.get(Number(lomake.dataset.id));
  if (!ajo) return naytaPaa();

  const mittariAlku = luku($('a-mittari').value);
  const virheet = [];
  const varoitukset = [];
  if (Number.isNaN(mittariAlku)) virheet.push('Mittarilukemassa voi olla vain numeroita.');
  else if (mittariAlku !== null) varoitukset.push(...await alkulukemanVaroitus(ajo, mittariAlku));
  if (!tarkista(lomake, virheet, varoitukset)) return;

  await db.trips.update(ajo.id, {
    mittariAlku: mittariAlku ?? undefined,
    lahtopaikka: arvo($('a-paikka')),
  });
  naytaPaa();
});

// --- Lopetus ---

async function avaaLopetus(ajo) {
  const lomake = $('lopetus');
  nollaaLomake(lomake);
  lomake.dataset.id = ajo.id;
  $('l-ajat').textContent = `Ajo alkoi ${klo(ajo.alkuaika)} ja päättyi ${klo(ajo.loppuaika)}.`;
  $('l-aika-kentta').hidden = !aukiLiianKauan(ajo);
  $('l-aika').value = paikallinenAika(ajo.loppuaika);
  $('l-alku-kentta').hidden = ajo.mittariAlku != null;
  $('l-lahto-kentta').hidden = Boolean(ajo.lahtopaikka);
  if (!ajo.lahtopaikka && ajo.sijaintiAlku) $('l-lahto').value = (await lahinPaikka(ajo.sijaintiAlku)) ?? '';
  const ed = await edellinenValmis(ajo.alkuaika);
  await paivitaEhdotukset();
  nayta('lopetus');
  liitaRulla($('l-alku'), $('l-alku-rulla'), ajo.mittariAlku == null ? ed?.mittariLoppu : undefined);
  liitaRulla($('l-loppu'), $('l-loppu-rulla'), ajo.mittariAlku ?? ed?.mittariLoppu);
}

$('lopetus').addEventListener('submit', async (e) => {
  e.preventDefault();
  const lomake = e.currentTarget;
  const ajo = await db.trips.get(Number(lomake.dataset.id));
  if (!ajo || ajo.tila !== 'avoin') return naytaPaa();

  const virheet = [];
  const varoitukset = [];
  const mittariAlku = ajo.mittariAlku ?? luku($('l-alku').value);
  const mittariLoppu = luku($('l-loppu').value);
  const lisamatkustajat = luku($('l-matkustajat').value) ?? 0;

  let loppuaika = ajo.loppuaika;
  if (!$('l-aika-kentta').hidden) {
    const d = new Date($('l-aika').value);
    if (Number.isNaN(d.getTime())) virheet.push('Anna lopetusaika.');
    else if (d.toISOString() <= ajo.alkuaika) virheet.push('Lopetusajan pitää olla alkuajan jälkeen.');
    else loppuaika = d.toISOString();
  }

  if (mittariAlku === null) virheet.push('Anna mittarin alkulukema.');
  if (mittariLoppu === null) virheet.push('Anna mittarin loppulukema.');
  if ([mittariAlku, mittariLoppu, lisamatkustajat].some(Number.isNaN)) {
    virheet.push('Lukemissa voi olla vain numeroita.');
  }
  if (!virheet.length && mittariLoppu < mittariAlku) virheet.push('Loppulukema on pienempi kuin alkulukema.');
  if (!virheet.length && ajo.mittariAlku == null) {
    varoitukset.push(...await alkulukemanVaroitus(ajo, mittariAlku));
  }
  if (!tarkista(lomake, virheet, varoitukset)) return;

  await db.trips.update(ajo.id, {
    tila: 'valmis',
    loppuaika,
    mittariAlku,
    mittariLoppu,
    lahtopaikka: ajo.lahtopaikka ?? arvo($('l-lahto')),
    maaranpaa: arvo($('l-maaranpaa')),
    tarkoitus: arvo($('l-tarkoitus')),
    lisamatkustajat,
    perakarry: $('l-perakarry').checked,
  });
  naytaPaa(`Ajo tallennettu, ${km.format(mittariLoppu - mittariAlku)} km.`);
});

// Peruutus palauttaa ajon käynnissä olevaksi.
$('l-peruuta').addEventListener('click', async () => {
  lopetusKerta++;
  await db.trips.update(Number($('lopetus').dataset.id), { loppuaika: undefined, sijaintiLoppu: undefined });
  naytaPaa();
});

// --- Käynnistys ---

// Päivitetään pääruutu, kun sovellus palaa näkyviin (esim. auki jääneen ajon varoitus).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !$('paa').hidden) naytaPaa();
});

naytaPaa();
