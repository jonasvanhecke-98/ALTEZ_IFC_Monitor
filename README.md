# ALTEZ IFC Monitor Web v1.2

Een statische Trimble Connect **Project Extension** die IFC-modellen controleert op een echte `IFCPROPERTYSET` met de naam `Altez_IFC`.

## Wat is nieuw in v1.2

Deze versie is aangepast voor accounts met veel projecten:

- **Europa staat standaard geselecteerd**.
- Je kiest eerst één dataregio: Europa, Noord-Amerika of Azië.
- Voor een bekende regio gaat de app **rechtstreeks naar het regionale Trimble endpoint**; Europa hoeft dus niet eerst alle regio's te ontdekken.
- De projectlijst wordt **per 50 projecten** opgehaald in plaats van alles tegelijk.
- Na de eerste 50 kun je onmiddellijk zoeken, selecteren en scannen.
- Alleen als je dat wilt klik je op **Meer projecten laden** voor de volgende 50.
- Reeds geladen projectlijsten worden maximaal 24 uur lokaal gecachet en verschijnen bij een volgende opening meteen.
- **Vernieuw eerste 50** haalt alleen de eerste pagina opnieuw live op.
- IFC-mappen en IFC-bestanden worden **pas** opgehaald nadat je projecten hebt aangevinkt en op **Controleer geselecteerde projecten** klikt.

## Normale flow

1. Open **ALTEZ IFC Monitor** in Trimble Connect.
2. Dataregio staat standaard op **Europa**.
3. Klik op **Laad eerste 50**. Als er een recente cache is, zie je die projecten al meteen.
4. Zoek op projectnaam of project-ID.
5. Vink alleen de gewenste projecten aan.
6. Staat het project nog niet in de geladen lijst, klik dan op **Meer projecten laden**.
7. Klik op **Controleer geselecteerde projecten**.
8. Alleen de gekozen projecten worden doorzocht naar `.ifc` en `.ifczip`.

## GitHub Pages

Repository: `ALTEZ_IFC_Monitor`

Publiceer de inhoud van deze map in de root van de repository en zet GitHub Pages op `main` / `(root)`.

App:
`https://jonasvanhecke-98.github.io/ALTEZ_IFC_Monitor/`

Manifest:
`https://jonasvanhecke-98.github.io/ALTEZ_IFC_Monitor/manifest.json`

## Trimble Connect installeren

Gebruik in Trimble Connect bij **Settings -> Apps & Capabilities -> Add Custom** de manifest-URL hierboven.

De extensie gebruikt de gebruikerssessie van Trimble Connect. Er staat geen Trimble-wachtwoord of permanent access token in GitHub.

## IFC-controle

De scanner controleert specifiek op een IFC-entiteit van het type `IFCPROPERTYSET` waarvan de naam `Altez_IFC` is, case-insensitive. Een gewone property die toevallig dezelfde tekst bevat telt niet als geldige propertyset.

De scanner ondersteunt:

- `.ifc`;
- `.ifczip`;
- gecomprimeerde IFCZIP;
- lokale scan-cache op modelversie;
- filters op OK, ontbrekend en controlefout.

## Cache

Er zijn twee aparte lokale caches:

1. **Projectlijstcache**: per dataregio, maximaal 24 uur gebruikt voor snelle heropening.
2. **IFC-scan-cache**: voorkomt dat een ongewijzigde modelversie opnieuw volledig gecontroleerd wordt.

De projectlijstcache bevat alleen projectmetadata zoals naam, id en regionaal endpoint. Het Trimble access token wordt niet opgeslagen.

## Belangrijk

Deze versie haalt bewust niet automatisch alle Europese projecten op. Dat betekent dat een project dat pas op een latere pagina staat pas zichtbaar wordt nadat je **Meer projecten laden** gebruikt. Dit voorkomt de lange wachttijd van v1.1.
