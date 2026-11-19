<?php
declare(strict_types=1);

function lotteryRead(bool $lock = false): array {
    $record = row('SELECT state FROM TorosLotteryCurrent WHERE id=1'.($lock ? ' FOR UPDATE' : ''));
    if (!$record) fail(503, 'Сначала установите таблицу розыгрыша из lottery-current.sql.');
    return json_decode($record['state'], true, 512, JSON_THROW_ON_ERROR);
}

function lotteryWrite(array $state): void {
    sql('UPDATE TorosLotteryCurrent SET state=? WHERE id=1', [json_encode($state, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)]);
}

function lotteryNow(): int { return (int)floor(microtime(true) * 1000); }

function lotteryView(array $state, bool $admin = false): array {
    $remaining = max(0, $state['endsAt'] - lotteryNow());
    $view = ['total'=>count($state['tickets']), 'remaining'=>count($state['pool']),
        'drawId'=>$state['drawId'], 'remainingMs'=>$remaining,
        'winner'=>$remaining > 0 ? null : $state['winner']];
    if ($admin) $view['tickets'] = $state['tickets'];
    return $view;
}

function lotteryParse(string $text): array {
    if (strlen($text) > 2000000 || !mb_check_encoding($text, 'UTF-8')) fail(400, 'Список слишком большой или содержит неверные символы.');
    $unique = [];
    foreach (preg_split('/\R/u', $text) as $line) {
        $line = trim($line);
        if ($line === '') continue;
        if (preg_match('/^сектор\s+ряд\s+место$/iu', $line)) continue;
        if (preg_match('/^(?:сектор\s*)?(\d{1,5})[\s;,\t]+(?:ряд\s*)?(\d{1,5})[\s;,\t]+(?:место\s*)?(\d{1,5})\s*$/iu', $line, $m)) {
            $line = 'Сектор '.(int)$m[1].' · Ряд '.(int)$m[2].' · Место '.(int)$m[3];
        } else {
            $line = preg_replace('/\h*\t\h*/u', ' · ', $line);
            $line = preg_replace('/\s+/u', ' ', $line);
        }
        if (mb_strlen($line) > 500 || preg_match('/[\x00-\x08\x0E-\x1F\x7F]/u', $line)) fail(400, 'Один билет может содержать до 500 символов, без управляющих знаков.');
        $unique[$line] = $line;
        if (count($unique) > 10000) fail(400, 'Можно загрузить до 10 000 уникальных билетов.');
    }
    if (!$unique) fail(400, 'Добавьте хотя бы один билет.');
    return array_values($unique);
}

function lotteryAdmin(string $method, string $path): never {
    if ($method === 'GET' && $path === '/admin/lottery') respond(lotteryView(lotteryRead(), true));
    if ($method === 'POST' && $path === '/admin/lottery/tickets') {
        $data = body(2100000);
        if (!is_string($data['text'] ?? null)) fail(400, 'Вставьте билеты в текстовое поле.');
        $tickets = lotteryParse($data['text']);
        $result = transaction(function () use ($tickets) {
            $old = lotteryRead(true);
            if ($old['endsAt'] > lotteryNow()) fail(409, 'Дождитесь завершения текущего розыгрыша.');
            // Replacing this single row removes the previous list, pool and result atomically.
            $state = ['tickets'=>$tickets, 'pool'=>array_keys($tickets), 'winner'=>null,
                'drawId'=>bin2hex(random_bytes(16)), 'endsAt'=>0];
            lotteryWrite($state);
            return lotteryView($state, true);
        });
        respond($result);
    }
    if ($method === 'POST' && $path === '/admin/lottery/draw') {
        $result = transaction(function () {
            $state = lotteryRead(true);
            if (!$state['tickets']) fail(409, 'Сначала сохраните билеты в панели администратора.');
            if ($state['endsAt'] > lotteryNow()) fail(409, 'Розыгрыш уже идёт.');
            if (!$state['pool']) $state['pool'] = array_keys($state['tickets']);
            $candidates = $state['pool'];
            if (count($candidates) > 1) {
                $candidates = array_values(array_filter($candidates, fn($i) => $state['tickets'][$i] !== $state['winner']));
            }
            $selected = $candidates[random_int(0, count($candidates)-1)];
            $state['pool'] = array_values(array_filter($state['pool'], fn($i) => $i !== $selected));
            $state['winner'] = $state['tickets'][$selected];
            $state['drawId'] = bin2hex(random_bytes(16));
            $state['endsAt'] = lotteryNow() + 5000;
            lotteryWrite($state);
            return lotteryView($state);
        });
        respond($result);
    }
    fail(404, 'Адрес не найден.');
}
