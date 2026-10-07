# SoundCloud Sync

Scarica profili e playlist SoundCloud come mp3 (con copertina e tag), una cartella per playlist,
e li tiene allineati: ogni sync scarica solo le tracce nuove e può togliere quelle rimosse.

## Requisiti

- Node.js 23.6+ (esegue TypeScript direttamente, nessuna build)
- `yt-dlp`, `ffmpeg` e `python-curl_cffi`:

  ```bash
  sudo pacman -S yt-dlp ffmpeg python-curl_cffi
  ```

  `python-curl_cffi` serve perché SoundCloud rifiuta (HTTP 403) le connessioni riconosciute
  come yt-dlp: il programma lo fa presentare come Firefox (`--impersonate firefox`).

## Installazione

```bash
cd ~/Progetti/SoundCloudSync
npm install
ln -sf "$PWD/src/cli.ts" ~/.local/bin/soundcloud-sync
```

Il comando punta direttamente al sorgente: le modifiche valgono subito.

## Uso

```bash
soundcloud-sync                  # menu (frecce + Invio)
soundcloud-sync sync             # sincronizza subito (anche da script)
soundcloud-sync sync --notify    # idem, con notifica desktop a fine sync
```

Dal menu si scelgono:

- **Profili e playlist**: link a playlist o album, oppure un profilo intero (tutte le sue
  playlist, le tracce caricate o i "mi piace").
- **Cartella**: dove salvare; se la cambi, la musica già scaricata può essere spostata.
- **Download paralleli**: meno download = meno blocchi da SoundCloud.
- **Tracce tolte da SoundCloud**: cosa fare quando una traccia sparisce da una playlist:
  `chiedi` (predefinito, poi cestino), `cestino`, `elimina`, `mai`.
- **Cerca su YouTube i brani non scaricabili**: vedi sotto (attivo di default).
- **Sync automatica**: all'accesso al PC (2 minuti dopo il login) e/o periodica (ogni 1–24 ore,
  a orari fissi). Gira in background e manda una notifica solo se c'è qualcosa da dire.

### Brani non scaricabili: ricerca su YouTube

Alcune tracce SoundCloud non si possono scaricare (DRM, solo Go+, blocco geografico). Per
queste il programma:

1. legge da SoundCloud artista, titolo e durata (disponibili anche senza audio);
2. cerca su YouTube e dà un punteggio a ogni risultato (`src/match.ts`): parole del titolo in
   comune, durata uguale (tolleranza di qualche secondo per le intro dei videoclip), canale
   dell'artista o dell'etichetta. Scarta le versioni diverse (remix, live, slowed, nightcore…)
   presenti solo da una parte. **Sotto l'80% non scarica niente**: meglio un brano mancante che
   uno sbagliato;
3. scarica in mp3 con lo stesso nome e ID della traccia SoundCloud, poi riscrive i tag con quelli
   di SoundCloud. Nel tag commento resta la fonte (`Scaricata da YouTube: …`).

A fine sync la tabella **Trovate su YouTube** mostra per ogni traccia il video scelto, il canale e
la percentuale di corrispondenza, per controllare. Le tracce non trovate vengono registrate e non
si cercano di nuovo finché non scade il registro (30 giorni).

### Sync automatica

Usa due timer systemd utente sullo stesso servizio, scritti dal programma in
`~/.config/systemd/user/`:

| Unità | Quando |
| --- | --- |
| `soundcloud-sync-login.timer` | 2 minuti dopo l'accesso (solo abilitato: non scatta quando lo attivi) |
| `soundcloud-sync.timer` | a orari fissi; se il PC era spento, recupera appena possibile |
| `soundcloud-sync.service` | esegue `soundcloud-sync sync --notify` |

```bash
systemctl --user list-timers 'soundcloud-sync*'   # prossime esecuzioni
journalctl --user -u soundcloud-sync               # output delle sync automatiche
```

- Due sync non partono mai insieme (blocco in `~/.cache/soundcloud-sync/sync.lock`).
- In modalità `chiedi` la sync automatica non rimuove nulla: la notifica dice quante tracce
  sono sparite e si conferma dal menu.
- Le tracce non scaricabili per motivi permanenti (DRM, Go+, rimosse, blocco geografico)
  vengono saltate per 30 giorni, così non generano una notifica a ogni sync.

Durante la sync un riquadro mostra le tracce in download con il loro stato (velocità,
conversione, copertina) e una riga col totale: avanzamento, riuscite/fallite, velocità
complessiva, MB scaricati, tempo. Alla fine: riepilogo per playlist e tabella delle tracce
fallite con il motivo.

### Come funziona la pulizia

- Tocca solo i file con l'ID SoundCloud nel nome (`... [123456].mp3`): i file messi a mano
  nelle cartelle non vengono mai rimossi.
- Le playlist che non si riescono a leggere (errori di rete, 403) vengono saltate.
- Se in una playlist sparirebbe più di metà delle tracce, chiede sempre conferma.
- Il cestino è quello standard (`~/.local/share/Trash`), visibile dal file manager.
- Le tracce presenti in più playlist sono hard link: toglierne una non tocca le altre.
- Con `soundcloud-sync sync` senza terminale, la modalità `chiedi` non rimuove nulla.

## File

| Percorso | Contenuto |
| --- | --- |
| `~/.config/soundcloud-sync/config.json` | impostazioni |
| `~/.cache/soundcloud-sync/last-run.log` | log tecnico dell'ultima sync |
| `~/.cache/soundcloud-sync/unavailable.json` | tracce non scaricabili, saltate per 30 giorni |

## Struttura

| File | Cosa fa |
| --- | --- |
| `src/cli.ts` | punto d'ingresso, argomenti, Ctrl+C |
| `src/menu.ts` | menu interattivo |
| `src/sync.ts` | lettura playlist, download paralleli con vista live, pulizia, riepilogo |
| `src/ytdlp.ts` | chiamate a yt-dlp e lettura del suo avanzamento |
| `src/library.ts` | file locali: ID tracce, hard link, spostamenti, cestino |
| `src/fallback.ts` | ricerca e download da YouTube dei brani non scaricabili |
| `src/match.ts` | punteggio di corrispondenza tra traccia SoundCloud e risultati di ricerca |
| `src/view.ts` | vista live dei lavori in parallelo |
| `src/autosync.ts` | timer systemd della sync automatica |
| `src/notify.ts` | notifica desktop a fine sync |
| `src/unavailable.ts` | registro delle tracce non scaricabili |
| `src/ui.ts` | barre, riquadri, tabelle |
| `src/config.ts`, `src/log.ts`, `src/errors.ts` | impostazioni, log, motivi degli errori |

## Sviluppo

```bash
npm test            # node:test
npm run typecheck   # tsc
```
