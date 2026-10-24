<?php

use App\Modules\Support\DomainError;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {})
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );

        $exceptions->dontReport(DomainError::class);

        $exceptions->render(fn (DomainError $e) => response()->json($e->toResponseArray(), $e->status));

        $exceptions->render(function (HttpExceptionInterface $e, Request $request) {
            if (! $request->is('api/*')) {
                return null;
            }

            $status = $e->getStatusCode();
            [$code, $message] = match ($status) {
                404 => ['not_found', 'Recurso não encontrado neste espaço de trabalho.'],
                405 => ['method_not_allowed', 'Método não permitido para este endereço.'],
                413 => ['payload_too_large', 'O envio excede o tamanho máximo aceito pelo servidor.'],
                429 => ['too_many_requests', 'Muitas requisições em pouco tempo. Aguarde um instante e tente novamente.'],
                default => ['http_error', $e->getMessage() ?: 'Não foi possível concluir a requisição.'],
            };

            return response()->json(['message' => $message, 'code' => $code, 'details' => new stdClass], $status, $e->getHeaders());
        });
    })->create();
