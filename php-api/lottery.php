<?php
declare(strict_types=1);

function lotteryState(bool $lock = false): array {
    return row('SELECT *, UTC_TIMESTAMP(3) AS serverNow FROM TorosLottery WHERE id=1'.($lock ? ' FOR UPDATE' : ''))
        ?? fail(503, 'Выполните миграцию розыгрыша.');
}

function lotteryTicketKey(array $ticket): string {
    return $ticket['sector'].':'.$ticket['row'].':'.$ticket['seat'];
}

function lotteryView(array $state, bool $private = false): array {
    $tickets = json_decode($state['tickets'], true, 512, JSON_THROW_ON_ERROR);
    $winners = json_decode($state['winners'], true, 512, JSON_THROW_ON_ERROR);
    $running = $state['revealAt'] !== null && $state['revealAt'] > $state['serverNow'];
    $latest = count($winners) ? $winners[count($winners)-1] : null;
    return [
        'total'=>count($tickets), 'remaining'=>count($tickets)-count($winners),
        'running'=>$running, 'drawId'=>$state['drawId'],
        'remainingMs'=>$running ? max(0, (int)round(((float)(new DateTimeImmutable($state['revealAt']))->format('U.u')-(float)(new DateTimeImmutable($state['serverNow']))->format('U.u'))*1000)) : 0,
        'winner'=>$running ? null : $latest,
        'winners'=>$running ? array_slice($winners,0,-1) : $winners,
        ...($private ? ['tickets'=>$tickets] : []),
    ];
}

function lotteryAdmin(string $method, string $path): never {
    if ($method === 'GET' && $path === '/admin/lottery') respond(lotteryView(lotteryState(), true));
    $data = body();
    if ($method === 'POST' && $path === '/admin/lottery/import') {
        $tickets = $data['tickets'] ?? null;
        if (!is_array($tickets) || !array_is_list($tickets) || !count($tickets) || count($tickets)>10000) fail(400, 'Вставьте от 1 до 10 000 билетов.');
        $unique = [];
        foreach ($tickets as $ticket) {
            if (!is_array($ticket)) fail(400, 'Проверьте билеты.');
            $parts = [];
            foreach (['sector','row','seat'] as $key) {
                $value = $ticket[$key] ?? null;
                if (!is_string($value) || !preg_match('/^[0-9]{1,5}$/D', $value) || (int)$value < 1) fail(400, 'Сектор, ряд и место должны быть положительными числами.');
                $parts[$key] = (string)(int)$value;
            }
            $unique[implode(':', $parts)] = $parts;
        }
        $result = transaction(function () use ($unique) {
            $state = lotteryState(true);
            if ($state['revealAt'] !== null && $state['revealAt'] > $state['serverNow']) fail(409, 'Дождитесь окончания анимации.');
            sql('UPDATE TorosLottery SET tickets=?,winners=?,drawId=NULL,revealAt=NULL WHERE id=1',
                [json_encode(array_values($unique)), '[]']);
            return lotteryView(lotteryState(), true);
        });
        respond($result);
    }
    if ($method === 'POST' && $path === '/admin/lottery/draw') {
        $requestId = $data['requestId'] ?? '';
        if (!is_string($requestId) || !preg_match('/^[a-f0-9]{32}$/D', $requestId)) fail(400, 'Обновите страницу.');
        $result = transaction(function () use ($requestId) {
            $state = lotteryState(true);
            if ($state['drawId'] === $requestId) return lotteryView($state);
            if ($state['revealAt'] !== null && $state['revealAt'] > $state['serverNow']) fail(409, 'Розыгрыш уже идёт.');
            $tickets = json_decode($state['tickets'], true, 512, JSON_THROW_ON_ERROR);
            $winners = json_decode($state['winners'], true, 512, JSON_THROW_ON_ERROR);
            foreach ($winners as $winner) {
                if (($winner['requestId'] ?? null) === $requestId) return lotteryView($state);
            }
            $used = array_fill_keys(array_map('lotteryTicketKey', $winners), true);
            $remaining = array_values(array_filter($tickets, fn($t)=>!isset($used[lotteryTicketKey($t)])));
            if (!count($remaining)) fail(409, 'Все билеты уже разыграны.');
            $winners[] = $remaining[random_int(0, count($remaining)-1)] + ['requestId'=>$requestId];
            sql('UPDATE TorosLottery SET winners=?,drawId=?,revealAt=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 10 SECOND) WHERE id=1',
                [json_encode($winners),$requestId]);
            return lotteryView(lotteryState());
        });
        respond($result);
    }
    fail(404, 'Адрес не найден.');
}
