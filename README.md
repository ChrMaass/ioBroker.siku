![Logo](admin/siku.png)

# ioBroker.siku

[![NPM version](https://img.shields.io/npm/v/iobroker.siku.svg)](https://www.npmjs.com/package/iobroker.siku)
[![Downloads](https://img.shields.io/npm/dm/iobroker.siku.svg)](https://www.npmjs.com/package/iobroker.siku)
![Number of Installations](https://iobroker.live/badges/siku-installed.svg)
![Current version in stable repository](https://iobroker.live/badges/siku-stable.svg)

[![NPM](https://nodei.co/npm/iobroker.siku.png?downloads=true)](https://nodei.co/npm/iobroker.siku/)

**Tests:** ![Test and Release](https://github.com/ChrMaass/ioBroker.siku/workflows/Test%20and%20Release/badge.svg)

## Adapter für ioBroker

Dieser Adapter integriert Lüftungsgeräte der Serie **SIKU RV V2** in ioBroker.

Der Entwicklungsstand in diesem Repository ist aktuell auf eine **Beta-Version** ausgerichtet.

## Aktueller Funktionsumfang

- Kommunikation per UDP gemäß Herstellerprotokoll
- Multi-Device-Betrieb in **einer** Adapter-Instanz
- Broadcast-Discovery im lokalen Netzwerk
- Admin-Konfiguration für mehrere Geräte
- separater RTC-Zeitcheck alle 24 Stunden
- Zeitsynchronisation nur bei Drift über konfigurierbarer Schwelle
- State-basierte Steuerung zentraler Betriebsparameter
- vollständige Abbildung des Wochenzeitplans über ioBroker-States

## Unterstützte Kernfunktionen

- Erkennung von Master-Geräten per Broadcast (`0x007C`, `0x00B9`)
- Verwaltung mehrerer Geräte über stabile Geräte-IDs
- Polling von Status-, Sensor- und Diagnosewerten
- Schreiben zentraler Parameter über States, z. B.:
    - Ein/Aus
    - Lüfterstufe
    - manuelle Lüfterstufe
    - Betriebsart
    - Nacht-/Party-Timer
    - Feuchte-Sollwert
    - Sensor-Aktivierungen
- Wochenzeitplan mit Struktur:
    - `schedule.monday.p1.speed`
    - `schedule.monday.p1.endHour`
    - `schedule.monday.p1.endMinute`
    - … bis `schedule.sunday.p4.*`
- Diagnosewerte wie:
    - Filter-Countdown
    - Betriebsstunden
    - Alarmstufe
    - Filterwechselanzeige
    - letzte Discovery / letzter Poll / letzte Zeitprüfung

## Entwicklung

Wichtige Skripte:

| Skript               | Zweck                                      |
| -------------------- | ------------------------------------------ |
| `npm run build`      | TypeScript kompilieren                     |
| `npm run check`      | Type-Check ohne Build                      |
| `npm run lint`       | Linting ausführen                          |
| `npm run test`       | Unit-/Pakettests ausführen                 |
| `npm run coverage`   | Test-Coverage ermitteln                    |
| `npm run dev-server` | Lokale ioBroker-Entwicklung mit dev-server |

Der Adapter wird mit dem offiziellen ioBroker-Tooling erzeugt und mit TypeScript entwickelt.

## Hinweise zum Beta-Status

- Discovery, Polling, Zeitcheck und Schedule-Reads wurden bereits gegen mehrere reale Geräte validiert.
- Schreibende Live-Tests wurden bewusst nur sehr zurückhaltend durchgeführt.
- Netzwerk-/Servicefunktionen wie WLAN-Rekonfiguration, Passwortänderung oder Reset sind aktuell **nicht** als normale States vorgesehen.

## Changelog

<!--
    Placeholder for the next version (at the beginning of the line):
    ### **WORK IN PROGRESS**
-->

### **WORK IN PROGRESS**

- (Christian Maaß) Broadcast-Discovery, Multi-Device-Runtime und separaten RTC-Zeitcheck ergänzt
- (Christian Maaß) zentrale State-Mappings für sichere Betriebsparameter ergänzt
- (Christian Maaß) vollständige Zeitplan-Abbildung für 7 Tage x 4 Perioden ergänzt

## License

MIT License

Copyright (c) 2026 Christian Maaß <christian@maass.it>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
