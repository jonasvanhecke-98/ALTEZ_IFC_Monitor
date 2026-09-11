# ALTEZ IFC Monitor Web v1.0

Een statische Trimble Connect **Project Extension** die vanuit de browser alle Trimble Connect-projecten ophaalt die voor de ingelogde gebruiker zichtbaar zijn, alle `.ifc`/`.ifczip`-bestanden zoekt en controleert of er werkelijk een `IFCPROPERTYSET` met de naam `Altez_IFC` in het bronbestand zit.

## Waarom deze versie geen eigen server nodig heeft

Trimble Connect beheert de gebruikerssessie voor een extensie. De app vraagt via de Workspace API toestemming voor `accesstoken` en gebruikt dat token vervolgens voor de Core API. Daardoor hoeft er geen Trimble-wachtwoord, client secret of access token in GitHub te staan.

De scan draait in de browser. Resultaten/cache worden alleen in `localStorage` van die browser opgeslagen. Het access token zelf wordt **niet** opgeslagen.

## Online zetten via GitHub Pages

1. Maak op GitHub een nieuwe publieke repository met exact deze naam: `ALTEZ_IFC_Monitor`.
2. Upload **de inhoud van deze map** naar de root van de repository (`index.html`, `manifest.json`, `styles.css`, `icon.svg`, map `js`, enz.).
3. GitHub → repository → **Settings → Pages**.
4. Kies **Deploy from a branch** → `main` → `/ (root)` → Save.
5. De app komt dan op:
   `https://jonasvanhecke-98.github.io/ALTEZ_IFC_Monitor/`
6. Het manifest staat op:
   `https://jonasvanhecke-98.github.io/ALTEZ_IFC_Monitor/manifest.json`

## Toevoegen aan Trimble Connect

1. Open een Trimble Connect-project in de browser.
2. Ga naar **Settings → Apps & Capabilities → + Add Custom**.
3. Gebruik als manifest-URL:
   `https://jonasvanhecke-98.github.io/ALTEZ_IFC_Monitor/manifest.json`
4. Open daarna **ALTEZ IFC Monitor** in de projectnavigatie.
5. Bij de eerste keer vraagt Trimble toestemming om het access token met de extensie te delen. Sta dit toe.
6. Klik op **Controleer projecten**.

De extensie mag in één project geïnstalleerd staan, maar de scan gebruikt het gebruikers-token om ook de andere projecten te controleren die voor diezelfde gebruiker via de Core API zichtbaar zijn.

## Wat v1 controleert

- projecten uit alle Trimble Connect-regio's die de ingelogde gebruiker kan zien;
- `.ifc` en `.ifczip` bestanden in de projectbestandsstructuur;
- de huidige/beschikbare fileversie uit de Core API;
- exact de **Naam** van `IFCPROPERTYSET(..., 'Altez_IFC', ...)`, case-insensitive;
- een losse property die toevallig `Altez_IFC` heet, telt dus niet als geldige propertyset;
- ongewijzigde versies worden standaard uit de lokale cache gehaald;
- fouten bij een bestand/project worden als `Controlefout`/waarschuwing getoond en niet foutief als “propertyset ontbreekt”.

## Dashboard

Het dashboard toont:

- aantal gevonden projecten;
- aantal IFC-modellen;
- aantal modellen met `Altez_IFC`;
- aantal modellen waar `Altez_IFC` ontbreekt;
- aantal modellen die door een technische fout niet konden worden gecontroleerd;
- zoeken op project/model;
- filter `Alleen actie nodig`;
- knop om foutregels naar het klembord te kopiëren.

## Standalone testmodus

Als je `index.html` buiten Trimble Connect opent, verschijnt een veld om tijdelijk een geldig Trimble **user-context** access token te plakken. Dit token wordt niet opgeslagen. Dit is alleen bedoeld voor technische tests; de normale route is gebruik als Trimble Connect project-extensie.

## Tests in deze levering

De scanner is getest op:

- gewone IFC;
- case-insensitive propertysetnaam;
- propertyset verdeeld over meerdere tekst/chunks;
- voorkomen van een false positive bij een gewone property met dezelfde naam;
- ongecomprimeerde IFCZIP;
- deflate-gecomprimeerde IFCZIP;
- gesimuleerde Trimble regio → projecten → folder tree → IFC → download-URL flow;
- geldige project-extension manifeststructuur.

## Beperkingen van v1

- De controle start wanneer iemand op **Controleer projecten** klikt; er is nog geen nachtscan/backend.
- De zichtbare projecten volgen de rechten van de ingelogde gebruiker. Voor volledig accountbreed zicht is een accountadministrator de beste gebruiker/context.
- Een zeer grote IFCZIP (>300 MB) wordt bewust niet volledig in het browsergeheugen geladen.
- Resultaten zijn lokaal per browser. Een centraal historisch dashboard en automatische meldingen horen bij v2 met een kleine backend/database.
- Een live scan tegen jullie echte Trimble-account kan pas na publicatie/installatie met een echte Trimble sessie worden gevalideerd.
