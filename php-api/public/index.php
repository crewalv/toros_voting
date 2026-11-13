<?php
declare(strict_types=1);

require dirname(__DIR__).'/bootstrap.php';

function respond(mixed $value, int $status = 200): never {
    http_response_code($status);
    if ($status !== 204) {
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode($value, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    }
    exit;
}

function body(): array {
    $data = json_decode(file_get_contents('php://input', false, null, 0, 16385), true);
    if (!is_array($data)) fail(400, 'Проверьте данные запроса.');
    return $data;
}

function field(array $data, string $key, int $max, bool $optional = false): string {
    $value = $data[$key] ?? ($optional ? '' : null);
    if (!is_string($value) || mb_strlen($value = trim($value)) > $max || (!$optional && $value === '')) {
        fail(400, 'Проверьте поле '.$key.'.');
    }
    return $value;
}

function integer(mixed $value, int $min, int $max): int {
    if (!is_int($value) || $value < $min || $value > $max) fail(400, 'Проверьте числовые поля.');
    return $value;
}

function scores(array $data): array {
    return [integer($data['homeScore'] ?? null, 0, 999), integer($data['awayScore'] ?? null, 0, 999)];
}

function cookieName(string $kind): string {
    return (config('NODE_ENV') === 'production' ? '__Host-' : '').'toros-'.$kind;
}

function tokenHash(string $kind): ?string {
    $token = $_COOKIE[cookieName($kind)] ?? '';
    return is_string($token) && preg_match('/\A[a-f0-9]{64}\z/', $token) ? hash('sha256', $token) : null;
}

function cookie(string $kind, string $token, int $expires): void {
    setcookie(cookieName($kind), $token, [
        'expires'=>$expires, 'path'=>'/', 'secure'=>config('NODE_ENV') === 'production',
        'httponly'=>true, 'samesite'=>$kind === 'admin' ? 'Strict' : 'Lax',
    ]);
}

function voter(): ?int {
    $hash = tokenHash('voter');
    $participant = $hash ? row('SELECT id FROM Participant WHERE tokenHash = ?', [$hash]) : null;
    return $participant ? (int)$participant['id'] : null;
}

function limit(string $scope, int $maximum, int $seconds): void {
    $key = hash('sha256', $scope.':'.($_SERVER['REMOTE_ADDR'] ?? 'local'));
    $window = intdiv(time(), $seconds) * $seconds;
    $hits = transaction(function () use ($key, $window) {
        sql('INSERT INTO TorosRateLimit (bucket,windowStart,hits) VALUES (?,?,1)
             ON DUPLICATE KEY UPDATE hits = hits + 1', [$key, $window]);
        return (int)sql('SELECT hits FROM TorosRateLimit WHERE bucket=? AND windowStart=?', [$key,$window])->fetchColumn();
    });
    if (random_int(1, 1000) === 1) sql('DELETE FROM TorosRateLimit WHERE windowStart < ?', [time()-1800]);
    if ($hits > $maximum) {
        header('Retry-After: '.($window+$seconds-time()));
        fail(429, 'Слишком много запросов. Попробуйте немного позже.');
    }
}

function admin(string $method, string $path): never {
    if ($method === 'POST' && $path === '/admin/login') {
        limit('login', 10, 900);
        $data = body();
        $account = row('SELECT * FROM Admin WHERE login=?', [field($data, 'login', 80)]);
        $password = $data['password'] ?? '';
        if (!is_string($password) || strlen($password) > 512 ||
            !password_verify($password, $account['passwordHash'] ?? '') || !$account) {
            fail(401, 'Неверный логин или пароль.');
        }
        $token = bin2hex(random_bytes(32));
        $expires = time() + 28800;
        sql('DELETE FROM AdminSession WHERE expiresAt <= UTC_TIMESTAMP(3)');
        sql('INSERT INTO AdminSession (tokenHash,adminId,expiresAt) VALUES (?,?,?)',
            [hash('sha256',$token), $account['id'], gmdate('Y-m-d H:i:s',$expires)]);
        cookie('admin', $token, $expires);
        respond(['login'=>$account['login']]);
    }

    $hash = tokenHash('admin');
    $account = $hash ? row('SELECT a.login FROM AdminSession s JOIN Admin a ON a.id=s.adminId
        WHERE s.tokenHash=? AND s.expiresAt>UTC_TIMESTAMP(3)', [$hash]) : null;
    if (!$account) fail(401, 'Войдите в панель организатора.');

    if ($method === 'POST' && $path === '/admin/logout') {
        sql('DELETE FROM AdminSession WHERE tokenHash=?', [$hash]);
        cookie('admin', '', time()-3600);
        respond(null, 204);
    }
    if ($method === 'GET' && $path === '/admin/overview') {
        respond(['login'=>$account['login'],
            'matches'=>array_map(fn($m)=>matchView($m,true), rows('SELECT * FROM `Match` ORDER BY startsAt DESC')),
            'teams'=>array_map('teamView', rows('SELECT id,name,shortName,logo FROM Team ORDER BY name')),
            'participants'=>(int)sql('SELECT COUNT(*) FROM Participant')->fetchColumn()]);
    }
    if ($method === 'POST' && preg_match('~^/admin/teams(?:/([1-9][0-9]{0,9}))?$~D', $path, $m)) {
        saveTeam(isset($m[1]) ? (int)$m[1] : null);
    }
    if ($method === 'POST' && $path === '/admin/matches') {
        $data = body();
        $away = integer($data['awayId'] ?? null, 1, 2147483647);
        $home = row("SELECT id FROM Team WHERE name='Торос'") ?? fail(409, 'Добавьте «Торос» в справочник команд.');
        if ((int)$home['id'] === $away) fail(400, 'Выберите соперника «Тороса».');
        $date = field($data, 'startsAt', 40);
        if (!preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/D', $date)) fail(400, 'Проверьте время матча.');
        try {
            $start = (new DateTimeImmutable($date))->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s.v');
            if (DateTimeImmutable::getLastErrors() !== false) fail(400, 'Проверьте время матча.');
        } catch (Exception) {
            fail(400, 'Проверьте время матча.');
        }
        sql('INSERT INTO `Match` (homeId,awayId,startsAt,tournament,description) VALUES (?,?,?,?,?)',
            [$home['id'],$away,$start,field($data,'tournament',80),field($data,'description',600,true)]);
        respond(['id'=>(int)db()->lastInsertId()], 201);
    }
    if (preg_match('~^/admin/matches/([1-9][0-9]{0,9})(?:/(action|predictions(?:\.csv)?))?$~D', $path, $m)) {
        $id = (int)$m[1];
        $action = $m[2] ?? '';
        if ($method === 'DELETE' && $action === '') {
            transaction(function () use ($id) {
                findMatch($id, true);
                sql('UPDATE `Match` SET winnerPredictionId=NULL WHERE id=?', [$id]);
                sql('DELETE FROM Prediction WHERE matchId=?', [$id]);
                sql('DELETE FROM `Match` WHERE id=?', [$id]);
            });
            respond(null, 204);
        }
        if ($method === 'POST' && $action === 'action') respond(transition($id, body()));
        if ($method === 'GET' && in_array($action, ['predictions','predictions.csv'], true)) predictions($id, $action === 'predictions.csv');
    }
    fail(404, 'Адрес не найден.');
}

function saveTeam(?int $id): never {
    $name = field($_POST,'name',80);
    $short = field($_POST,'shortName',12);
    $team = $id ? (row('SELECT name FROM Team WHERE id=?', [$id]) ?? fail(404, 'Команда не найдена.')) : null;
    if (($team['name'] ?? null) === 'Торос' && $name !== 'Торос') fail(400, 'Название домашней команды закреплено.');
    $file = $_FILES['logo'] ?? null;
    $bytes = $type = null;
    if ($file && $file['error'] !== UPLOAD_ERR_NO_FILE) {
        if ($file['error'] !== UPLOAD_ERR_OK || $file['size'] > 1048576 || !is_uploaded_file($file['tmp_name'])) fail(400, 'Размер эмблемы не должен превышать 1 МБ.');
        $type = (new finfo(FILEINFO_MIME_TYPE))->file($file['tmp_name']);
        if (!in_array($type,['image/png','image/jpeg','image/webp'],true)) fail(400, 'Загрузите PNG, JPEG или WebP.');
        $bytes = file_get_contents($file['tmp_name']);
    }
    if (!$id && $bytes === null) fail(400, 'Добавьте эмблему команды.');
    if (!$id) {
        sql('INSERT INTO Team (name,shortName,logoType,logoBytes) VALUES (?,?,?,?)', [$name,$short,$type,$bytes]);
        $id = (int)db()->lastInsertId();
    } elseif ($bytes !== null) {
        sql('UPDATE Team SET name=?,shortName=?,logo=NULL,logoType=?,logoBytes=? WHERE id=?', [$name,$short,$type,$bytes,$id]);
    } else {
        sql('UPDATE Team SET name=?,shortName=? WHERE id=?', [$name,$short,$id]);
    }
    respond(teamView(row('SELECT id,name,shortName,logo FROM Team WHERE id=?', [$id])), $team ? 200 : 201);
}

function transition(int $id, array $data): array {
    return transaction(function () use ($id,$data) {
        $match = findMatch($id,true);
        $now = (string)sql('SELECT UTC_TIMESTAMP(3)')->fetchColumn();
        $status = $match['status'];
        if (votingExpired($match, $now)) {
            sql("UPDATE `Match` SET status='CLOSED',closedAt=votingDeadline WHERE id=?", [$id]);
            $status = 'CLOSED';
        }
        $kind = $data['kind'] ?? '';
        if ($kind === 'schedule-close' && in_array($status, ['PENDING','OPEN'], true)) {
            $value = $data['deadline'] ?? null;
            if (!array_key_exists('deadline', $data)) fail(400, 'Укажите дату и время закрытия.');
            $deadline = null;
            if ($value !== null) {
                $local = is_string($value) && preg_match('/^[1-9]\d{3}-\d{2}-\d{2}T\d{2}:\d{2}$/D', $value)
                    ? DateTimeImmutable::createFromFormat('!Y-m-d\TH:i', $value, new DateTimeZone('Asia/Yekaterinburg'))
                    : false;
                if (!$local || $local->format('Y-m-d\TH:i') !== $value) fail(400, 'Проверьте дату и время закрытия.');
                $deadline = $local->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s.v');
                if ($deadline <= $now) fail(400, 'Выберите время в будущем.');
            }
            sql('UPDATE `Match` SET votingDeadline=? WHERE id=?', [$deadline,$id]);
        } elseif ($kind === 'open' && $status === 'PENDING') {
            if ($match['votingDeadline'] !== null && $match['votingDeadline'] <= $now) {
                fail(409, 'Измените или отмените прошедшее время автозакрытия.');
            }
            sql("UPDATE `Match` SET status='OPEN',openedAt=UTC_TIMESTAMP(3) WHERE id=?", [$id]);
        } elseif ($kind === 'close' && $status === 'OPEN') {
            sql("UPDATE `Match` SET status='CLOSED',closedAt=UTC_TIMESTAMP(3) WHERE id=?", [$id]);
        } elseif ($kind === 'score' && $status === 'CLOSED') {
            sql('UPDATE `Match` SET homeScore=?,awayScore=?,determinedAt=NULL,winnerPredictionId=NULL WHERE id=?', [...scores($data),$id]);
        } elseif (in_array($kind, ['determine', 'publish'], true) && $status === 'CLOSED' && $match['homeScore'] !== null) {
            $winner = row('SELECT id FROM Prediction WHERE matchId=? AND homeScore=? AND awayScore=? ORDER BY createdAt,id LIMIT 1',
                [$id,$match['homeScore'],$match['awayScore']]);
            if ($kind === 'publish') {
                sql("UPDATE `Match` SET winnerPredictionId=?,determinedAt=UTC_TIMESTAMP(3),
                    status='PUBLISHED',publishedAt=UTC_TIMESTAMP(3) WHERE id=?", [$winner['id'] ?? null,$id]);
            } else {
                sql('UPDATE `Match` SET winnerPredictionId=?,determinedAt=UTC_TIMESTAMP(3) WHERE id=?', [$winner['id'] ?? null,$id]);
            }
        } else {
            fail(409, 'Это действие недоступно на текущем этапе.');
        }
        return matchView(findMatch($id),true);
    });
}

function queryNumber(string $key): int {
    if (!isset($_GET[$key]) || $_GET[$key] === '') return 0;
    $value = $_GET[$key];
    if (!is_string($value) || !preg_match('/^[0-9]{1,10}$/D', $value)) fail(400, 'Проверьте номер.');
    return integer((int)$value, 1, 2147483647);
}

function predictions(int $id, bool $csv): never {
    findMatch($id);
    $number = queryNumber('number');
    $where = ' FROM Prediction WHERE matchId=?'.($number ? ' AND participantId=?' : '');
    $params = $number ? [$id,$number] : [$id];
    $query = 'SELECT id,participantId,homeScore,awayScore,createdAt'.$where.' AND id>? ORDER BY id';
    if ($csv) {
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="toros-match-'.$id.'.csv"');
        echo "\xEF\xBB\xBFУчастник;Торос/хозяева;Гости;Время (UTC)\r\n";
        $after = 0;
        while ($batch = rows($query.' LIMIT 500', [...$params,$after])) {
            foreach ($batch as $item) {
                echo implode(';', [$item['participantId'],$item['homeScore'],$item['awayScore'],iso($item['createdAt'])])."\r\n";
                $after = $item['id'];
            }
        }
        exit;
    }
    $batch = rows($query.' LIMIT 51', [...$params,queryNumber('after')]);
    $distribution = rows('SELECT homeScore,awayScore,COUNT(*) AS count FROM Prediction WHERE matchId=? GROUP BY homeScore,awayScore ORDER BY count DESC LIMIT 12', [$id]);
    respond(['rows'=>array_map(fn($p)=>predictionView($p)+['id'=>(int)$p['id'],'participantId'=>(int)$p['participantId']],array_slice($batch,0,50)),
        'next'=>count($batch)>50 ? (int)$batch[49]['id'] : null,
        'distribution'=>array_map(fn($item)=>array_map('intval',$item),$distribution)]);
}

function route(string $method, string $path): never {
    if (str_starts_with($path, '/admin/')) admin($method,$path);
    if ($method === 'GET' && $path === '/health') {
        db()->query('SELECT 1');
        respond(['ok'=>true]);
    }
    if ($method === 'GET' && in_array($path, ['/matches/current-display', '/matches/nearest'], true)) {
        $match = row("SELECT * FROM `Match`
            ORDER BY
                CASE
                    WHEN status='OPEN' AND (votingDeadline IS NULL OR votingDeadline > UTC_TIMESTAMP(3)) THEN 0
                    WHEN status='PENDING' AND startsAt > UTC_TIMESTAMP(3) THEN 2
                    ELSE 1
                END,
                CASE WHEN status='OPEN' AND (votingDeadline IS NULL OR votingDeadline > UTC_TIMESTAMP(3))
                    THEN openedAt END DESC,
                CASE WHEN status='PENDING' AND startsAt > UTC_TIMESTAMP(3) THEN startsAt END ASC,
                startsAt DESC, id DESC LIMIT 1");
        if ($path === '/matches/nearest') respond(['id'=>$match ? (int)$match['id'] : null]);
        respond($match ? ['match'=>matchView($match)] : null, $match ? 200 : 204);
    }
    if ($method === 'GET' && preg_match('~^/teams/([1-9][0-9]{0,9})/logo$~D',$path,$m)) {
        $team = row('SELECT logoType,logoBytes FROM Team WHERE id=?', [(int)$m[1]]);
        if (empty($team['logoBytes'])) fail(404, 'Эмблема не найдена.');
        header('Content-Type: '.$team['logoType']);
        echo $team['logoBytes'];
        exit;
    }
    if (!preg_match('~^/matches/([1-9][0-9]{0,9})(?:/(session|predictions|qr))?$~D',$path,$m)) fail(404, 'Адрес не найден.');
    $id = (int)$m[1];
    $action = $m[2] ?? '';
    if ($method === 'GET' && $action === '') {
        $result = ['match'=>matchView(findMatch($id))];
        if (($_GET['display'] ?? '') !== '1') {
            $number = voter();
            $prediction = $number ? row('SELECT * FROM Prediction WHERE matchId=? AND participantId=?',[$id,$number]) : null;
            $result += ['prediction'=>$prediction ? predictionView($prediction) : null];
            if ($number) $result['number'] = $number;
        }
        respond($result);
    }
    if ($method === 'POST' && $action === 'session') {
        limit('session', max(1,(int)config('SESSION_REQUESTS_PER_MINUTE','2000')),60);
        findMatch($id);
        $number = voter();
        if (!$number) {
            $token = bin2hex(random_bytes(32));
            sql('INSERT INTO Participant (tokenHash) VALUES (?)',[hash('sha256',$token)]);
            $number = (int)db()->lastInsertId();
            cookie('voter',$token,time()+31536000);
        }
        respond(['number'=>$number]);
    }
    if ($method === 'POST' && $action === 'predictions') {
        limit('vote', max(1,(int)config('VOTE_REQUESTS_PER_MINUTE','4000')),60);
        $number = voter() ?? fail(409, 'Не удалось найти участника. Обновите страницу.');
        $score = scores(body());
        $prediction = transaction(function () use ($id,$number,$score) {
            $match = findMatch($id,true);
            $existing = row('SELECT * FROM Prediction WHERE matchId=? AND participantId=?',[$id,$number]);
            if ($existing) return $existing;
            $now = (string)sql('SELECT UTC_TIMESTAMP(3)')->fetchColumn();
            if ($match['status'] !== 'OPEN' || votingExpired($match, $now)) fail(409, 'Приём прогнозов сейчас закрыт.');
            sql('INSERT INTO Prediction (matchId,participantId,homeScore,awayScore,createdAt) VALUES (?,?,?,?,?)',
                [$id,$number,...$score,$now]);
            return row('SELECT * FROM Prediction WHERE id=?',[(int)db()->lastInsertId()]);
        });
        respond(['prediction'=>predictionView($prediction)]);
    }
    if ($method === 'GET' && $action === 'qr') {
        findMatch($id);
        require dirname(__DIR__).'/vendor/autoload.php';
        $base = config('PUBLIC_BASE_URL', 'http://localhost:8000');
        $qr = new Endroid\QrCode\QrCode(data:rtrim($base,'/').'/match/'.$id,size:560,margin:40);
        $image = (new Endroid\QrCode\Writer\PngWriter())->write($qr);
        header('Content-Type: image/png');
        if (($_GET['download'] ?? '') === '1') header('Content-Disposition: attachment; filename="toros-match-'.$id.'.png"');
        echo $image->getString();
        exit;
    }
    fail(404, 'Адрес не найден.');
}

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
if ($path !== '/api' && !str_starts_with((string)$path,'/api/')) {
    $index = __DIR__.'/index.html';
    if (is_file($index)) {
        header('Content-Type: text/html; charset=utf-8');
        readfile($index);
    } else {
        http_response_code(503);
        echo 'React build is missing.';
    }
    exit;
}
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');
try {
    if (config('NODE_ENV') === 'production' && !preg_match('~^https://[^/]+/?$~D',config('PUBLIC_BASE_URL'))) {
        throw new RuntimeException('PUBLIC_BASE_URL must be HTTPS in production');
    }
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if ($method !== 'GET' && (($_SERVER['HTTP_X_TOROS_REQUEST'] ?? '') !== '1' ||
        ($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '') === 'cross-site')) fail(403, 'Запрос отклонён.');
    route($method,substr($path,4));
} catch (HttpError $error) {
    respond(['error'=>$error->getMessage()],$error->getCode());
} catch (PDOException $error) {
    $code = $error->errorInfo[1] ?? null;
    if ($code === 1062) respond(['error'=>'Запись с такими данными уже существует.'],409);
    if ($code === 1452) respond(['error'=>'Связанная запись не найдена.'],400);
    error_log('Toros database error: '.$error->getCode());
    respond(['error'=>'Сервис временно недоступен.'],503);
} catch (Throwable $error) {
    error_log('Toros error: '.$error::class);
    respond(['error'=>'Сервис временно недоступен.'],503);
}
