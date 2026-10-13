'use strict';

/** Último erro do provedor de IA (em memória), exibido no painel. Sem dados de saúde. */
let last = null;

module.exports = {
  record(kind, message) {
    last = { kind, message: String(message).slice(0, 200), at: new Date() };
  },
  clear() {
    last = null;
  },
  get() {
    return last;
  },
};
