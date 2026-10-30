'use strict';

const db = new Dexie('ajopaivakirja');
db.version(1).stores({ trips: '++id, tila, alkuaika' });

const VUOROKAUSI_MS = 24 * 60 * 60 * 1000;
const km = new Intl.NumberFormat('fi-FI');
const $ = (id) => document.getElementById(id);

// --- Apufunktiot ---

// "8.15"
function aika(iso) {
  return new Date(iso).toLocaleTimeString('fi-FI', { hour: 'numeric', minute: '2-digit' });
}

// "29.10."
function paiva(iso) {
  const d = new Date(iso);
  return `${d.getDate()}.${d.getMonth() + 1}.`;
}

function samaPaiva(a, b) {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

// "klo 8.15" tänään, muuten "29.10. klo 8.15".
function klo(iso) {
  if (samaPaiva(iso, Date.now())) return `klo ${aika(iso)}`;
  return `${paiva(iso)} klo ${aika(iso)}`;
}

function ajonKm(ajo) {
  return ajo.mittariLoppu - ajo.mittariAlku;
}

function elementti(tagi, luokka, teksti) {
  const el = document.createElement(tagi);
  if (luokka) el.className = luokka;
  if (teksti != null) el.textContent = teksti;
  return el;
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

// Viimeisin valmis ajo, joka alkoi ennen annettua hetkeä. Ilman hetkeä viimeisin kaikista.
function edellinenValmis(ennen, ohitaId) {
  const ajot = ennen ? db.trips.where('alkuaika').below(ennen) : db.trips.orderBy('alkuaika');
  return ajot.reverse().filter((t) => t.tila === 'valmis' && t.id !== ohitaId).first();
}

// Ensimmäinen valmis ajo, joka alkoi annetun hetken jälkeen.
function seuraavaValmis(jalkeen, ohitaId) {
  return db.trips.where('alkuaika').above(jalkeen)
    .filter((t) => t.tila === 'valmis' && t.id !== ohitaId).first();
}

async function alkulukemanVaroitus(ajo, mittariAlku) {
  const ed = await edellinenValmis(ajo.alkuaika, ajo.id);
  return ed && mittariAlku < ed.mittariLoppu
    ? [`Alkulukema on pienempi kuin edellisen ajon loppulukema (${km.format(ed.mittariLoppu)} km).`]
    : [];
}

async function loppulukemanVaroitus(ajo, mittariLoppu) {
  const seur = await seuraavaValmis(ajo.alkuaika, ajo.id);
  return seur && mittariLoppu > seur.mittariAlku
    ? [`Loppulukema on suurempi kuin seuraavan ajon alkulukema (${km.format(seur.mittariAlku)} km).`]
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
  for (const id of ['paa', 'aloitus', 'lopetus', 'paivakirja', 'muokkaus']) $(id).hidden = id !== nakyma;
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

// Vahvistusikkuna. Palauttaa true vain, jos käyttäjä valitsi punaisen napin.
function vahvista(teksti, nappi = 'Poista ajo') {
  const ikkuna = $('vahvistus');
  $('vahvistus-teksti').textContent = teksti;
  $('vahvistus-ok').textContent = nappi;
  ikkuna.returnValue = '';
  ikkuna.showModal();
  return new Promise((resolve) => {
    ikkuna.addEventListener('close', () => resolve(ikkuna.returnValue === 'ok'), { once: true });
  });
}

// --- Pääruutu ---

// Muistutus varmuuskopiosta näytetään vain ajon tallennuksen jälkeen.
async function naytaPaa(ilmoitus = '', muistuta = false) {
  const ajo = await avoinAjo();
  $('ilmoitus').textContent = ilmoitus;
  $('muistutus').hidden = true;
  if (muistuta) {
    ajotMuistissa = await db.trips.toArray();
    if (varmuuskopioMyohassa(ajotMuistissa)) {
      const viimeisin = localStorage.getItem(VARMUUSKOPIO_AVAIN);
      $('muistutus-teksti').textContent = viimeisin
        ? `Edellinen varmuuskopio on otettu ${paivays(viimeisin)}.`
        : 'Varmuuskopiota ei ole vielä otettu.';
      $('muistutus').hidden = false;
    }
  }
  $('ei-ajoa').hidden = Boolean(ajo);
  $('ajo-kaynnissa').hidden = !ajo;
  $('poista').hidden = !ajo;
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
  naytaPaa(`Ajo tallennettu, ${km.format(mittariLoppu - mittariAlku)} km.`, true);
});

// Peruutus palauttaa ajon käynnissä olevaksi.
$('l-peruuta').addEventListener('click', async () => {
  lopetusKerta++;
  await db.trips.update(Number($('lopetus').dataset.id), { loppuaika: undefined, sijaintiLoppu: undefined });
  naytaPaa();
});

// --- Päiväkirja ---

// Päiväkirjan vierityskohta, johon palataan muokkauksesta.
let paivakirjanVieritys = 0;

async function avaaPaivakirja(vieritys = 0, ilmoitus = '') {
  ajotMuistissa = await db.trips.orderBy('alkuaika').reverse().toArray();
  const ajot = ajotMuistissa.filter((t) => t.tila === 'valmis');
  const viimeisin = localStorage.getItem(VARMUUSKOPIO_AVAIN);
  $('pk-varmuuskopio').textContent = viimeisin ? `Edellinen varmuuskopio ${paivays(viimeisin)}` : 'Varmuuskopiota ei ole vielä otettu.';
  $('pk-ilmoitus').textContent = ilmoitus;
  const kuukaudet = new Map();
  for (const ajo of ajot) {
    const d = new Date(ajo.alkuaika);
    const avain = `${d.getFullYear()}-${d.getMonth()}`;
    if (!kuukaudet.has(avain)) kuukaudet.set(avain, []);
    kuukaudet.get(avain).push(ajo);
  }

  const lista = $('pk-lista');
  lista.replaceChildren();
  if (!ajot.length) lista.append(elementti('p', 'vihje', 'Ei vielä tallennettuja ajoja.'));
  for (const kuukauden of kuukaudet.values()) {
    const nimi = new Date(kuukauden[0].alkuaika).toLocaleDateString('fi-FI', { month: 'long', year: 'numeric' });
    const kmYhteensa = kuukauden.reduce((summa, ajo) => summa + ajonKm(ajo), 0);
    const ul = document.createElement('ul');
    ul.append(...kuukauden.map(paivakirjanRivi));
    // CSV muodostetaan muistissa olevista ajoista ilman odottelua, jotta iOS:n
    // jakovalikko avautuu yhä saman napautuksen seurauksena.
    const vienti = elementti('button', 'linkki', 'Vie CSV');
    vienti.type = 'button';
    vienti.addEventListener('click', () => vieCsv(kuukauden));
    lista.append(
      elementti('h2', '', nimi[0].toUpperCase() + nimi.slice(1)),
      elementti('p', 'vihje', `${kuukauden.length} ${kuukauden.length === 1 ? 'ajo' : 'ajoa'} · ${km.format(kmYhteensa)} km`),
      vienti,
      ul,
    );
  }
  nayta('paivakirja');
  window.scrollTo(0, vieritys);
}

// "ke 29.10. 8.15–9.02 · 42 km", "Koti → Asiakas Oy", tarkoitus.
function paivakirjanRivi(ajo) {
  const viikonpaiva = new Date(ajo.alkuaika).toLocaleDateString('fi-FI', { weekday: 'short' });
  const loppu = samaPaiva(ajo.alkuaika, ajo.loppuaika) ? aika(ajo.loppuaika) : `${paiva(ajo.loppuaika)} ${aika(ajo.loppuaika)}`;
  const nappi = elementti('button', 'rivi');
  nappi.type = 'button';
  nappi.append(
    elementti('span', '', `${viikonpaiva} ${paiva(ajo.alkuaika)} ${aika(ajo.alkuaika)}–${loppu} · ${km.format(ajonKm(ajo))} km`),
    elementti('span', '', `${ajo.lahtopaikka ?? '–'} → ${ajo.maaranpaa ?? '–'}`),
    elementti('span', 'vihje', ajo.tarkoitus ?? 'Ei tarkoitusta'),
  );
  nappi.addEventListener('click', () => avaaMuokkaus(ajo.id));
  const li = document.createElement('li');
  li.append(nappi);
  return li;
}

$('avaa-paivakirja').addEventListener('click', () => avaaPaivakirja());
$('pk-takaisin').addEventListener('click', () => naytaPaa());

// --- Muokkaus ---

async function avaaMuokkaus(id) {
  const ajo = await db.trips.get(id);
  if (!ajo) return avaaPaivakirja(paivakirjanVieritys);
  paivakirjanVieritys = window.scrollY;
  const lomake = $('muokkaus');
  nollaaLomake(lomake);
  lomake.dataset.id = id;
  $('m-alkuaika').value = paikallinenAika(ajo.alkuaika);
  $('m-loppuaika').value = paikallinenAika(ajo.loppuaika);
  $('m-alku').value = ajo.mittariAlku;
  $('m-loppu').value = ajo.mittariLoppu;
  $('m-lahto').value = ajo.lahtopaikka ?? '';
  $('m-maaranpaa').value = ajo.maaranpaa ?? '';
  $('m-tarkoitus').value = ajo.tarkoitus ?? '';
  $('m-matkustajat').value = ajo.lisamatkustajat || '';
  $('m-perakarry').checked = Boolean(ajo.perakarry);
  await paivitaEhdotukset();
  nayta('muokkaus');
}

// Muuttamaton kenttä säilyttää alkuperäisen ajan sekunteineen. Tyhjä tai virheellinen → null.
function lomakkeenAika(input, alkuperainen) {
  if (input.value === paikallinenAika(alkuperainen)) return alkuperainen;
  const d = new Date(input.value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

$('muokkaus').addEventListener('submit', async (e) => {
  e.preventDefault();
  const lomake = e.currentTarget;
  const ajo = await db.trips.get(Number(lomake.dataset.id));
  if (!ajo) return avaaPaivakirja(paivakirjanVieritys);

  const virheet = [];
  const varoitukset = [];
  const alkuaika = lomakkeenAika($('m-alkuaika'), ajo.alkuaika);
  const loppuaika = lomakkeenAika($('m-loppuaika'), ajo.loppuaika);
  const mittariAlku = luku($('m-alku').value);
  const mittariLoppu = luku($('m-loppu').value);
  const lisamatkustajat = luku($('m-matkustajat').value) ?? 0;

  if (!alkuaika || !loppuaika) virheet.push('Anna alku- ja loppuaika.');
  else if (loppuaika <= alkuaika) virheet.push('Loppuajan pitää olla alkuajan jälkeen.');
  if (mittariAlku === null || mittariLoppu === null) virheet.push('Anna molemmat mittarilukemat.');
  if ([mittariAlku, mittariLoppu, lisamatkustajat].some(Number.isNaN)) {
    virheet.push('Lukemissa voi olla vain numeroita.');
  }
  if (!virheet.length && mittariLoppu < mittariAlku) virheet.push('Loppulukema on pienempi kuin alkulukema.');
  if (!virheet.length) {
    const muokattu = { ...ajo, alkuaika };
    varoitukset.push(
      ...await alkulukemanVaroitus(muokattu, mittariAlku),
      ...await loppulukemanVaroitus(muokattu, mittariLoppu),
    );
  }
  if (!tarkista(lomake, virheet, varoitukset)) return;

  await db.trips.update(ajo.id, {
    alkuaika,
    loppuaika,
    mittariAlku,
    mittariLoppu,
    lahtopaikka: arvo($('m-lahto')),
    maaranpaa: arvo($('m-maaranpaa')),
    tarkoitus: arvo($('m-tarkoitus')),
    lisamatkustajat,
    perakarry: $('m-perakarry').checked,
  });
  avaaPaivakirja(paivakirjanVieritys);
});

$('m-peruuta').addEventListener('click', () => avaaPaivakirja(paivakirjanVieritys));

$('m-poista').addEventListener('click', async () => {
  const ajo = await db.trips.get(Number($('muokkaus').dataset.id));
  if (!ajo) return avaaPaivakirja(paivakirjanVieritys);
  if (await vahvista(`Poistetaanko ajo? ${paiva(ajo.alkuaika)} klo ${aika(ajo.alkuaika)}, ${km.format(ajonKm(ajo))} km.`)) {
    await db.trips.delete(ajo.id);
    avaaPaivakirja(paivakirjanVieritys);
  }
});

// --- CSV-vienti ---

const CSV_SARAKKEET = [
  'Päivä', 'Alkuaika', 'Loppuaika',
  'Lähtö', 'Lähtö lat', 'Lähtö lon',
  'Määränpää', 'Määränpää lat', 'Määränpää lon',
  'Tarkoitus', 'Mittari alku', 'Mittari loppu', 'Km', 'Lisämatkustajat', 'Peräkärry',
];
// BOM ja CRLF, jotta suomalainen Excel avaa tiedoston oikein.
const BOM = String.fromCharCode(0xfeff);
const RIVINVAIHTO = String.fromCharCode(13, 10);

// Puolipisteen, lainausmerkin tai välilyönnin sisältävä kenttä lainausmerkkeihin.
function csvKentta(arvo) {
  const s = arvo == null ? '' : String(arvo);
  return /[;"\s]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

// Koordinaatti pilkulla, jotta Excel lukee sen numerona.
function koordinaatti(x) {
  return x == null ? '' : x.toFixed(6).replace('.', ',');
}

// "08:15"
function kellonaika(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function ajojenCsv(ajot) {
  const rivit = [...ajot]
    .sort((a, b) => a.alkuaika.localeCompare(b.alkuaika))
    .map((a) => [
      `${paiva(a.alkuaika)}${new Date(a.alkuaika).getFullYear()}`, kellonaika(a.alkuaika), kellonaika(a.loppuaika),
      a.lahtopaikka, koordinaatti(a.sijaintiAlku?.lat), koordinaatti(a.sijaintiAlku?.lon),
      a.maaranpaa, koordinaatti(a.sijaintiLoppu?.lat), koordinaatti(a.sijaintiLoppu?.lon),
      a.tarkoitus, a.mittariAlku, a.mittariLoppu, ajonKm(a), a.lisamatkustajat ?? 0, a.perakarry ? 'kyllä' : 'ei',
    ]);
  return BOM + [CSV_SARAKKEET, ...rivit].map((r) => r.map(csvKentta).join(';')).join(RIVINVAIHTO) + RIVINVAIHTO;
}

function vieCsv(ajot) {
  const d = new Date(ajot[0].alkuaika);
  const nimi = `ajopaivakirja-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}.csv`;
  jaaTiedosto(nimi, ajojenCsv(ajot), 'text/csv');
}

// iPhonella avautuu jakovalikko (Tiedostot, Mail). Muualla tiedosto ladataan.
// Palauttaa false, jos käyttäjä sulki jakovalikon.
async function jaaTiedosto(nimi, sisalto, tyyppi) {
  const tiedosto = new File([sisalto], nimi, { type: tyyppi });
  if (navigator.canShare?.({ files: [tiedosto] })) {
    try {
      await navigator.share({ files: [tiedosto] });
      return true;
    } catch (e) {
      if (e.name === 'AbortError') return false;
    }
  }
  const linkki = document.createElement('a');
  linkki.href = URL.createObjectURL(tiedosto);
  linkki.download = nimi;
  linkki.click();
  setTimeout(() => URL.revokeObjectURL(linkki.href), 1000);
  return true;
}

// --- Varmuuskopio ---

const VARMUUSKOPIO_AVAIN = 'viimeisinVarmuuskopio';
const VARMUUSKOPIO_PAIVAT = 7;
const VARMUUSKOPIO_AJOT = 20;

// Kaikki ajot viimeisimmästä latauksesta. Varmuuskopio muodostetaan näistä ilman
// tietokannan odottelua, jotta iOS:n jakovalikko avautuu saman napautuksen seurauksena.
let ajotMuistissa = [];

// "30.10.2026"
function paivays(iso) {
  return `${paiva(iso)}${new Date(iso).getFullYear()}`;
}

// Yli 7 päivää tai yli 20 ajoa edellisestä varmuuskopiosta. Jos kopiota ei ole,
// lasketaan ensimmäisestä ajosta.
function varmuuskopioMyohassa(ajot) {
  const valmiit = ajot.filter((a) => a.tila === 'valmis');
  if (!valmiit.length) return false;
  const viimeisin = localStorage.getItem(VARMUUSKOPIO_AVAIN)
    ?? valmiit.reduce((aikaisin, a) => (a.alkuaika < aikaisin ? a.alkuaika : aikaisin), valmiit[0].alkuaika);
  const uusia = valmiit.filter((a) => a.loppuaika > viimeisin).length;
  return Date.now() - Date.parse(viimeisin) > VARMUUSKOPIO_PAIVAT * VUOROKAUSI_MS || uusia > VARMUUSKOPIO_AJOT;
}

async function varmuuskopioi() {
  const nyt = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const nimi = `ajopaivakirja-varmuuskopio-${nyt.getFullYear()}-${p(nyt.getMonth() + 1)}-${p(nyt.getDate())}.json`;
  const sisalto = JSON.stringify({ sovellus: 'ajopaivakirja', versio: 1, luotu: nyt.toISOString(), ajot: ajotMuistissa }, null, 2);
  const onnistui = await jaaTiedosto(nimi, sisalto, 'application/json');
  if (onnistui) localStorage.setItem(VARMUUSKOPIO_AVAIN, nyt.toISOString());
  return onnistui;
}

// Palauttaa tarkistetun varmuuskopion tai heittää virheen, jonka viesti näytetään käyttäjälle.
function tarkistaVarmuuskopio(teksti) {
  let data;
  try {
    data = JSON.parse(teksti);
  } catch {
    throw new Error('Tiedosto ei ole ajopäiväkirjan varmuuskopio.');
  }
  if (data?.sovellus !== 'ajopaivakirja' || !Array.isArray(data.ajot)) {
    throw new Error('Tiedosto ei ole ajopäiväkirjan varmuuskopio.');
  }
  if (data.versio !== 1) throw new Error('Varmuuskopion versiota ei tunneta.');
  const onAika = (s) => typeof s === 'string' && !Number.isNaN(Date.parse(s));
  const onLukema = (x) => Number.isInteger(x) && x >= 0;
  const kelpaa = (a) => Number.isInteger(a?.id) && onAika(a.alkuaika) && (a.tila === 'avoin'
    || (a.tila === 'valmis' && onAika(a.loppuaika) && onLukema(a.mittariAlku) && onLukema(a.mittariLoppu)));
  if (!data.ajot.every(kelpaa)) throw new Error('Varmuuskopiossa on virheellinen ajo.');
  if (new Set(data.ajot.map((a) => a.id)).size !== data.ajot.length) throw new Error('Varmuuskopiossa on sama ajo kahdesti.');
  if (data.ajot.filter((a) => a.tila === 'avoin').length > 1) throw new Error('Varmuuskopiossa on useampi käynnissä oleva ajo.');
  return data;
}

$('pk-varmuuskopioi').addEventListener('click', async () => {
  if (await varmuuskopioi()) avaaPaivakirja(window.scrollY, 'Varmuuskopio otettu.');
});

$('muistutus-varmuuskopioi').addEventListener('click', async () => {
  if (await varmuuskopioi()) naytaPaa('Varmuuskopio otettu.');
});

$('pk-tuo').addEventListener('click', () => $('pk-tiedosto').click());

$('pk-tiedosto').addEventListener('change', async (e) => {
  const tiedosto = e.target.files[0];
  e.target.value = '';
  if (!tiedosto) return;

  let kopio;
  try {
    kopio = tarkistaVarmuuskopio(await tiedosto.text());
  } catch (virhe) {
    return avaaPaivakirja(0, virhe.message);
  }
  const nykyiset = await db.trips.count();
  const ajoja = (n) => `${n} ${n === 1 ? 'ajo' : 'ajoa'}`;
  const teksti = `Palautetaanko ${paivays(kopio.luotu)} otettu varmuuskopio (${ajoja(kopio.ajot.length)})?`
    + (nykyiset ? ` Nykyiset tiedot (${ajoja(nykyiset)}) korvataan.` : '');
  if (!await vahvista(teksti, 'Palauta')) return;

  await db.transaction('rw', db.trips, async () => {
    await db.trips.clear();
    await db.trips.bulkAdd(kopio.ajot);
  });
  localStorage.setItem(VARMUUSKOPIO_AVAIN, new Date().toISOString());
  avaaPaivakirja(0, `Varmuuskopio palautettu, ${ajoja(kopio.ajot.length)}.`);
});

// --- Käynnistys ---

// Päivitetään pääruutu, kun sovellus palaa näkyviin (esim. auki jääneen ajon varoitus).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !$('paa').hidden) naytaPaa();
});

naytaPaa();
