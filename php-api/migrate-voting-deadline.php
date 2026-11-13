<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') exit;
require_once __DIR__.'/bootstrap.php';

try {
    if (!row("SHOW COLUMNS FROM `Match` LIKE 'votingDeadline'")) {
        db()->exec('ALTER TABLE `Match` ADD COLUMN `votingDeadline` DATETIME(3) NULL');
    }
    echo "Voting deadline column is ready.\n";
} catch (PDOException $error) {
    if (($error->errorInfo[1] ?? null) === 1060) {
        echo "Voting deadline column is already present.\n";
        exit;
    }
    fwrite(STDERR, 'Migration failed. SQLSTATE '.$error->getCode()."\n");
    exit(1);
}
