<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') exit;
require_once __DIR__.'/bootstrap.php';
foreach (explode(';', file_get_contents(__DIR__.'/lottery-current.sql')) as $statement) {
    if (trim($statement) !== '') db()->exec($statement);
}
echo "Current lottery table is ready.\n";
