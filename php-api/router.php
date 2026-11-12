<?php
declare(strict_types=1);

$path = rawurldecode((string)parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH));
$public = __DIR__.'/public';
$file = realpath($public.$path);
if (!str_starts_with($path, '/api/') && $file !== false &&
    str_starts_with($file, $public.DIRECTORY_SEPARATOR) &&
    is_file($file) && !str_ends_with($file, '.php') && !str_contains($path, '/.')) {
    return false;
}
require $public.'/index.php';
