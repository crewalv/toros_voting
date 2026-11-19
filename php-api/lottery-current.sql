-- Only the current list, pool and latest result. No draw history.
CREATE TABLE IF NOT EXISTS TorosLotteryCurrent (
    id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
    state LONGTEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT IGNORE INTO TorosLotteryCurrent (id,state) VALUES (1,'{"tickets":[],"pool":[],"winner":null,"drawId":"","endsAt":0}');
