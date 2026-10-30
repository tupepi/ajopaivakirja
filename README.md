# Ajopäiväkirja

Yksinkertainen ajopäiväkirja iPhonelle työajojen kirjaamiseen matkalaskua varten. Ajo aloitetaan ja lopetetaan yhdellä napilla, ja kuukauden ajot viedään CSV-tiedostona matkalaskun liitteeksi.

**Sovellus:** https://tuukkap.com/ajopaivakirja/

## Ominaisuudet

- **Aloita ajo / Lopeta ajo.** Kellonaika ja sijainti tallentuvat napin painalluksesta. Pääruudulla ei ole muuta.
- **Mittarilukema** kirjoitetaan tai rullataan edellisestä lukemasta ylöspäin.
- **Paikkojen nimet** ehdotetaan aiemmista ajoista, kun sijainti on enintään 300 metrin päässä tunnetusta paikasta.
- **Päiväkirja** kuukausittain: ajojen määrä ja kilometrit sekä rivien muokkaus ja poisto.
- **CSV-vienti** kuukausittain suomalaiselle Excelille.
- **Varmuuskopio** JSON-tiedostona ja palautus. Sovellus muistuttaa varmuuskopiosta, kun edellisestä on yli 7 päivää tai yli 20 ajoa.
- **Toimii ilman verkkoyhteyttä** asennuksen jälkeen.

Sovellus kirjaa vain työajot. Yksityisajoja ei eritellä, joten mittarilukemissa on normaalisti aukkoja ajojen välillä.

## Tietosuoja

Kaikki tiedot tallentuvat vain puhelimen selaimeen (IndexedDB). Sovelluksella ei ole palvelinta, käyttäjätiliä eikä pilvitallennusta. Sijainti haetaan vain ajon alussa ja lopussa, eikä sitä lähetetä minnekään.

Koska tiedot ovat vain puhelimessa, ota varmuuskopio säännöllisesti.

## Asennus iPhonelle

1. Avaa https://tuukkap.com/ajopaivakirja/ Safarissa.
2. Napauta Jaa-painiketta ja valitse **Lisää Koti-valikkoon**.
3. Avaa sovellus Koti-valikon kuvakkeesta ja salli sijainti, kun sitä kysytään.

Käytä vain asennettua sovellusta. Safarin ja asennetun sovelluksen tiedot ovat erillään, eivätkä Safarissa tallennetut ajot siirry asennettuun sovellukseen. iOS voi poistaa Safarin tietoja, jos sivua ei käytetä noin viikkoon, mutta asennetun sovelluksen tiedot säilyvät.

## CSV-tiedosto

Päiväkirjan **Vie CSV** tekee kuukauden ajoista tiedoston, esimerkiksi `ajopaivakirja-2026-10.csv`. iPhonella tiedoston voi tallentaa Tiedostoihin tai lähettää sähköpostilla.

- Erotin on puolipiste, merkistö UTF-8 BOM:lla ja koordinaattien desimaalierotin pilkku, jotta suomalainen Excel avaa tiedoston oikein.
- Sarakkeet: päivä, alkuaika, loppuaika, lähtö, lähtö lat, lähtö lon, määränpää, määränpää lat, määränpää lon, tarkoitus, mittari alku, mittari loppu, km, lisämatkustajat, peräkärry.
- Kilometrikorvausta ei lasketa. Lisämatkustajat ja peräkärry ovat mukana, jotta työnantaja voi laskea korvauksen.

## Varmuuskopio

Päiväkirjan **Varmuuskopioi** tekee kaikista ajoista JSON-tiedoston, jonka voi tallentaa iCloud Driveen tai lähettää sähköpostilla. **Tuo varmuuskopio** palauttaa tiedoston ja korvaa kaikki nykyiset tiedot vahvistuksen jälkeen.

## Kehitys

Sovellus on staattinen verkkosivu: HTML, CSS ja JavaScript ilman kehystä ja rakennusvaihetta.

| Tiedosto | Sisältö |
| --- | --- |
| `index.html` | Näkymät ja tyylit |
| `app.js` | Sovelluslogiikka |
| `sw.js` | Service worker: tiedostot välimuistiin offline-käyttöä varten |
| `manifest.webmanifest` | PWA-asennuksen tiedot |
| `icons/` | Kuvakkeet |
| `vendor/` | Dexie.js |

**Paikallinen ajo:**

```sh
python3 -m http.server 8000
```

Avaa http://localhost:8000. Sijainti toimii `localhost`-osoitteessa, mutta puhelimella se vaatii HTTPS-yhteyden. Puhelimella testataan siksi GitHub Pagesin kautta.

**Muutosten julkaisu:**

1. Kasvata `VERSIO`-arvoa tiedostossa `sw.js` aina, kun jokin sovelluksen tiedosto muuttuu. Muuten asennettu sovellus jatkaa vanhan version käyttöä.
2. Puske `main`-haaraan. GitHub Pages julkaisee sen automaattisesti.
3. Puhelimessa uusi versio otetaan käyttöön, kun sovellus avataan seuraavan kerran.

Paikallisesti selain voi näyttää vanhaa versiota välimuistista. Ota Chromen kehittäjätyökaluissa käyttöön Application → Service workers → **Update on reload**.

**Tietomalli:** jokainen ajo on yksi rivi IndexedDB-tietokannan `ajopaivakirja` taulussa `trips`.

| Kenttä | Selitys |
| --- | --- |
| `id` | Automaattinen tunniste |
| `tila` | `avoin` (käynnissä) tai `valmis`. Avoimia ajoja on enintään yksi |
| `alkuaika`, `loppuaika` | ISO 8601 -aika UTC:nä |
| `mittariAlku`, `mittariLoppu` | Mittarilukemat kilometreinä. Pakollisia valmiissa ajossa |
| `lahtopaikka`, `maaranpaa`, `tarkoitus` | Vapaata tekstiä, voi puuttua |
| `sijaintiAlku`, `sijaintiLoppu` | `{ lat, lon, tarkkuus }`, tarkkuus metreinä. Voi puuttua |
| `lisamatkustajat`, `perakarry` | Lisätiedot kilometrikorvausta varten |

## Kolmannen osapuolen koodi

[Dexie.js](https://dexie.org/) 4.4.7, Apache License 2.0. Lisenssi ja NOTICE ovat kansiossa `vendor/`.
