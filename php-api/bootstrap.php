<?php
declare(strict_types=1);

date_default_timezone_set('UTC');

function config(string $key, string $default = ''): string {
    static $file;
    $file ??= is_file(__DIR__.'/../.env') ? parse_ini_file(__DIR__.'/../.env', false, INI_SCANNER_RAW) : [];
    $value = getenv($key);
    return $value !== false ? $value : ($file[$key] ?? $default);
}

function db(): PDO {
    static $pdo;
    if ($pdo) return $pdo;
    $url = parse_url(config('DATABASE_URL'));
    if (!$url || ($url['scheme'] ?? '') !== 'mysql' || !isset($url['host'], $url['path'], $url['user'])) {
        throw new RuntimeException('Configure DATABASE_URL');
    }
    $host = $url['host'];
    $database = ltrim($url['path'], '/');
    if (!preg_match('/\A[a-zA-Z0-9._-]+\z/', $host) || !preg_match('/\A[a-zA-Z0-9_]+\z/', $database)) {
        throw new RuntimeException('Invalid database host or name');
    }
    $pdo = new PDO("mysql:host=$host;port=".($url['port'] ?? 3306).";dbname=$database;charset=utf8mb4",
        rawurldecode($url['user']), rawurldecode($url['pass'] ?? ''), [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
    $pdo->exec("SET time_zone = '+00:00'");
    return $pdo;
}

function sql(string $query, array $params = []): PDOStatement {
    $statement = db()->prepare($query);
    $statement->execute($params);
    return $statement;
}

function row(string $query, array $params = []): ?array {
    return sql($query, $params)->fetch(PDO::FETCH_ASSOC) ?: null;
}

function rows(string $query, array $params = []): array {
    return sql($query, $params)->fetchAll(PDO::FETCH_ASSOC);
}

function transaction(callable $work): mixed {
    db()->beginTransaction();
    try {
        $result = $work();
        db()->commit();
        return $result;
    } catch (Throwable $error) {
        if (db()->inTransaction()) db()->rollBack();
        throw $error;
    }
}

final class HttpError extends RuntimeException {}

function fail(int $status, string $message): never {
    throw new HttpError($message, $status);
}

function iso(string $date): string {
    return (new DateTimeImmutable($date))->format('Y-m-d\TH:i:s.v\Z');
}

function findMatch(int $id, bool $lock = false): array {
    return row('SELECT * FROM `Match` WHERE id = ?'.($lock ? ' FOR UPDATE' : ''), [$id])
        ?? fail(404, 'Матч не найден.');
}

function teamView(array $team): array {
    $logo = $team['logo'] === '/images/toros.png' ? '/images/toros.svg' : $team['logo'];
    return ['id'=>(int)$team['id'], 'name'=>$team['name'], 'shortName'=>$team['shortName'],
        'logo'=>$logo ?? '/api/teams/'.$team['id'].'/logo'];
}

function predictionView(array $prediction): array {
    return ['homeScore'=>(int)$prediction['homeScore'], 'awayScore'=>(int)$prediction['awayScore'],
        'createdAt'=>iso($prediction['createdAt'])];
}

function matchView(array $match, bool $private = false): array {
    $teams = array_column(rows('SELECT id,name,shortName,logo FROM Team WHERE id IN (?,?)',
        [$match['homeId'], $match['awayId']]), null, 'id');
    $result = [
        'id'=>(int)$match['id'], 'status'=>$match['status'], 'tournament'=>$match['tournament'],
        'startsAt'=>iso($match['startsAt']), 'description'=>$match['description'],
        'home'=>teamView($teams[$match['homeId']]), 'away'=>teamView($teams[$match['awayId']]),
        'count'=>(int)sql('SELECT COUNT(*) FROM Prediction WHERE matchId = ?', [$match['id']])->fetchColumn(),
    ];
    if (($private || $match['status'] === 'PUBLISHED') && $match['homeScore'] !== null) {
        $winner = $match['winnerPredictionId'] === null ? null :
            row('SELECT participantId,homeScore,awayScore,createdAt FROM Prediction WHERE id = ?', [$match['winnerPredictionId']]);
        $result['result'] = ['homeScore'=>(int)$match['homeScore'], 'awayScore'=>(int)$match['awayScore'],
            'determined'=>$match['determinedAt'] !== null,
            'winner'=>$winner ? predictionView($winner) + ['number'=>(int)$winner['participantId']] : null];
    }
    return $result;
}
