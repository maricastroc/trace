<?php

use Illuminate\Support\Facades\Route;

Route::get('/', fn () => response()->json([
    'product' => 'Trace',
    'api' => url('/api/v1/meta'),
]));
