/*
  ===========================================================================
  BIOPARCO DI SICILIA — Sistema condiviso di nome utente e classifiche
  ===========================================================================
  Questo file va incluso IDENTICO in ogni gioco (scimmia, memory, snake...).
  Gestisce: creazione nome utente (con controllo parolacce/duplicati fatto
  dal database), invio punteggi, lettura classifica per singolo gioco.

  COME USARLO IN UN NUOVO GIOCO:
  1) Nel tuo file HTML, prima del tuo script di gioco, aggiungi:
       <script src="https://unpkg.com/@supabase/supabase-js@2"></script>
       <script src="leaderboard.js"></script>

  2) Per registrare un nuovo giocatore (di solito la prima volta che gioca):
       BioparcoGiochi.registraGiocatore("NomeScelto", function(errore, giocatore){
         if (errore) { alert(errore); return; }
         console.log("Registrato:", giocatore.username);
       });

  3) Per sapere se un giocatore è già registrato su questo dispositivo
     (così non gli richiedi il nome ogni volta):
       var giocatore = BioparcoGiochi.getGiocatoreCorrente();
       if (giocatore) { console.log("Bentornato,", giocatore.username); }

  4) A fine partita, per salvare il punteggio:
       BioparcoGiochi.registraPunteggio("nome-slug-del-gioco", punteggio, function(errore){
         if (errore) { console.log("Errore:", errore); return; }
         console.log("Punteggio salvato!");
       });
     NB: "nome-slug-del-gioco" deve essere sempre lo stesso per lo stesso
     gioco (es. 'banana-rush', 'memory-animali', 'snake-bioparco'), così le
     classifiche restano separate per gioco.

  5) Per mostrare la classifica di un gioco (i migliori 10 di default):
       BioparcoGiochi.caricaClassifica("banana-rush", function(lista, errore){
         if (errore) { console.log("Errore:", errore); return; }
         // lista è un array tipo: [{ username: "Mario", score: 120 }, ...]
       });
  ===========================================================================
*/
(function (global) {
  "use strict";

  // ---- Dati di connessione al progetto Supabase del Bioparco ----
  var SUPABASE_URL = "https://usbhgcciujvqejgkfezt.supabase.co";
  var SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVzYmhnY2NpdWp2cWVqZ2tmZXp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc5MjA5OTQsImV4cCI6MjEwMzQ5Njk5NH0.k_Rw9Ksl9KKwGV3-89rjOP5SPU2mjQ12c3KuJmno5oM";

  var STORAGE_KEY = "bioparco_giocatore";
  var client = null;

  function getClient() {
    if (client) return client;
    if (!global.supabase || !global.supabase.createClient) {
      console.error(
        "[BioparcoGiochi] Libreria Supabase non trovata. Aggiungi prima di leaderboard.js:\n" +
        '<script src="https://unpkg.com/@supabase/supabase-js@2"></script>'
      );
      return null;
    }
    client = global.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return client;
  }

  // ---- Salvataggio locale del giocatore (sul dispositivo) ----
  function leggiSalvato() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }
  function scriviSalvato(giocatore) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(giocatore));
    } catch (e) {}
  }

  function getGiocatoreCorrente() {
    return leggiSalvato();
  }

  function dimenticaGiocatore() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {}
  }

  // ---- Registrazione nuovo giocatore ----
  function registraGiocatore(username, callback) {
    username = (username || "").trim();
    if (username.length < 2) {
      callback("Il nome deve avere almeno 2 lettere.", null);
      return;
    }
    if (username.length > 14) {
      callback("Il nome può avere al massimo 14 caratteri.", null);
      return;
    }
    var sb = getClient();
    if (!sb) {
      callback("Servizio classifica non disponibile al momento.", null);
      return;
    }
    sb.from("players")
      .insert({ username: username })
      .select()
      .single()
      .then(function (res) {
        if (res.error) {
          // 23505 = violazione di unicità (nome già preso)
          if (res.error.code === "23505") {
            callback("Questo nome è già stato scelto, provane un altro!", null);
          } else if (
            res.error.message &&
            res.error.message.toLowerCase().indexOf("non consentito") !== -1
          ) {
            callback("Questo nome non è permesso, scegline un altro!", null);
          } else {
            callback("Errore imprevisto, riprova.", null);
          }
          return;
        }
        var giocatore = { id: res.data.id, username: res.data.username };
        scriviSalvato(giocatore);
        callback(null, giocatore);
      })
      .catch(function () {
        callback("Errore di connessione, riprova.", null);
      });
  }

  // ---- Invio punteggio per un gioco specifico ----
  function registraPunteggio(gameSlug, punteggio, callback) {
    var giocatore = getGiocatoreCorrente();
    if (!giocatore) {
      callback("Nessun giocatore registrato su questo dispositivo.", null);
      return;
    }
    var sb = getClient();
    if (!sb) {
      callback("Servizio classifica non disponibile al momento.", null);
      return;
    }
    sb.from("scores")
      .insert({
        player_id: giocatore.id,
        game: gameSlug,
        score: Math.floor(punteggio),
      })
      .then(function (res) {
        if (res.error) {
          callback("Errore nel salvataggio del punteggio.", null);
          return;
        }
        callback(null, true);
      })
      .catch(function () {
        callback("Errore di connessione, riprova.", null);
      });
  }

  // ---- Lettura classifica di un gioco ----
  function caricaClassifica(gameSlug, limite, callback) {
    if (typeof limite === "function") {
      callback = limite;
      limite = 10;
    }
    var sb = getClient();
    if (!sb) {
      callback(null, "Servizio classifica non disponibile al momento.");
      return;
    }
    sb.from("scores")
      .select("score, created_at, players(username)")
      .eq("game", gameSlug)
      .order("score", { ascending: false })
      .limit(limite || 10)
      .then(function (res) {
        if (res.error) {
          callback(null, "Impossibile caricare la classifica.");
          return;
        }
        var lista = res.data.map(function (riga) {
          return {
            username: riga.players ? riga.players.username : "???",
            score: riga.score,
          };
        });
        callback(lista, null);
      })
      .catch(function () {
        callback(null, "Impossibile caricare la classifica.");
      });
  }

  global.BioparcoGiochi = {
    getGiocatoreCorrente: getGiocatoreCorrente,
    dimenticaGiocatore: dimenticaGiocatore,
    registraGiocatore: registraGiocatore,
    registraPunteggio: registraPunteggio,
    caricaClassifica: caricaClassifica,
  };
})(window);
