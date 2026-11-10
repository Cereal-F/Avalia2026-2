-- Batalha Naval Tático: partidas, frotas, tiros e placar geral
CREATE TABLE IF NOT EXISTS partidas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL CHECK (status IN ('aguardando', 'posicionando', 'em_andamento', 'finalizada')),
  jogador1_id TEXT NOT NULL,
  jogador1_nome TEXT NOT NULL,
  jogador1_avatar TEXT,
  jogador2_id TEXT,
  jogador2_nome TEXT,
  jogador2_avatar TEXT,
  vez_de TEXT,
  vencedor_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS tabuleiros (
  partida_id INTEGER NOT NULL REFERENCES partidas(id),
  jogador_id TEXT NOT NULL,
  navios_json TEXT NOT NULL,
  confirmado INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (partida_id, jogador_id)
);

CREATE TABLE IF NOT EXISTS tiros (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partida_id INTEGER NOT NULL REFERENCES partidas(id),
  atirador_id TEXT NOT NULL,
  linha INTEGER NOT NULL CHECK (linha BETWEEN 0 AND 9),
  coluna INTEGER NOT NULL CHECK (coluna BETWEEN 0 AND 9),
  resultado TEXT NOT NULL CHECK (resultado IN ('agua', 'acerto', 'afundado')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (partida_id, atirador_id, linha, coluna)
);

CREATE TABLE IF NOT EXISTS placar (
  user_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  avatar TEXT,
  vitorias INTEGER NOT NULL DEFAULT 0,
  derrotas INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_partidas_status ON partidas(status);
CREATE INDEX IF NOT EXISTS idx_tiros_partida ON tiros(partida_id);
