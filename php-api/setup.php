<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') exit;
require __DIR__.'/bootstrap.php';

try {
    $login = trim(config('ADMIN_LOGIN'));
    $password = config('ADMIN_PASSWORD');
    if ($login === '' || mb_strlen($login) > 80 || strlen($password) < 12 || strlen($password) > 72) {
        throw new RuntimeException('Set ADMIN_LOGIN and ADMIN_PASSWORD (12–72 bytes) before setup.');
    }
    $tables = ['Team','Match','Participant','Prediction','Admin','AdminSession'];
    $existing = array_intersect($tables, db()->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN));
    if (!$existing) {
        $migration = file_get_contents(__DIR__.'/../apps/api/prisma/migrations/20261110000000_initial/migration.sql');
        foreach (explode(';', $migration) as $statement) {
            if (trim($statement) !== '') db()->exec($statement);
        }
    } elseif (count($existing) !== count($tables)) {
        throw new RuntimeException('Incomplete schema. Inspect the database before running setup again.');
    }
    db()->exec('CREATE TABLE IF NOT EXISTS TorosRateLimit (
        bucket CHAR(64) NOT NULL, windowStart BIGINT NOT NULL, hits INT NOT NULL,
        PRIMARY KEY (bucket,windowStart), INDEX (windowStart)
    ) ENGINE=InnoDB');
    $teams = json_decode(file_get_contents(__DIR__.'/../apps/api/src/vhl-teams.json'), true, 512, JSON_THROW_ON_ERROR);
    transaction(function () use ($login,$password,$teams) {
        foreach ($teams as $team) {
            sql('INSERT INTO Team (name,shortName,logo) VALUES (?,?,?) ON DUPLICATE KEY UPDATE id=id',
                [$team['name'],$team['shortName'],$team['logo']]);
        }
        sql('INSERT INTO Admin (login,passwordHash) VALUES (?,?) ON DUPLICATE KEY UPDATE passwordHash=?',
            [$login,$hash=password_hash($password,PASSWORD_DEFAULT),$hash]);
        sql('DELETE FROM AdminSession WHERE adminId=(SELECT id FROM Admin WHERE login=?)', [$login]);
    });
    echo "Database ready. Organizer password configured.\n";
} catch (PDOException $error) {
    fwrite(STDERR, 'Database setup failed. SQLSTATE '.$error->getCode()."\n");
    exit(1);
} catch (Throwable $error) {
    fwrite(STDERR, $error->getMessage()."\n");
    exit(1);
}
