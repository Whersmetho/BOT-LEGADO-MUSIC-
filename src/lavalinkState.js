// Módulo compartido para el estado de Lavalink.
// Al ser un archivo independiente, evita la dependencia circular
// entre index.js (que carga los comandos) y play.js (que necesita este flag).

let _ready = false;

module.exports = {
  setReady: (val) => { _ready = val; },
  isReady:  ()    => _ready,
};
