<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') exit;
require __DIR__.'/bootstrap.php';
try {
    foreach (explode(';', file_get_contents(__DIR__.'/lottery.sql')) as $statement) {
        if (trim($statement) !== '') db()->exec($statement);
    }
    echo "Lottery is ready.\n";
} catch (Throwable $error) {
    fwrite(STDERR, "Lottery migration failed.\n");
    exit(1);
}
